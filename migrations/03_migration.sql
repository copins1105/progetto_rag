-- 03_migration.sql
-- Migration incrementale — aggiunge sync_status a Documento e crea Sync_Log
-- Eseguire manualmente con:
--   docker exec -i policy_db_container psql -U admin -d policy_db < 03_migration.sql

-- 1. Aggiunge sync_status a Documento (se non esiste già)
ALTER TABLE Documento
ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT 'synced'
    CHECK (sync_status IN ('pending', 'synced', 'error', 'solo_postgres', 'solo_chroma'));

-- Tutti i documenti già presenti vengono marcati come synced
UPDATE Documento SET sync_status = 'synced' WHERE sync_status IS NULL;

-- 2. Crea tabella Sync_Log per tracciare eventi di sincronizzazione
CREATE TABLE IF NOT EXISTS Sync_Log (
    log_id       SERIAL PRIMARY KEY,
    documento_id INTEGER REFERENCES Documento(documento_id) ON DELETE CASCADE,
    evento       VARCHAR(50)  NOT NULL,  -- es: 'load', 'delete', 'rollback', 'mismatch'
    dettaglio    TEXT,                   -- messaggio descrittivo dell'evento
    esito        VARCHAR(20)  NOT NULL DEFAULT 'ok'
        CHECK (esito IN ('ok', 'warning', 'error')),
    timestamp    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indice per query veloci per documento
CREATE INDEX IF NOT EXISTS idx_sync_log_documento
    ON Sync_Log(documento_id);

-- 3. Conferma
DO $$
BEGIN
    RAISE NOTICE 'Migration 03 completata con successo.';
END $$;
