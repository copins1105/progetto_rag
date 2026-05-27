# 🛠️ Guida all'installazione passo-passo

Questa guida ti porta dall'installazione zero a un sistema funzionante. Segui i passi nell'ordine indicato.

---

## Indice

1. [Requisiti di sistema](#1-requisiti-di-sistema)
2. [Installazione Docker](#2-installazione-docker)
3. [Installazione Ollama + modello embedding](#3-installazione-ollama--modello-embedding)
4. [Clonare il repository](#4-clonare-il-repository)
5. [Configurare l'ambiente Python](#5-configurare-lambiente-python)
6. [Configurare le variabili d'ambiente](#6-configurare-le-variabili-dambiente)
7. [Avviare i database](#7-avviare-i-database)
8. [Inizializzare il database](#8-inizializzare-il-database)
9. [Avviare il backend](#9-avviare-il-backend)
10. [Caricare il primo documento](#10-caricare-il-primo-documento)
11. [Verificare che tutto funzioni](#11-verificare-che-tutto-funzioni)

---

## 1. Requisiti di sistema

| Requisito | Minimo | Consigliato |
|-----------|--------|-------------|
| OS | Windows 10, macOS 12, Ubuntu 22.04 | Ubuntu 22.04 LTS |
| RAM | 8 GB | 16 GB |
| Spazio disco | 10 GB | 30 GB |
| Python | 3.11 | 3.11+ |
| Docker | 24.x | ultima versione |
| Connessione internet | ✅ (per Mistral API) | ✅ |

> **Pipeline Marker (opzionale):** richiede almeno 8 GB RAM aggiuntivi per i modelli OCR surya. Non è necessaria se si usa la pipeline Mistral (consigliata).

---

## 2. Installazione Docker

### Windows / macOS

Scarica e installa [Docker Desktop](https://www.docker.com/products/docker-desktop/).

### Ubuntu / Debian

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version  # verifica
```

---

## 3. Installazione Ollama + modello embedding

Ollama gestisce il modello di embedding in locale. È necessario anche se si usa Mistral per l'OCR.

### Installazione Ollama

```bash
# Linux / macOS
curl -fsSL https://ollama.com/install.sh | sh

# Windows: scarica da https://ollama.com/download/windows
```

### Scarica il modello di embedding

```bash
ollama pull qwen3-embedding:0.6b
```

Il download è circa 500 MB. Al termine, verifica:

```bash
ollama list
# dovresti vedere: qwen3-embedding:0.6b
```

### Verifica che Ollama risponda

```bash
curl http://localhost:11434/api/embeddings \
  -d '{"model":"qwen3-embedding:0.6b","prompt":"test di connessione"}'
# risponde con: {"embedding":[...numeri...]}
```

---

## 4. Clonare il repository

```bash
git clone https://github.com/<tuo-username>/policy-navigator.git
cd policy-navigator
```

---

## 5. Configurare l'ambiente Python

Consigliamo un ambiente virtuale dedicato:

```bash
# Crea l'ambiente virtuale
python -m venv .venv

# Attivalo
# Linux / macOS:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

# Installa le dipendenze
pip install --upgrade pip
pip install -r backend/requirements.txt
```

> **Nota sulla pipeline Marker:** se vuoi usare `INGESTION_PIPELINE=marker`, installa anche:
> ```bash
> pip install marker-pdf torch
> ```
> Questi pacchetti sono pesanti (~3 GB) e non inclusi nel `requirements.txt` base.

---

## 6. Configurare le variabili d'ambiente

```bash
cd backend
cp .env.example .env
```

Apri `.env` con un editor e compila almeno questi campi:

### Campi obbligatori

```dotenv
# La tua API key Mistral (https://console.mistral.ai/)
MISTRAL_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Chiave JWT sicura (genera con il comando qui sotto)
JWT_SECRET_KEY="output-del-comando-sotto"

# Percorsi assoluti alle cartelle del backend
STATIC_DIR=/home/utente/policy-navigator/backend/static
PDF_DIR=/home/utente/policy-navigator/backend/data
MISTRAL_OUTPUT_DIR=/home/utente/policy-navigator/backend/output_json_mistral
MISTRAL_CHUNKS_DIR=/home/utente/policy-navigator/backend/chunks_mistral
```

### Genera JWT_SECRET_KEY

```bash
python -c "import secrets; print(secrets.token_hex(32))"
# copia l'output nel .env
```

### Crea le cartelle necessarie

```bash
mkdir -p backend/static backend/data \
         backend/output_json backend/chunks \
         backend/output_json_mistral backend/chunks_mistral
```

---

## 7. Avviare i database

### Pipeline Mistral (consigliata)

```bash
docker compose up -d db_mistral chroma_mistral
```

### Pipeline Marker

```bash
docker compose up -d db_marker chroma_marker
```

### Entrambe le pipeline

```bash
docker compose up -d
```

### Verifica che i container girino

```bash
docker compose ps
# Stato atteso: "running" per tutti i servizi avviati

# Test connessione ChromaDB
curl http://localhost:8001/api/v1/heartbeat
# risposta: {"nanosecond heartbeat": <numero>}
```

---

## 8. Inizializzare il database

Esegui le migrazioni nell'ordine corretto. Sostituisci `policy_db_mistral` con `policy_db_marker` se usi la pipeline Marker.

```bash
# Dalla radice del repository
CONTAINER=policy_db_mistral

docker exec -i $CONTAINER psql -U admin -d policy_db < sql_scripts/01_schema.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < sql_scripts/02_seed.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < migrations/03_migration.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < migrations/04_migration_log_e_ruoli.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < migrations/05_migration_refresh_token.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < migrations/06_migration_rbac_matrix.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < migrations/07_migration_ownership.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < migrations/08_migration_chat_history.sql
docker exec -i $CONTAINER psql -U admin -d policy_db < migrations/09_migration_sources_json.sql
```

Alla fine di ogni script dovresti vedere messaggi `NOTICE` di conferma.

### Verifica le tabelle create

```bash
docker exec -it $CONTAINER psql -U admin -d policy_db -c "\dt"
```

Dovresti vedere circa 15-18 tabelle tra cui: `documento`, `utente`, `ruolo`, `chat_sessione`, ecc.

---

## 9. Avviare il backend

```bash
cd backend
source ../.venv/bin/activate  # se non già attivo

uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

Al primo avvio vedrai log tipo:
```
INFO  🔧 Pipeline attiva : MISTRAL
INFO  🐘 PostgreSQL      : postgresql://admin:***@localhost:5433/policy_db
INFO  🟣 ChromaDB        : localhost:8001
INFO  📚 Collection      : documenti_semantici_mistral
INFO  Application startup complete.
```

### Test rapido

```bash
curl http://localhost:8080/
# risposta: {"status":"online","pipeline":"mistral","model":"mistral-small-latest","services":"active"}
```

### Documentazione API interattiva

Apri nel browser: `http://localhost:8080/docs`

---

## 10. Caricare il primo documento

### Via pannello Admin (raccomandato)

1. Apri il frontend (se disponibile) o usa le API direttamente
2. Fai login con le credenziali SuperAdmin:
   - Email: `superadmin@azienda.it`
   - Password: `SuperAdmin123!`
3. Vai al tab **Ingestion**
4. Carica un PDF con il pulsante Upload
5. Clicca **Converti** → attendi la pipeline OCR (1-3 min per Mistral, 5-15 min per Marker)
6. Vai al tab **Loader**, compila i metadati (tipo, riservatezza, date) e clicca **Carica**
7. Il documento è ora interrogabile via chat

### Via API (curl)

```bash
BASE=http://localhost:8080/api/v1

# 1. Login
TOKEN=$(curl -s -X POST "$BASE/auth/token" \
  -F "username=superadmin@azienda.it" \
  -F "password=SuperAdmin123!" | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Upload PDF
curl -X POST "$BASE/admin/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/percorso/al/documento.pdf"

# 3. Avvia ingestion
JOB=$(curl -s -X POST "$BASE/admin/ingest/documento.pdf" \
  -H "Authorization: Bearer $TOKEN" | python -c "import sys,json; print(json.load(sys.stdin)['job_id'])")

# 4. Attendi il completamento (WebSocket o polling)
echo "Job ID: $JOB — controlla i log nel pannello admin"
```

---

## 11. Verificare che tutto funzioni

### Checklist finale

```bash
# ✅ Docker container attivi
docker compose ps | grep running

# ✅ ChromaDB raggiungibile
curl http://localhost:8001/api/v1/heartbeat

# ✅ Ollama attivo con il modello
ollama list | grep qwen3-embedding

# ✅ Backend attivo
curl http://localhost:8080/

# ✅ Login funzionante
curl -X POST http://localhost:8080/api/v1/auth/token \
  -F "username=superadmin@azienda.it" \
  -F "password=SuperAdmin123!" | python -m json.tool
```

### Test chat (dopo aver caricato almeno un documento)

```bash
# Usa il token ottenuto sopra
curl -X POST http://localhost:8080/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"Come funziona la policy ferie?","session_id":"test-session-001"}'
```

---

## Prossimi passi

- Cambia la password del SuperAdmin dal pannello profilo
- Crea un Admin dedicato per ogni team
- Carica i documenti aziendali e verifica la qualità del retrieval
- Configura il frontend React (repository separato)

Per problemi, consulta la sezione [FAQ e troubleshooting nel README](../README.md#faq-e-troubleshooting).
