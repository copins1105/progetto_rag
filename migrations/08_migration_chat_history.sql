-- ============================================================
-- 08_migration_chat_history.sql
-- Persistenza sessioni chat + audit trail per admin
-- ============================================================
-- Esegui con:
--   docker exec -i policy_db_container psql -U admin -d policy_db \
--     < 08_migration_chat_history.sql
-- ============================================================


-- ============================================================
-- BLOCCO 1 — Tabella Chat_Sessione
-- ============================================================
-- Raggruppa tutti i messaggi di una conversazione sotto un'unica
-- entità. Permette di mostrare "le ultime N sessioni" nell'UI
-- senza scansionare Log_Risposta per ricostruire i raggruppamenti.
--
-- DESIGN DECISIONS:
--   titolo: estratto dalla prima domanda (max 120 char),
--            generato lato backend al momento della prima risposta.
--   is_archiviata: soft delete — non cancella i log, li nasconde
--                  dalla vista utente ma li mantiene per l'audit.
--   durata_secondi: calcolata e aggiornata a ogni nuovo messaggio,
--                   utile per metriche di engagement.
--   n_messaggi: denormalizzato per query di lista veloci senza COUNT.
-- ============================================================

CREATE TABLE IF NOT EXISTS Chat_Sessione (
    sessione_id     SERIAL          PRIMARY KEY,
    session_uuid    VARCHAR(64)     NOT NULL UNIQUE,  -- UUID dal frontend
    utente_id       INTEGER
                    REFERENCES Utente(utente_id)
                    ON DELETE SET NULL,               -- audit sopravvive all'utente
    titolo          VARCHAR(120),                     -- prima domanda troncata
    creata_il       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    aggiornata_il   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    chiusa_il       TIMESTAMPTZ,                      -- NULL = sessione attiva
    n_messaggi      INTEGER         NOT NULL DEFAULT 0,
    durata_secondi  INTEGER,                          -- calcolata dal backend
    is_archiviata   BOOLEAN         NOT NULL DEFAULT FALSE,
    -- metadati per analytics
    user_agent      TEXT,
    ip_address      INET
);

CREATE INDEX IF NOT EXISTS idx_chat_sessione_utente
    ON Chat_Sessione(utente_id, creata_il DESC)
    WHERE is_archiviata = FALSE;

CREATE INDEX IF NOT EXISTS idx_chat_sessione_uuid
    ON Chat_Sessione(session_uuid);

CREATE INDEX IF NOT EXISTS idx_chat_sessione_data
    ON Chat_Sessione(creata_il DESC);

COMMENT ON TABLE Chat_Sessione IS
    'Una sessione = una conversazione completa. '
    'session_uuid corrisponde al session_id generato dal frontend React. '
    'Log_Risposta.sessione_id referenzia questa tabella.';


-- ============================================================
-- BLOCCO 2 — Estensione Log_Risposta
-- ============================================================
-- Log_Risposta esisteva già dallo schema 01 con le colonne base.
-- Aggiungiamo:
--   sessione_id:       FK verso Chat_Sessione (raggruppamento)
--   testo_domanda:     già presente nello schema originale
--   testo_risposta:    già presente nello schema originale
--   documento_ids:     array degli ID documento usati dal RAG
--   session_id:        già aggiunto dalla migration 04 (colonna varchar legacy)
--   n_chunk_recuperati: quanti chunk ha trovato il retriever
--   latency_ms:        renamed da tempo_risposta_ms per chiarezza
--   bloccato:          true se la risposta era un blocco di sicurezza
--   tipo_risposta:     'content' | 'courtesy' | 'not_found' | 'blocked'
-- ============================================================

-- FK verso Chat_Sessione (nuova)
ALTER TABLE Log_Risposta
    ADD COLUMN IF NOT EXISTS sessione_id INTEGER
        REFERENCES Chat_Sessione(sessione_id)
        ON DELETE SET NULL;

-- Metriche RAG
ALTER TABLE Log_Risposta
    ADD COLUMN IF NOT EXISTS n_chunk_recuperati INTEGER DEFAULT 0;

ALTER TABLE Log_Risposta
    ADD COLUMN IF NOT EXISTS bloccato BOOLEAN DEFAULT FALSE;

