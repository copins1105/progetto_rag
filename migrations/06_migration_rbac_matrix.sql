-- ============================================================
-- 06_migration_rbac_matrix.sql  — versione verificata e integrata
-- Sistema RBAC con matrice Utente/Ruolo/Permesso
-- ============================================================
-- PREREQUISITI (eseguire in ordine):
--   01_schema.sql                    → schema base + Utente/Ruolo/Permesso
--   02_seed.sql                      → seed ruoli (Admin, User) + utente test
--   03_migration.sql                 → sync_status + Sync_Log su Documento
--   04_migration_log_e_ruoli.sql     → SuperAdmin, Activity_Log, views stat
--   05_migration_refresh_token.sql   → Refresh_Token con purge function
--
-- Esegui con:
--   docker exec -i policy_db_container psql -U admin -d policy_db \
--     < 06_migration_rbac_matrix.sql
-- ============================================================


-- ============================================================
-- BLOCCO 0 — VALIDAZIONE PREREQUISITI
-- ============================================================
-- Verifica che tutte le tabelle dipendenti esistano.
-- Ferma l'esecuzione con un messaggio chiaro se mancano.
-- ============================================================

DO $$
DECLARE
    missing TEXT := '';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='utente')         THEN missing := missing || ' Utente'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ruolo')          THEN missing := missing || ' Ruolo'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='permesso')       THEN missing := missing || ' Permesso'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ruolo_permesso') THEN missing := missing || ' Ruolo_Permesso'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='utente_ruolo')   THEN missing := missing || ' Utente_Ruolo'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='documento')      THEN missing := missing || ' Documento'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='refresh_token')  THEN missing := missing || ' Refresh_Token'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ruolo WHERE nome_ruolo = 'SuperAdmin')                                                 THEN missing := missing || ' [ruolo SuperAdmin]'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ruolo WHERE nome_ruolo = 'Admin')                                                      THEN missing := missing || ' [ruolo Admin]'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ruolo WHERE nome_ruolo = 'User')                                                       THEN missing := missing || ' [ruolo User]'; END IF;

    IF missing <> '' THEN
        RAISE EXCEPTION
            'PREREQUISITI MANCANTI:% — Eseguire prima le migration 01-05.',
            missing;
    END IF;
    RAISE NOTICE 'Tutti i prerequisiti verificati.';
END $$;


-- ============================================================
-- BLOCCO 1 — TABELLA OVERRIDE INDIVIDUALI (utente_permesso)
-- ============================================================
-- NOME TABELLA: minuscolo per coerenza con SQLAlchemy.
--   rag_models.py usa __tablename__ = "utente_ruolo" (snake_case).
--   Questa tabella segue la stessa convenzione: "utente_permesso".
--   PostgreSQL abbassa i nomi comunque; snake_case evita problemi
--   di quoting nelle query raw del backend.
--
-- INTEGRAZIONE CON IL CODICE ESISTENTE:
--   auth.py:delete_user() → db.delete(user) + commit
--     La CASCADE su utente_id rimuove automaticamente tutti gli
--     override dell'utente eliminato. Nessuna modifica al codice.
--   auth_service.py:require_admin() → controlla nome_ruolo, non permessi
--     Non è impattato da questa tabella. Il codice esistente
--     continua a funzionare invariato.
--   Utente_Permesso NON è ancora in rag_models.py → vedi BLOCCO 10.
--
-- CASCATE:
--   utente_id  → CASCADE: utente eliminato = override eliminati
--   permesso_id → CASCADE: permesso eliminato = override eliminati
--   aggiornato_da → SET NULL: admin eliminato = audit trail conservato
-- ============================================================

CREATE TABLE IF NOT EXISTS utente_permesso (
    utente_id     INTEGER     NOT NULL
                  REFERENCES utente(utente_id) ON DELETE CASCADE,
    permesso_id   INTEGER     NOT NULL
                  REFERENCES permesso(permesso_id) ON DELETE CASCADE,
    concesso      BOOLEAN     NOT NULL DEFAULT TRUE,
    aggiornato_da INTEGER     REFERENCES utente(utente_id) ON DELETE SET NULL,
    aggiornato_il TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (utente_id, permesso_id)
);

