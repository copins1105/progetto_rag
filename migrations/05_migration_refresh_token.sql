-- 05_migration_refresh_token.sql
-- ============================================================
-- Aggiunge la tabella Refresh_Token al DB.
-- Esegui con:
--   docker exec -i policy_db_container psql -U admin -d policy_db \
--     < 05_migration_refresh_token.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS Refresh_Token (
  token_id    SERIAL      PRIMARY KEY,
  utente_id   INTEGER     NOT NULL
              REFERENCES Utente(utente_id)
              ON DELETE CASCADE,      -- se elimini l'utente, i suoi
                                      -- refresh token spariscono in cascata
  token_hash  VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 del token (32 byte → 64 hex)
                                            -- mai salviamo il token in chiaro
  scadenza    TIMESTAMPTZ NOT NULL,
  revocato    BOOLEAN     NOT NULL DEFAULT FALSE,
  ip_address  INET,                   -- da dove è stato creato
  user_agent  TEXT,                   -- browser/client (opzionale, utile per debug)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indice per la query più frequente:
-- "questo token esiste ed è valido?"
CREATE INDEX IF NOT EXISTS idx_refresh_token_hash
  ON Refresh_Token(token_hash)
  WHERE revocato = FALSE;             -- indice parziale: ignora i revocati

-- Indice per "revoca tutti i token di questo utente" (logout da tutti i device)
CREATE INDEX IF NOT EXISTS idx_refresh_token_utente
  ON Refresh_Token(utente_id);

-- Funzione per pulizia automatica token scaduti o revocati
-- (chiamata dal backend ogni notte insieme a purge_old_activity_logs)
CREATE OR REPLACE FUNCTION purge_expired_refresh_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM Refresh_Token
  WHERE scadenza < NOW()
     OR revocato = TRUE;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Refresh_Token: eliminati % record scaduti/revocati', deleted_count;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  RAISE NOTICE 'Migration 05 completata: tabella Refresh_Token creata.';
END $$;
