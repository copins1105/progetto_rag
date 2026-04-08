-- ============================================================
-- 04_migration_log_e_ruoli.sql
-- ============================================================
-- Esegui con:
--   docker exec -i policy_db_container psql -U admin -d policy_db \
--     < 04_migration_log_e_ruoli.sql
-- ============================================================


-- ============================================================
-- BLOCCO 1 — RUOLI
-- ============================================================
-- Aggiungiamo SuperAdmin ai ruoli esistenti (Admin e User
-- sono già presenti dal seed 02_seed.sql).
-- Usiamo INSERT ... ON CONFLICT DO NOTHING per idempotenza:
-- puoi rieseguire lo script senza errori.
-- ============================================================

INSERT INTO Ruolo (nome_ruolo, descrizione)
VALUES ('SuperAdmin', 'Accesso totale: tutti i documenti, tutti i log, tutti gli utenti')
ON CONFLICT (nome_ruolo) DO NOTHING;

-- Verifica stato ruoli
DO $$
BEGIN
  RAISE NOTICE 'Ruoli presenti: SuperAdmin, Admin, User';
END $$;


-- ============================================================
-- BLOCCO 2 — OWNERSHIP DOCUMENTI
-- ============================================================
-- Ogni documento deve sapere quale Admin lo ha caricato.
-- Aggiungiamo id_utente_caricamento a Documento (già previsto
-- nello schema originale come nullable — lo attiviamo).
--
-- LOGICA DI VISIBILITÀ:
--   SuperAdmin  → WHERE 1=1          (vede tutto)
--   Admin       → WHERE id_utente_caricamento = :me
--   User        → non accede al pannello admin
-- ============================================================

-- La colonna esiste già nello schema 01, ma potrebbe essere
-- nullable senza FK attiva. La rinforziamo.
ALTER TABLE Documento
  ALTER COLUMN id_utente_caricamento SET DEFAULT NULL;

-- Indice per le query "dammi i documenti di questo admin"
CREATE INDEX IF NOT EXISTS idx_documento_utente
  ON Documento(id_utente_caricamento);

-- Verifica: quanti documenti hanno già un owner?
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM Documento WHERE id_utente_caricamento IS NOT NULL;
  RAISE NOTICE 'Documenti con owner: %', n;
END $$;


-- ============================================================
-- BLOCCO 3 — ACTIVITY_LOG
-- ============================================================
-- Tabella di audit per TUTTE le azioni non-chat.
-- Separata da Log_Risposta (quella è per le metriche chatbot).
--
-- SCHEMA DECISIONALE:
--   azione      → stringa enum-like, indice su questa colonna
--                 per filtrare "tutti i login" o "tutti gli upload"
--   dettaglio   → JSONB (non JSON) per query tipo:
--                   WHERE dettaglio->>'filename' = 'policy.pdf'
--                   WHERE dettaglio->>'target_email' LIKE '%mario%'
--   ip_address  → INET (tipo nativo PostgreSQL, non VARCHAR)
--                 permette query come ip >> '192.168.0.0/24'
--   esito       → 'ok' | 'error' — utile per filtrare i fallimenti
--   timestamp   → TIMESTAMPTZ (con timezone) — best practice
--                 per sistemi multi-timezone o cloud
--
-- AZIONI PREVISTE (aggiungine altre senza ALTER TABLE):
--   Auth:     login, logout, password_changed, profile_updated
--   Docs:     doc_upload, doc_ingestion, doc_load,
--             doc_update, doc_delete
--   Users:    user_created, user_updated, user_deleted
-- ============================================================