-- FK reverse lookup: "quali utenti hanno un override su questo permesso"
-- (utente_id è già prefisso della PK: indice separato sarebbe ridondante)
CREATE INDEX IF NOT EXISTS idx_utente_permesso_permesso
    ON utente_permesso(permesso_id);

-- Audit: "tutti gli override impostati da questo admin"
CREATE INDEX IF NOT EXISTS idx_utente_permesso_aggiornato_da
    ON utente_permesso(aggiornato_da)
    WHERE aggiornato_da IS NOT NULL;

COMMENT ON TABLE utente_permesso IS
    'Override individuali sui permessi. Priorità: utente_permesso > ruolo_permesso.
     concesso=TRUE: garantisce il permesso anche se il ruolo non ce l''ha.
     concesso=FALSE: nega il permesso anche se il ruolo ce l''ha.
     Aggiungere classe ORM in rag_models.py — vedi BLOCCO 10.';


-- ============================================================
-- BLOCCO 2 — SEED PERMESSI COMPLETI
-- ============================================================
-- VERIFICA COLLISIONE CON 02_seed.sql:
--   02_seed.sql inserisce 'DOC_UPLOAD' e 'DOC_DELETE' (maiuscolo).
--   Questa migration inserisce 'doc_upload' e 'doc_delete' (minuscolo).
--   PostgreSQL: UNIQUE su codice_permesso è CASE-SENSITIVE.
--   'DOC_UPLOAD' != 'doc_upload' → nessun conflitto, ma sono
--   duplicati logici. I nuovi nomi minuscoli sono quelli canonical.
--   I vecchi nomi maiuscoli restano inerti: nessun ruolo li userà
--   dopo questa migration (i DELETE+INSERT del blocco 3 li escludono).
--
-- VERIFICA CON App.jsx (route protette):
--   PrivateRoute → controlla token (page_chat, page_profile)
--   AdminRoute   → controlla token + isAdmin (page_admin)
--   isAdmin viene dal JWT, non dalla tabella permesso.
--   I permessi page_* qui sono per il futuro require_permission().
--
-- VERIFICA CON AdminPanel.jsx (allTabs array):
--   tab_ingestion, tab_loader, tab_chunks, tab_modifica,
--   tab_sync, tab_users → tutti presenti nell'array allTabs.
--   tab_permissions → tab futuro per la matrice RBAC.
--   tab_log → tab futuro per activity log.
--
-- VERIFICA CON admin.py (endpoint → permesso corrispondente):
--   POST /upload          → doc_upload
--   POST /ingest/{f}      → doc_ingest
--   POST /load/{f}        → doc_load
--   PUT  /document/{f}    → doc_update
--   DELETE /document/{f}  → doc_delete
--   GET  /pdfs, /chunks   → doc_upload (lettura, stesso livello)
--   GET  /sync-status     → log_view
--
-- VERIFICA CON auth.py (endpoint → permesso corrispondente):
--   GET    /users         → user_view
--   POST   /users         → user_create
--   PUT    /users/{id}    → user_update
--   DELETE /users/{id}    → user_delete
--   (matrice endpoint futuro) → user_permissions
-- ============================================================