ALTER TABLE Log_Risposta
    ADD COLUMN IF NOT EXISTS tipo_risposta VARCHAR(20) DEFAULT 'content'
        CHECK (tipo_risposta IN ('content','courtesy','not_found','blocked'));

-- Documenti usati (già aggiunto in migration 04, idempotente)
ALTER TABLE Log_Risposta
    ADD COLUMN IF NOT EXISTS documento_ids INTEGER[] DEFAULT '{}';

-- Session UUID legacy (già aggiunto in migration 04, idempotente)
ALTER TABLE Log_Risposta
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(64);

-- Indici per audit
CREATE INDEX IF NOT EXISTS idx_logrisposta_sessione
    ON Log_Risposta(sessione_id);

CREATE INDEX IF NOT EXISTS idx_logrisposta_tipo
    ON Log_Risposta(tipo_risposta, timestamp_query DESC);

CREATE INDEX IF NOT EXISTS idx_logrisposta_bloccato
    ON Log_Risposta(bloccato)
    WHERE bloccato = TRUE;


-- ============================================================
-- BLOCCO 3 — View: audit sessioni per admin
-- ============================================================
-- Usata da GET /api/v1/admin/chat-audit
-- Mostra le sessioni con statistiche aggregate senza esporre
-- il contenuto dei messaggi (che richiede un secondo endpoint).
-- ============================================================

CREATE OR REPLACE VIEW v_chat_audit AS
SELECT
    cs.sessione_id,
    cs.session_uuid,
    cs.titolo,
    cs.creata_il,
    cs.aggiornata_il,
    cs.chiusa_il,
    cs.n_messaggi,
    cs.durata_secondi,
    cs.is_archiviata,
    cs.ip_address::text                                     AS ip_address,
    -- Utente
    cs.utente_id,
    u.email                                                 AS utente_email,
    u.nome                                                  AS utente_nome,
    u.cognome                                               AS utente_cognome,
    -- Statistiche messaggi
    COUNT(lr.log_id)                                        AS n_log_risposta,
    COUNT(lr.log_id) FILTER (WHERE lr.bloccato = TRUE)      AS n_bloccati,
    COUNT(lr.log_id) FILTER (WHERE lr.tipo_risposta = 'not_found') AS n_not_found,
    ROUND(AVG(lr.tempo_risposta_ms))::int                   AS avg_latency_ms,
    -- Documenti unici referenziati
    (
        SELECT COUNT(DISTINCT elem)
        FROM Log_Risposta lr2
        CROSS JOIN UNNEST(lr2.documento_ids) AS elem
        WHERE lr2.sessione_id = cs.sessione_id
    )                                                       AS n_documenti_unici
FROM Chat_Sessione cs
LEFT JOIN Utente u ON u.utente_id = cs.utente_id
LEFT JOIN Log_Risposta lr ON lr.sessione_id = cs.sessione_id
GROUP BY
    cs.sessione_id, cs.session_uuid, cs.titolo,
    cs.creata_il, cs.aggiornata_il, cs.chiusa_il,
    cs.n_messaggi, cs.durata_secondi, cs.is_archiviata, cs.ip_address,
    cs.utente_id, u.email, u.nome, u.cognome;

COMMENT ON VIEW v_chat_audit IS
    'Vista per il pannello audit admin. Mostra metadati sessione + '
    'statistiche aggregate (no testo messaggi — richiede endpoint dedicato).';


-- ============================================================
-- BLOCCO 4 — View: messaggi singola sessione
-- ============================================================
-- Usata da GET /api/v1/admin/chat-audit/{session_uuid}
-- Espone il contenuto completo per un admin con permesso log_view.
-- ============================================================

CREATE OR REPLACE VIEW v_chat_messaggi AS
SELECT
    lr.log_id,
    lr.sessione_id,
    lr.testo_domanda,
    lr.testo_risposta,
    lr.tempo_risposta_ms,
    lr.timestamp_query,
    lr.feedback_csat,
    lr.bloccato,
    lr.tipo_risposta,
    lr.n_chunk_recuperati,
    lr.documento_ids,
    lr.session_id                                           AS session_uuid_legacy,
    -- Info documenti usati (JOIN denormalizzato per comodità)
    (
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'documento_id', d.documento_id,
            'titolo', d.titolo,
            'versione', d.versione
        ))
        FROM Documento d
        WHERE d.documento_id = ANY(lr.documento_ids)
    )                                                       AS documenti_dettaglio
