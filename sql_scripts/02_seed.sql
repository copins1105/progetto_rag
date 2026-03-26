--- 1. GOVERNANCE ---
INSERT INTO Tipo_Documento (nome_tipo, estensione_file) VALUES 
('Policy Aziendale', 'PDF'),
('Manuale Operativo', 'PDF'),
('Regolamento', 'PDF'),
('Procedura', 'PDF'),
('Codice Etico', 'PDF'),
('Altro','PDF');

INSERT INTO Livello_Riservatezza (nome_livello) VALUES 
('Pubblico'),
('Uso Interno'),
('Riservato');

--- 2. SICUREZZA ---
INSERT INTO Ruolo (nome_ruolo, descrizione) VALUES 
('Admin', 'Gestione totale del sistema'),
('User', 'Sola consultazione');

INSERT INTO Permesso (codice_permesso, descrizione) VALUES 
('DOC_UPLOAD', 'Permette di caricare documenti'),
('DOC_DELETE', 'Permette di eliminare documenti');

--- 3. UTENTE DI TEST ---
INSERT INTO Utente (email, password_hash, nome, cognome) VALUES 
('test@azienda.it', 'hash_di_prova_123', 'Mario', 'Rossi');