INSERT INTO permesso (codice_permesso, descrizione) VALUES

    -- Pagine frontend (App.jsx routes)
    ('page_chat',        'Accesso alla pagina Chat (route /)')                        ,
    ('page_admin',       'Accesso al pannello Admin (route /admin)')                  ,
    ('page_profile',     'Accesso alla pagina Profilo (route /profile)')              ,

    -- Tab AdminPanel.jsx (allTabs array — verificati nel codice)
    ('tab_ingestion',    'Tab Ingestion: conversione PDF in Markdown')                ,
    ('tab_loader',       'Tab Loader: caricamento in PostgreSQL e ChromaDB')          ,
    ('tab_chunks',       'Tab Chunks: esplorazione frammenti indicizzati')            ,
    ('tab_modifica',     'Tab Modifica: metadati documento')                          ,
    ('tab_sync',         'Tab Sync: stato sincronizzazione tra i DB')                 ,
    ('tab_log',          'Tab Log: activity log eventi admin')                        ,
    ('tab_users',        'Tab Utenti: gestione utenti (UserManagementPanel.jsx)')     ,
    ('tab_permissions',  'Tab Permessi: matrice RBAC — solo SuperAdmin')              ,

    -- Operazioni documenti (admin.py endpoints)
    ('doc_upload',       'Carica un nuovo PDF nel sistema')                           ,
    ('doc_ingest',       'Avvia pipeline ingestion (Marker + chunker)')               ,
    ('doc_load',         'Carica documento in ChromaDB e PostgreSQL')                 ,
    ('doc_update',       'Modifica metadati documento esistente')                     ,
    ('doc_delete',       'Elimina documento da tutti i livelli del sistema')          ,

    -- Gestione utenti (auth.py endpoints)
    ('user_view',        'Visualizza lista utenti e loro ruoli')                      ,
    ('user_create',      'Crea nuovo utente')                                         ,
    ('user_update',      'Modifica nome, cognome e ruolo utente esistente')           ,
    ('user_delete',      'Elimina utente (protezione: non eliminare se stessi)')      ,
    ('user_permissions', 'Modifica permessi individuali nella matrice RBAC')          ,

    -- Log e monitoring
    ('log_view',         'Visualizza activity log e stato sincronizzazione')          

ON CONFLICT (codice_permesso) DO NOTHING;


-- ============================================================
-- BLOCCO 3 — ASSEGNAZIONE PERMESSI AI RUOLI
-- ============================================================
-- STRATEGIA DELETE + INSERT:
--   A differenza del solo ON CONFLICT DO NOTHING dell'originale,
--   il DELETE prima dell'INSERT garantisce che la matrice sia
--   esattamente quella dichiarata qui (nessun residuo da
--   esecuzioni precedenti). Se un permesso viene rimosso dalla
--   lista e lo script viene rieseguito, viene rimosso dal ruolo.
--
-- IMPATTO SU utente_permesso:
--   Il DELETE su ruolo_permesso NON propaga a utente_permesso.
--   Le FK sono separate. Gli override individuali restano intatti.
--
-- COERENZA CON IL FRONTEND:
--   Il frontend usa isAdmin (dal JWT) per mostrare AdminRoute.
--   isAdmin = nome_ruolo IN ('Admin','SuperAdmin') in _user_dict().
--   I permessi granulari qui sotto non cambiano il JWT attuale.
--   Serviranno per il futuro require_permission() lato backend.
--
--   ATTENZIONE: il DELETE rimuove anche i permessi legacy
--   'DOC_UPLOAD' e 'DOC_DELETE' (maiuscoli, da 02_seed.sql)
--   dai ruoli Admin e User se erano stati assegnati. Questo è
--   il comportamento corretto: il sistema usa i nuovi nomi.
-- ============================================================

DO $$
DECLARE
    v_superadmin_id INTEGER;
    v_admin_id      INTEGER;
    v_user_id       INTEGER;
    v_count         INTEGER;
BEGIN
    SELECT ruolo_id INTO v_superadmin_id FROM ruolo WHERE nome_ruolo = 'SuperAdmin';
    SELECT ruolo_id INTO v_admin_id      FROM ruolo WHERE nome_ruolo = 'Admin';
    SELECT ruolo_id INTO v_user_id       FROM ruolo WHERE nome_ruolo = 'User';

    -- SuperAdmin: tutti i permessi
    DELETE FROM ruolo_permesso WHERE ruolo_id = v_superadmin_id;
    INSERT INTO ruolo_permesso (ruolo_id, permesso_id)
        SELECT v_superadmin_id, permesso_id FROM permesso;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'SuperAdmin: % permessi assegnati.', v_count;

    -- Admin: tutto tranne la gestione della matrice RBAC
    -- Questi permessi coprono tutti gli endpoint di admin.py e
    -- auth.py che usano Depends(require_admin)
    DELETE FROM ruolo_permesso WHERE ruolo_id = v_admin_id;
    INSERT INTO ruolo_permesso (ruolo_id, permesso_id)
        SELECT v_admin_id, permesso_id FROM permesso
        WHERE codice_permesso NOT IN ('user_permissions', 'tab_permissions');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Admin: % permessi assegnati.', v_count;

    -- User: solo accesso chat e profilo
    -- Coerente con PrivateRoute in App.jsx che protegge / e /profile
    -- Un User non raggiunge mai /admin (AdminRoute lo blocca)
    DELETE FROM ruolo_permesso WHERE ruolo_id = v_user_id;
    INSERT INTO ruolo_permesso (ruolo_id, permesso_id)
        SELECT v_user_id, permesso_id FROM permesso
        WHERE codice_permesso IN ('page_chat', 'page_profile');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'User: % permessi assegnati.', v_count;

    RAISE NOTICE 'Matrice ruolo → permesso configurata.';
