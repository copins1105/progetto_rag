-- 1. ESTENSIONI
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. TABELLE DI GOVERNANCE
CREATE TABLE Tipo_Documento (
    id_tipo SERIAL PRIMARY KEY, 
    nome_tipo VARCHAR(50) UNIQUE NOT NULL, -- Es: 'Policy', 'Manuale', 'Regolamento'
    estensione_file VARCHAR(10)            -- Es: 'PDF', 'DOCX'
);

CREATE TABLE Livello_Riservatezza (
    id_livello SERIAL PRIMARY KEY, 
    nome_livello VARCHAR(50) UNIQUE NOT NULL -- Es: 'Pubblico', 'Interno', 'Riservato'
);

-- 3. TABELLE DI SICUREZZA E CONTROLLO ACCESSI (IAM)
CREATE TABLE Utente (
    utente_id SERIAL PRIMARY KEY, 
    email VARCHAR(255) UNIQUE NOT NULL, 
    password_hash VARCHAR(255) NOT NULL, 
    nome VARCHAR(100), 
    cognome VARCHAR(100),
    data_creazione TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Ruolo (
    ruolo_id SERIAL PRIMARY KEY, 
    nome_ruolo VARCHAR(50) UNIQUE NOT NULL,
    descrizione VARCHAR(255)
);

CREATE TABLE Permesso (
    permesso_id SERIAL PRIMARY KEY, 
    codice_permesso VARCHAR(50) UNIQUE NOT NULL, -- Es: 'DOC_UPLOAD'
    descrizione VARCHAR(255)                     -- Spiegazione del permesso
);

CREATE TABLE Utente_Ruolo (
    utente_id INTEGER REFERENCES Utente(utente_id) ON DELETE CASCADE, 
    ruolo_id INTEGER REFERENCES Ruolo(ruolo_id) ON DELETE CASCADE, 
    PRIMARY KEY (utente_id, ruolo_id)
);

CREATE TABLE Ruolo_Permesso (
    ruolo_id INTEGER REFERENCES Ruolo(ruolo_id) ON DELETE CASCADE, 
    permesso_id INTEGER REFERENCES Permesso(permesso_id) ON DELETE CASCADE, 
    PRIMARY KEY (ruolo_id, permesso_id)
);

-- 4. CORE RAG (Ottimizzato per BGE-M3: 1024)
CREATE TABLE Documento (
    documento_id SERIAL PRIMARY KEY, 
    id_tipo INTEGER REFERENCES Tipo_Documento(id_tipo), 
    id_livello INTEGER REFERENCES Livello_Riservatezza(id_livello), 
    titolo VARCHAR(255) NOT NULL,
    versione VARCHAR(50) NOT NULL,
    data_validita_inizio DATE NOT NULL,
    data_scadenza DATE,
    is_archiviato BOOLEAN DEFAULT FALSE, -- Gestione manuale amministratore
    id_utente_caricamento INTEGER REFERENCES Utente(utente_id),
    data_caricamento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_documento_titolo_versione UNIQUE (titolo, versione),
    CONSTRAINT check_date_validita CHECK (data_scadenza IS NULL OR data_scadenza > data_validita_inizio)
);

-- 5. LOG E METRICHE
CREATE TABLE Log_Risposta (
    log_id SERIAL PRIMARY KEY, 
    utente_id INTEGER REFERENCES Utente(utente_id), 
    testo_domanda TEXT NOT NULL, 
    testo_risposta TEXT, 
    tempo_risposta_ms INTEGER CHECK (tempo_risposta_ms >= 0), 
    feedback_csat SMALLINT CHECK (feedback_csat BETWEEN 1 AND 5),
    timestamp_query TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