CREATE TABLE IF NOT EXISTS Activity_Log (
  log_id      BIGSERIAL PRIMARY KEY,          -- BIGSERIAL per volumi alti

  utente_id   INTEGER
              REFERENCES Utente(utente_id)
              ON DELETE SET NULL,             -- se l'utente viene eliminato,
                                              -- il log rimane (audit trail)
  azione      VARCHAR(50)  NOT NULL,
  dettaglio   JSONB        DEFAULT '{}',      -- JSONB: indicizzabile, queryabile
  ip_address  INET,                           -- tipo nativo PostgreSQL
  esito       VARCHAR(10)  NOT NULL DEFAULT 'ok'
              CHECK (esito IN ('ok', 'error', 'warning')),
  timestamp   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Indici strategici ────────────────────────────────────────
-- Questi indici coprono i pattern di query del pannello admin:

-- 1. "Mostrami tutti i log di questo utente" (vista Admin)
CREATE INDEX IF NOT EXISTS idx_actlog_utente
  ON Activity_Log(utente_id, timestamp DESC);

-- 2. "Filtra per tipo azione" (es. tutti i login)
CREATE INDEX IF NOT EXISTS idx_actlog_azione
  ON Activity_Log(azione, timestamp DESC);

-- 3. "Log degli ultimi N giorni" (query temporali)
CREATE INDEX IF NOT EXISTS idx_actlog_timestamp
  ON Activity_Log(timestamp DESC);

-- 4. Indice GIN su JSONB per query sui dettagli
--    es: WHERE dettaglio @> '{"filename": "policy.pdf"}'
CREATE INDEX IF NOT EXISTS idx_actlog_dettaglio_gin
  ON Activity_Log USING GIN (dettaglio);


-- ============================================================
-- BLOCCO 4 — ESTENSIONE Log_Risposta (chatbot metrics)
-- ============================================================
-- Aggiungiamo due colonne utili per correlare le chat
-- con i documenti effettivamente usati nella risposta.
--
-- session_id:        permette di raggruppare domande della
--                    stessa sessione (già usato nel frontend)
-- documento_ids:     array degli ID documento usati dal RAG
--                    per rispondere — utile per capire quali
--                    documenti vengono consultati di più
-- ============================================================

ALTER TABLE Log_Risposta
  ADD COLUMN IF NOT EXISTS session_id      VARCHAR(64),
  ADD COLUMN IF NOT EXISTS documento_ids  INTEGER[]  DEFAULT '{}';

-- Indice per "quante volte è stato usato il documento X?"
CREATE INDEX IF NOT EXISTS idx_logrisposta_docs
  ON Log_Risposta USING GIN (documento_ids);

-- Indice per raggruppare per sessione
CREATE INDEX IF NOT EXISTS idx_logrisposta_session
  ON Log_Risposta(session_id);


-- ============================================================
-- BLOCCO 5 — RETENTION AUTOMATICA 90 GIORNI
-- ============================================================
-- PostgreSQL non ha un job scheduler nativo come MySQL Event
-- Scheduler. Le opzioni professionali sono:
--
--   A) pg_cron  (estensione PostgreSQL — la migliore)
--   B) Funzione + chiamata periodica dal backend (cron Python)
--   C) Trigger su INSERT che pulisce i vecchi (sconsigliato
--      per performance: ogni insert fa una DELETE)
--
-- Usiamo l'approccio B come fallback universale:
-- una funzione SQL che il backend chiama ogni notte.
-- Se hai pg_cron disponibile, decommentare il blocco C.
--
-- La funzione cancella i log più vecchi di 90 giorni
-- in batch da 1000 righe per non bloccare il DB.
-- ============================================================

CREATE OR REPLACE FUNCTION purge_old_activity_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
  batch         INTEGER;
  cutoff        TIMESTAMPTZ := NOW() - INTERVAL '90 days';
BEGIN
  LOOP
    DELETE FROM Activity_Log
    WHERE log_id IN (
      SELECT log_id FROM Activity_Log
      WHERE timestamp < cutoff
      LIMIT 1000          -- batch size: non blocca il DB
    );

    GET DIAGNOSTICS batch = ROW_COUNT;
    deleted_count := deleted_count + batch;

    EXIT WHEN batch = 0;  -- nessun altro record da eliminare
    PERFORM pg_sleep(0.1); -- pausa 100ms tra i batch
  END LOOP;

  RAISE NOTICE 'Activity_Log: eliminati % record più vecchi di 90 giorni', deleted_count;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ── OPZIONE A: pg_cron (decommentare se disponibile) ────────
-- Esegue purge ogni notte alle 03:00
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule(
--   'purge-activity-log',
--   '0 3 * * *',
--   'SELECT purge_old_activity_logs()'
-- );

-- ── OPZIONE B: chiamata dal backend (vedere log_service.py) ──
-- Il backend chiama SELECT purge_old_activity_logs()
-- ogni notte tramite APScheduler o cron di sistema.
-- Nessuna configurazione SQL aggiuntiva necessaria.


-- ============================================================
-- BLOCCO 6 — VIEW PER IL PANNELLO ADMIN
-- ============================================================
-- Queste view pre-costruiscono le query più comuni
-- del pannello admin, semplificando il codice Python.
-- ============================================================

-- View: log arricchiti con nome utente (per la lista log)
CREATE OR REPLACE VIEW v_activity_log_full AS
SELECT
  al.log_id,
  al.timestamp,
  al.azione,
  al.dettaglio,
  al.ip_address,
  al.esito,
  al.utente_id,
  u.email          AS utente_email,
  u.nome           AS utente_nome,
  u.cognome        AS utente_cognome,
  -- Ruolo dell'utente al momento del log (join)
  STRING_AGG(r.nome_ruolo, ', ') AS utente_ruoli
FROM Activity_Log al
LEFT JOIN Utente       u  ON u.utente_id  = al.utente_id
LEFT JOIN Utente_Ruolo ur ON ur.utente_id = al.utente_id
LEFT JOIN Ruolo        r  ON r.ruolo_id   = ur.ruolo_id
GROUP BY
  al.log_id, al.timestamp, al.azione, al.dettaglio,
  al.ip_address, al.esito, al.utente_id,
  u.email, u.nome, u.cognome;