END $$;


-- ============================================================
-- BLOCCO 4 — VIEW: PERMESSI EFFETTIVI PER UTENTE
-- ============================================================
-- VERIFICA USO ATTUALE NEL BACKEND:
--   auth_service.py:get_current_user() → legge solo JWT, non questa view
--   auth_service.py:require_admin()    → controlla nome_ruolo, non view
--   Nessun endpoint attuale usa questa view direttamente.
--
-- USO FUTURO PREVISTO:
--   Quando verrà aggiunto require_permission() in auth_service.py:
--     db.execute(text(
--       "SELECT concesso FROM v_permessi_effettivi "
--       "WHERE utente_id=:uid AND codice_permesso=:cod"
--     ), {"uid": user.utente_id, "cod": "doc_delete"}).scalar()
--   Alternativa più efficiente: usare la funzione utente_ha_permesso().
--
-- BUG ORIGINALE CORRETTO:
--   WHERE c.concesso = TRUE eliminava i deny dalla view.
--   Un override deny (concesso=FALSE) veniva ignorato: l'utente
--   manteneva il permesso dal ruolo anche se negato esplicitamente.
--   Soluzione: nessun filtro nella view, filtra il codice applicativo.
--
-- MULTI-RUOLO (Utente_Ruolo è N:M):
--   Un utente con due ruoli eredita l'UNIONE dei permessi.
--   Un permesso è granted se almeno uno dei ruoli ce l'ha.
--   DISTINCT ON nel CTE permessi_da_ruolo rimuove i duplicati
--   quando lo stesso permesso è presente in più ruoli.
-- ============================================================

CREATE OR REPLACE VIEW v_permessi_effettivi AS
WITH

permessi_da_ruolo AS (
    -- Unione dei permessi di tutti i ruoli dell'utente
    -- DISTINCT evita duplicati se stesso permesso è in più ruoli
    SELECT DISTINCT
        ur.utente_id,
        p.permesso_id,
        p.codice_permesso,
        p.descrizione,
        TRUE        AS concesso,
        'ruolo'     AS fonte
    FROM utente_ruolo ur
    JOIN ruolo_permesso rp ON rp.ruolo_id   = ur.ruolo_id
    JOIN permesso       p  ON p.permesso_id = rp.permesso_id
),

permessi_override AS (
    -- Override individuali: sia grant (TRUE) che deny (FALSE)
    SELECT
        up.utente_id,
        p.permesso_id,
        p.codice_permesso,
        p.descrizione,
        up.concesso,
        'override'  AS fonte
    FROM utente_permesso up
    JOIN permesso p ON p.permesso_id = up.permesso_id
),

combinati AS (
    -- Override ha priorità assoluta su eredità da ruolo
    SELECT * FROM permessi_override
    UNION ALL
    SELECT pr.* FROM permessi_da_ruolo pr
    WHERE NOT EXISTS (
        SELECT 1 FROM permessi_override po
        WHERE po.utente_id  = pr.utente_id
          AND po.permesso_id = pr.permesso_id
    )
)

SELECT
    u.utente_id,
    u.email,
    u.nome,
    u.cognome,
    c.permesso_id,
    c.codice_permesso,
    c.descrizione,
    c.concesso,
    c.fonte
