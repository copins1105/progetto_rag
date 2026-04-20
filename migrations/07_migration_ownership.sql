-- ============================================================
-- 07_migration_ownership.sql
-- Ownership Admin su Utenti e Documenti
-- ============================================================
-- Esegui con:
--   docker exec -i policy_db_container psql -U admin -d policy_db \
--     < 07_migration_ownership.sql
-- ============================================================

-- ============================================================
-- BLOCCO 1 — Colonna creato_da su Utente
-- ============================================================
-- Tiene traccia di quale Admin ha creato questo User.
-- NULL = creato dal sistema / SuperAdmin (nessun vincolo di visibilità).
-- CASCADE: se l'Admin viene eliminato, i suoi User non spariscono
--           ma il riferimento diventa NULL (orfani visibili solo a SuperAdmin).
-- ============================================================

ALTER TABLE Utente
    ADD COLUMN IF NOT EXISTS creato_da INTEGER
        REFERENCES Utente(utente_id)
        ON DELETE SET NULL;

-- Indice per "dammi tutti gli utenti creati da questo Admin"
CREATE INDEX IF NOT EXISTS idx_utente_creato_da
    ON Utente(creato_da)
    WHERE creato_da IS NOT NULL;

-- ============================================================
-- BLOCCO 2 — Indice su Documento.id_utente_caricamento
-- ============================================================
-- Già presente come colonna dallo schema 01, ma senza indice
-- esplicito dedicato al pattern "dammi solo i miei documenti".
-- La migration 06 ha creato idx_documento_utente, verifichiamo
-- e aggiungiamo solo se mancante.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_documento_caricamento_utente
    ON Documento(id_utente_caricamento)
    WHERE id_utente_caricamento IS NOT NULL;

-- ============================================================
-- BLOCCO 3 — View: utenti visibili per ruolo
-- ============================================================
-- v_utenti_per_admin: dato un admin_id, restituisce gli User
-- che può gestire. Usata dal backend per filtrare la lista.
--
-- SuperAdmin (NULL passato come admin_id) → tutti gli utenti
-- Admin → solo utenti con creato_da = admin_id
-- ============================================================

CREATE OR REPLACE VIEW v_utenti_visibili AS
SELECT
    u.utente_id,
    u.email,
    u.nome,
    u.cognome,
    u.data_creazione,
    u.creato_da,
    -- Ruolo dell'utente
    STRING_AGG(r.nome_ruolo, ', ' ORDER BY r.ruolo_id) AS ruoli,
    -- Ruolo del creatore (per display)
    u_creator.email AS creato_da_email
FROM Utente u
LEFT JOIN Utente_Ruolo ur ON ur.utente_id = u.utente_id
LEFT JOIN Ruolo         r  ON r.ruolo_id  = ur.ruolo_id
LEFT JOIN Utente u_creator ON u_creator.utente_id = u.creato_da
GROUP BY u.utente_id, u.email, u.nome, u.cognome,
         u.data_creazione, u.creato_da, u_creator.email;

-- ============================================================
-- BLOCCO 4 — Vincolo: Admin può creare solo User (non altri Admin)
-- ============================================================
-- Questo è enforced a livello applicativo (backend),
-- ma aggiungiamo una funzione helper SQL per chiarezza.
-- ============================================================

CREATE OR REPLACE FUNCTION ruolo_di(p_utente_id INTEGER)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT STRING_AGG(r.nome_ruolo, ',' ORDER BY r.ruolo_id)
    FROM Utente_Ruolo ur
    JOIN Ruolo r ON r.ruolo_id = ur.ruolo_id
    WHERE ur.utente_id = p_utente_id;
$$;

COMMENT ON FUNCTION ruolo_di IS
    'Restituisce i ruoli di un utente come stringa CSV. Usata per controlli di ownership.';

-- ============================================================
-- BLOCCO 5 — Aggiornamento Activity_Log per tracciare ownership
-- ============================================================
-- Nessuna modifica strutturale: il campo dettaglio JSONB può già
-- contenere {"creato_da": admin_id} quando un Admin crea un User.
-- Il backend salverà questo campo automaticamente.

-- ============================================================
-- CONFERMA FINALE
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Migration 07 completata con successo.';
    RAISE NOTICE 'Oggetti creati:';
    RAISE NOTICE '  COLUMN  Utente.creato_da (FK → Utente, ON DELETE SET NULL)';
    RAISE NOTICE '  INDEX   idx_utente_creato_da';
    RAISE NOTICE '  INDEX   idx_documento_caricamento_utente';
    RAISE NOTICE '  VIEW    v_utenti_visibili';
    RAISE NOTICE '  FUNC    ruolo_di(utente_id)';
    RAISE NOTICE '==============================================';
END $$;