-- View: statistiche aggregate per dashboard SuperAdmin
CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
  -- Utenti
  (SELECT COUNT(*) FROM Utente)                                    AS tot_utenti,
  (SELECT COUNT(DISTINCT ur.utente_id)
   FROM Utente_Ruolo ur JOIN Ruolo r ON r.ruolo_id = ur.ruolo_id
   WHERE r.nome_ruolo = 'Admin')                                   AS tot_admin,

  -- Documenti
  (SELECT COUNT(*) FROM Documento WHERE is_archiviato = FALSE)     AS tot_documenti,
  (SELECT COUNT(*) FROM Documento
   WHERE data_caricamento >= NOW() - INTERVAL '7 days')            AS doc_ultima_settimana,

  -- Chat
  (SELECT COUNT(*) FROM Log_Risposta
   WHERE timestamp_query >= NOW() - INTERVAL '24 hours')           AS chat_ultime_24h,
  (SELECT COUNT(*) FROM Log_Risposta
   WHERE timestamp_query >= NOW() - INTERVAL '7 days')             AS chat_ultima_settimana,
  (SELECT ROUND(AVG(tempo_risposta_ms))
   FROM Log_Risposta
   WHERE timestamp_query >= NOW() - INTERVAL '7 days')             AS avg_response_ms_7d,

  -- Activity Log
  (SELECT COUNT(*) FROM Activity_Log
   WHERE azione = 'login'
   AND timestamp >= NOW() - INTERVAL '24 hours')                   AS login_ultime_24h,
  (SELECT COUNT(*) FROM Activity_Log
   WHERE esito = 'error'
   AND timestamp >= NOW() - INTERVAL '7 days')                     AS errori_ultima_settimana;


-- ============================================================
-- BLOCCO 7 — DATI INIZIALI DI TEST (opzionale)
-- ============================================================
-- Crea un SuperAdmin di default per il primo accesso.
-- IMPORTANTE: cambia la password subito dopo il primo login!
--
-- Hash bcrypt di "SuperAdmin123!" generato con:
--   python -c "from passlib.context import CryptContext;
--              print(CryptContext(['bcrypt']).hash('SuperAdmin123!'))"
-- ============================================================

-- Inserisce SuperAdmin solo se non esiste già
DO $$
DECLARE
  v_utente_id INTEGER;
  v_ruolo_id  INTEGER;
BEGIN
  -- Controlla se esiste già un SuperAdmin
  SELECT ur.utente_id INTO v_utente_id
  FROM Utente_Ruolo ur
  JOIN Ruolo r ON r.ruolo_id = ur.ruolo_id
  WHERE r.nome_ruolo = 'SuperAdmin'
  LIMIT 1;

  IF v_utente_id IS NULL THEN
    -- Inserisci utente SuperAdmin
    INSERT INTO Utente (email, password_hash, nome, cognome)
    VALUES (
      'superadmin@azienda.it',
      -- Hash di 'SuperAdmin123!' — CAMBIARE SUBITO IN PRODUZIONE
      '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYpfQN6HOkN2fge',
      'Super', 'Admin'
    )
    RETURNING utente_id INTO v_utente_id;

    -- Assegna ruolo SuperAdmin
    SELECT ruolo_id INTO v_ruolo_id FROM Ruolo WHERE nome_ruolo = 'SuperAdmin';
    INSERT INTO Utente_Ruolo (utente_id, ruolo_id) VALUES (v_utente_id, v_ruolo_id);

    RAISE NOTICE 'SuperAdmin creato: superadmin@azienda.it (password: SuperAdmin123!)';
    RAISE NOTICE 'ATTENZIONE: cambia la password al primo accesso!';
  ELSE
    RAISE NOTICE 'SuperAdmin già presente, skip.';
  END IF;
END $$;


-- ============================================================
-- CONFERMA FINALE
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Migration 04 completata con successo.';
  RAISE NOTICE 'Riepilogo:';
  RAISE NOTICE '  - Ruolo SuperAdmin aggiunto';
  RAISE NOTICE '  - Indice ownership documenti creato';
  RAISE NOTICE '  - Tabella Activity_Log creata con 4 indici';
  RAISE NOTICE '  - Log_Risposta estesa (session_id, documento_ids)';
  RAISE NOTICE '  - Funzione purge_old_activity_logs() creata';
  RAISE NOTICE '  - View v_activity_log_full creata';
  RAISE NOTICE '  - View v_dashboard_stats creata';
  RAISE NOTICE '  - SuperAdmin di default creato';
  RAISE NOTICE '==============================================';
END $$;