FROM combinati c
JOIN utente u ON u.utente_id = c.utente_id;
-- IMPORTANTE: nessun WHERE c.concesso = TRUE.
-- Filtrare nel codice:
--   Controllo accesso / JWT → AND concesso = TRUE
--   Pannello admin matrice  → nessun filtro (mostra grant e deny)

COMMENT ON VIEW v_permessi_effettivi IS
    'Permessi effettivi: override > ruolo_multi > deny-by-default.
     Per JWT/accesso: filtrare AND concesso = TRUE.
     Per matrice admin: nessun filtro (mostra anche i deny espliciti).';


-- ============================================================
-- BLOCCO 5 — VIEW: MATRICE COMPLETA PER IL PANNELLO ADMIN
-- ============================================================
-- VERIFICA CON AdminPanel.jsx:
--   Il tab "Permessi" (tab_permissions) è in allTabs ma disabled
--   per Admin. Sarà visibile solo per SuperAdmin.
--   Questa view alimenterà il futuro endpoint GET /api/v1/admin/rbac-matrix.
--   Non esiste ancora nel backend: la view è predisposta.
--
-- BUG ORIGINALE CORRETTO — DUPLICATI CON MULTI-RUOLO:
--   LEFT JOIN Utente_Ruolo + CROSS JOIN Permesso senza DISTINCT ON
--   moltiplicava le righe per ogni ruolo aggiuntivo dell'utente.
--   Esempio: utente con 2 ruoli → 2× righe per ogni permesso.
--   Risolto con CTE ruolo_principale (DISTINCT ON → un ruolo per utente).
--
-- NOTA: ruolo_principale è solo per la colonna "ruolo" (display).
--   Per i permessi effettivi reali usare v_permessi_effettivi.
--   Un utente con più ruoli ha permessi dall'UNIONE dei ruoli,
--   ma nella matrice visuale mostriamo solo il ruolo "primario".
-- ============================================================

CREATE OR REPLACE VIEW v_matrice_permessi AS
WITH

ruolo_principale AS (
    -- Un solo ruolo per utente per la colonna display "ruolo"
    -- Usa il ruolo con ruolo_id più basso (primo inserito = base)
    SELECT DISTINCT ON (utente_id)
        utente_id,
        ruolo_id
    FROM utente_ruolo
    ORDER BY utente_id, ruolo_id ASC
)

SELECT
    u.utente_id,
    u.email,
    u.nome,
    u.cognome,
    r.nome_ruolo                                                        AS ruolo,
    p.permesso_id,
    p.codice_permesso,
    p.descrizione,

    -- Da ruolo principale (solo display — non considerare per accesso reale)
    CASE WHEN rp.permesso_id IS NOT NULL THEN TRUE ELSE FALSE END       AS da_ruolo,

    -- Override individuale: NULL=nessuno, TRUE=grant, FALSE=deny
    up.concesso                                                         AS override,

    -- Valore effettivo finale (deny-by-default)
    CASE
        WHEN up.concesso IS NOT NULL THEN up.concesso
        WHEN rp.permesso_id IS NOT NULL THEN TRUE
        ELSE FALSE
    END                                                                 AS effettivo,

    -- Fonte leggibile per il frontend
    CASE
        WHEN up.concesso = TRUE  THEN 'override_grant'
        WHEN up.concesso = FALSE THEN 'override_deny'
        WHEN rp.permesso_id IS NOT NULL THEN 'ruolo'
        ELSE 'negato'
    END                                                                 AS fonte

FROM utente u
LEFT JOIN ruolo_principale rp_main ON rp_main.utente_id = u.utente_id
LEFT JOIN ruolo r                   ON r.ruolo_id = rp_main.ruolo_id
CROSS JOIN permesso p
LEFT JOIN ruolo_permesso rp
    ON rp.ruolo_id    = rp_main.ruolo_id
   AND rp.permesso_id = p.permesso_id
LEFT JOIN utente_permesso up
    ON up.utente_id   = u.utente_id
   AND up.permesso_id = p.permesso_id;

COMMENT ON VIEW v_matrice_permessi IS
    'Matrice utenti x permessi per il pannello admin RBAC.
     Multi-ruolo: mostra solo il ruolo primario (display). 
     Permessi effettivi reali: usare v_permessi_effettivi.';