FROM Log_Risposta lr
ORDER BY lr.timestamp_query ASC;

COMMENT ON VIEW v_chat_messaggi IS
    'Vista per il dettaglio di una sessione. Espone il testo completo '
    'dei messaggi. Filtrare sempre per sessione_id.';


-- ============================================================
-- BLOCCO 5 — Permessi RBAC per le nuove funzionalità
-- ============================================================

INSERT INTO Permesso (codice_permesso, descrizione) VALUES
    ('chat_history_view', 'Visualizza la propria cronologia chat'),
    ('chat_audit_view',   'Accesso audit completo alle sessioni di tutti gli utenti')
ON CONFLICT (codice_permesso) DO NOTHING;

-- Assegna i permessi ai ruoli
DO $$
DECLARE
    v_superadmin_id INTEGER;
    v_admin_id      INTEGER;
    v_user_id       INTEGER;
    p_history       INTEGER;
    p_audit         INTEGER;
BEGIN
    SELECT ruolo_id INTO v_superadmin_id FROM Ruolo WHERE nome_ruolo = 'SuperAdmin';
    SELECT ruolo_id INTO v_admin_id      FROM Ruolo WHERE nome_ruolo = 'Admin';
    SELECT ruolo_id INTO v_user_id       FROM Ruolo WHERE nome_ruolo = 'User';

    SELECT permesso_id INTO p_history FROM Permesso WHERE codice_permesso = 'chat_history_view';
    SELECT permesso_id INTO p_audit   FROM Permesso WHERE codice_permesso = 'chat_audit_view';

    -- SuperAdmin: tutto
    INSERT INTO Ruolo_Permesso (ruolo_id, permesso_id) VALUES
        (v_superadmin_id, p_history), (v_superadmin_id, p_audit)
    ON CONFLICT DO NOTHING;

    -- Admin: solo audit
    INSERT INTO Ruolo_Permesso (ruolo_id, permesso_id) VALUES
        (v_admin_id, p_history), (v_admin_id, p_audit)
    ON CONFLICT DO NOTHING;

    -- User: solo propria cronologia
    INSERT INTO Ruolo_Permesso (ruolo_id, permesso_id) VALUES
        (v_user_id, p_history)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Permessi chat assegnati.';
END $$;


-- ============================================================
-- BLOCCO 6 — Funzione di pulizia sessioni vecchie
-- ============================================================
-- Archivia automaticamente le sessioni più vecchie di N giorni
-- (soft delete: is_archiviata = TRUE, i log restano).
-- Chiamare dal backend con APScheduler ogni notte.
-- ============================================================

CREATE OR REPLACE FUNCTION archivia_sessioni_vecchie(giorni INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    archived INTEGER;
BEGIN
    UPDATE Chat_Sessione
    SET is_archiviata = TRUE
    WHERE is_archiviata = FALSE
      AND aggiornata_il < NOW() - (giorni || ' days')::INTERVAL;

    GET DIAGNOSTICS archived = ROW_COUNT;
    RAISE NOTICE 'Chat_Sessione: archiviate % sessioni più vecchie di % giorni.',
        archived, giorni;
    RETURN archived;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- CONFERMA FINALE
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Migration 08 completata con successo.';
    RAISE NOTICE 'Oggetti creati:';
    RAISE NOTICE '  TABLE  Chat_Sessione';
    RAISE NOTICE '  VIEW   v_chat_audit';
    RAISE NOTICE '  VIEW   v_chat_messaggi';
    RAISE NOTICE '  FUNC   archivia_sessioni_vecchie(giorni)';
    RAISE NOTICE '  PERM   chat_history_view (User, Admin, SuperAdmin)';
    RAISE NOTICE '  PERM   chat_audit_view (Admin, SuperAdmin)';
    RAISE NOTICE '==============================================';
END $$;