-- ============================================================
-- BLOCCO 6 — FUNZIONE SQL: VERIFICA PERMESSO SINGOLO
-- ============================================================
-- Predisposta per il futuro require_permission() in FastAPI.
-- Più efficiente di v_permessi_effettivi per controlli singoli
-- perché usa LIMIT 1 e EXISTS senza materializzare la view.
--
-- COMPATIBILITÀ ORM SQLAlchemy (auth_service.py pattern):
--   from sqlalchemy import text
--   result = db.execute(
--       text("SELECT utente_ha_permesso(:uid, :cod)"),
--       {"uid": current_user.utente_id, "cod": "doc_delete"}
--   ).scalar()
--   if not result:
--       raise HTTPException(403, "Permesso negato.")
--
-- SECURITY DEFINER: gira con i privilegi del proprietario della
-- funzione (superuser DB), non del chiamante applicativo.
-- Necessario se l'utente applicativo PostgreSQL ha permessi limitati.
-- ============================================================

CREATE OR REPLACE FUNCTION utente_ha_permesso(
    p_utente_id   INTEGER,
    p_codice      VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(
        -- 1. Override individuale (priorità assoluta)
        (SELECT up.concesso
         FROM utente_permesso up
         JOIN permesso p ON p.permesso_id = up.permesso_id
         WHERE up.utente_id      = p_utente_id
           AND p.codice_permesso = p_codice
         LIMIT 1),
        -- 2. Almeno un ruolo ha questo permesso?
        EXISTS (
            SELECT 1
            FROM utente_ruolo ur
            JOIN ruolo_permesso rp ON rp.ruolo_id   = ur.ruolo_id
            JOIN permesso       p  ON p.permesso_id = rp.permesso_id
            WHERE ur.utente_id      = p_utente_id
              AND p.codice_permesso = p_codice
        ),
        -- 3. Deny by default
        FALSE
    );
$$;

COMMENT ON FUNCTION utente_ha_permesso IS
    'Verifica permesso singolo: override > ruolo > FALSE.
     Per require_permission() in FastAPI:
       db.execute(text("SELECT utente_ha_permesso(:u, :c)"), {u: id, c: codice}).scalar()';


-- ============================================================
-- BLOCCO 7 — INDICI MANCANTI SU TABELLE ESISTENTI
-- ============================================================
-- Identificati analizzando i query pattern reali del backend.
-- Ciascuno è annotato con il file e la funzione che lo genera.
--
-- VERIFICA ASSENZA DUPLICATI CON MIGRATION PRECEDENTI:
--   idx_documento_titolo_versione → assente in 01-05 ✓
--   idx_documento_titolo          → assente in 01-05 ✓
--   idx_documento_sync_status     → assente (03 aggiunge solo il CHECK) ✓
--   idx_documento_attivi          → assente in 01-05 ✓
--   idx_utente_email_unique       → implicito da UNIQUE in 01_schema.sql
--                                   (creare esplicito è idempotente) ✓
--   idx_refresh_token_scadenza    → assente (05 ha solo idx_refresh_token_hash) ✓
-- ============================================================

-- loader_service.py:controlla_duplicati() → WHERE titolo=:t AND versione=:v
-- loader_service.py:aggiorna_documento()  → WHERE titolo=:t AND versione=:v AND id!=:id
-- Supporta anche il CONSTRAINT uq_documento_titolo_versione (già presente)
CREATE INDEX IF NOT EXISTS idx_documento_titolo_versione
    ON documento(titolo, versione);

-- sync_service.py:stato_documento()  → WHERE titolo=:t
-- admin.py:delete_document_full()    → WHERE titolo ILIKE '%stem%'
-- admin.py:get_document_metadata()   → WHERE titolo=:t
CREATE INDEX IF NOT EXISTS idx_documento_titolo
    ON documento(titolo);

-- sync_service.py:stato_tutti() → filtra per stati anomali
-- admin.py:list_pdfs()          → status display
CREATE INDEX IF NOT EXISTS idx_documento_sync_status
    ON documento(sync_status)
    WHERE sync_status IN ('pending', 'error', 'solo_postgres', 'solo_chroma');

-- admin.py:list_pdfs() → mostra solo documenti non archiviati
CREATE INDEX IF NOT EXISTS idx_documento_attivi
    ON documento(is_archiviato)
    WHERE is_archiviato = FALSE;

-- auth_service.py:get_current_user() → WHERE email=:e (ogni request autenticata)
-- Già coperto dall'indice UNIQUE implicito in 01_schema.sql;
-- lo rendiamo esplicito per nominarlo e documentarlo
CREATE UNIQUE INDEX IF NOT EXISTS idx_utente_email_unique
    ON utente(email);

-- Purge function (05 e 08) → DELETE WHERE scadenza < NOW()
-- Complementa idx_refresh_token_hash (migration 05) che copre verify
CREATE INDEX IF NOT EXISTS idx_refresh_token_scadenza
    ON refresh_token(scadenza)
    WHERE revocato = FALSE;


-- ============================================================
-- BLOCCO 8 — AGGIORNAMENTO FUNZIONE PURGE
-- ============================================================
-- Ridefinizione idempotente. Aggiunge safety net per override orfani
-- (ON DELETE CASCADE dovrebbe già coprirlo, ma è a costo zero).
-- ============================================================

CREATE OR REPLACE FUNCTION purge_expired_refresh_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_rt INTEGER;
    deleted_up INTEGER;
BEGIN
    DELETE FROM refresh_token
    WHERE scadenza < NOW() OR revocato = TRUE;
    GET DIAGNOSTICS deleted_rt = ROW_COUNT;

    -- Safety net: override orfani (teoricamente impossibile con CASCADE)
    DELETE FROM utente_permesso
    WHERE NOT EXISTS (
        SELECT 1 FROM utente u WHERE u.utente_id = utente_permesso.utente_id
    );
    GET DIAGNOSTICS deleted_up = ROW_COUNT;

    IF deleted_up > 0 THEN
        RAISE NOTICE 'utente_permesso: rimossi % record orfani.', deleted_up;
    END IF;

    RAISE NOTICE 'refresh_token: eliminati % record scaduti/revocati.', deleted_rt;
    RETURN deleted_rt;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- BLOCCO 9 — VERIFICA CONSTRAINT ESISTENTI
-- ============================================================
-- Aggiunge i constraint se mancano (migration parziali).
-- Idempotente: controlla prima di aggiungere.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'check_date_validita'
          AND constraint_schema = 'public'
    ) THEN
        ALTER TABLE documento ADD CONSTRAINT check_date_validita
            CHECK (data_scadenza IS NULL OR data_scadenza > data_validita_inizio);
        RAISE NOTICE 'CHECK check_date_validita aggiunto.';
    ELSE
        RAISE NOTICE 'CHECK check_date_validita gia presente, skip.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name ILIKE '%sync_status%'
          AND constraint_schema = 'public'
    ) THEN
        ALTER TABLE documento ADD CONSTRAINT chk_documento_sync_status
            CHECK (sync_status IN ('pending','synced','error','solo_postgres','solo_chroma'));
        RAISE NOTICE 'CHECK sync_status aggiunto.';
    ELSE
        RAISE NOTICE 'CHECK sync_status gia presente, skip.';
    END IF;
END $$;


-- ============================================================
-- BLOCCO 10 — ISTRUZIONI PER rag_models.py (AZIONE RICHIESTA)
-- ============================================================
-- La tabella utente_permesso NON è ancora mappata in rag_models.py.
-- Il backend funziona senza questa modifica (nessun codice esistente
-- la usa), ma aggiungere il modello ORM permette query SQLAlchemy.
--
-- Aggiungere in backend/app/models/rag_models.py:
--
--   class UtentePermesso(Base):
--       __tablename__ = "utente_permesso"
--
--       utente_id     = Column(Integer,
--                              ForeignKey("utente.utente_id", ondelete="CASCADE"),
--                              primary_key=True)
--       permesso_id   = Column(Integer,
--                              ForeignKey("permesso.permesso_id", ondelete="CASCADE"),
--                              primary_key=True)
--       concesso      = Column(Boolean, nullable=False, default=True)
--       aggiornato_da = Column(Integer,
--                              ForeignKey("utente.utente_id", ondelete="SET NULL"),
--                              nullable=True)
--       aggiornato_il = Column(DateTime(timezone=True), server_default=text('NOW()'))
--
--       utente        = relationship("Utente", foreign_keys=[utente_id],
--                                    back_populates="permessi_override")
--       permesso      = relationship("Permesso")
--       modificato_da = relationship("Utente", foreign_keys=[aggiornato_da])
--
-- Aggiungere alla classe Utente esistente:
--   permessi_override = relationship(
--       "UtentePermesso",
--       foreign_keys="[UtentePermesso.utente_id]",
--       cascade="all, delete-orphan"
--   )
-- ============================================================


-- ============================================================
-- CONFERMA FINALE
-- ============================================================
DO $$
DECLARE
    n_permessi   INTEGER;
    n_utenti     INTEGER;
    n_rp         INTEGER;
    n_override   INTEGER;
    n_superadmin INTEGER;
    n_admin      INTEGER;
    n_user       INTEGER;
BEGIN
    SELECT COUNT(*) INTO n_permessi   FROM permesso;
    SELECT COUNT(*) INTO n_utenti     FROM utente;
    SELECT COUNT(*) INTO n_rp         FROM ruolo_permesso;
    SELECT COUNT(*) INTO n_override   FROM utente_permesso;

    SELECT COUNT(*) INTO n_superadmin
        FROM ruolo_permesso rp JOIN ruolo r ON r.ruolo_id=rp.ruolo_id
        WHERE r.nome_ruolo='SuperAdmin';
    SELECT COUNT(*) INTO n_admin
        FROM ruolo_permesso rp JOIN ruolo r ON r.ruolo_id=rp.ruolo_id
        WHERE r.nome_ruolo='Admin';
    SELECT COUNT(*) INTO n_user
        FROM ruolo_permesso rp JOIN ruolo r ON r.ruolo_id=rp.ruolo_id
        WHERE r.nome_ruolo='User';

    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Migration 06 completata con successo.';
    RAISE NOTICE '----------------------------------------------';
    RAISE NOTICE 'Stato sistema:';
    RAISE NOTICE '  Utenti            : %', n_utenti;
    RAISE NOTICE '  Permessi totali   : %', n_permessi;
    RAISE NOTICE '  Assegn. ruolo->p  : %', n_rp;
    RAISE NOTICE '  Override individ. : %', n_override;
    RAISE NOTICE 'Matrice ruoli:';
    RAISE NOTICE '  SuperAdmin        : % permessi', n_superadmin;
    RAISE NOTICE '  Admin             : % permessi', n_admin;
    RAISE NOTICE '  User              : % permessi', n_user;
    RAISE NOTICE 'Oggetti creati/aggiornati:';
    RAISE NOTICE '  TABLE  utente_permesso';
    RAISE NOTICE '  VIEW   v_permessi_effettivi';
    RAISE NOTICE '  VIEW   v_matrice_permessi';
    RAISE NOTICE '  FUNC   utente_ha_permesso(utente_id, codice)';
    RAISE NOTICE '  FUNC   purge_expired_refresh_tokens() (aggiornata)';
    RAISE NOTICE '  INDEX  idx_documento_titolo_versione';
    RAISE NOTICE '  INDEX  idx_documento_titolo';
    RAISE NOTICE '  INDEX  idx_documento_sync_status (parziale)';
    RAISE NOTICE '  INDEX  idx_documento_attivi (parziale)';
    RAISE NOTICE '  INDEX  idx_utente_email_unique';
    RAISE NOTICE '  INDEX  idx_refresh_token_scadenza (parziale)';
    RAISE NOTICE '  INDEX  idx_utente_permesso_permesso';
    RAISE NOTICE '  INDEX  idx_utente_permesso_aggiornato_da (parziale)';
    RAISE NOTICE '----------------------------------------------';
    RAISE NOTICE 'AZIONE RICHIESTA: aggiornare rag_models.py';
    RAISE NOTICE '  Aggiungere classe UtentePermesso (vedi BLOCCO 10)';
    RAISE NOTICE '==============================================';
END $$;
