# 🤖 Policy Navigator — RAG Chatbot per Documentazione Aziendale

Policy Navigator è un sistema RAG (Retrieval-Augmented Generation) completo per la ricerca semantica su documenti aziendali (policy, manuali, procedure, regolamenti). Permette di caricare PDF, indicizzarli su ChromaDB + PostgreSQL, e interrogarli via chatbot con LLM.

---

## 📚 Documentazione completa

| Documento | Descrizione |
|-----------|-------------|
| **Sei qui** — `README.md` | Panoramica, architettura, API reference, ruoli |
| [`SETUP.md`](SETUP.md) | Guida installazione passo-passo (Docker, Ollama, migrazioni, primo avvio) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Schema database, pipeline ingestion, RAG chain, guida per sviluppatori |
| [`frontend/GUIDA_OPERATIVA.md`](frontend/GUIDA_OPERATIVA.md) | Guida frontend: setup Node, build, pannello admin, gestione utenti, audit |

---

## 📋 Indice

- [Architettura](#architettura)
- [Prerequisiti](#prerequisiti)
- [Installazione rapida](#installazione-rapida)
- [Configurazione `.env`](#configurazione-env)
- [Avvio dei servizi](#avvio-dei-servizi)
- [Pipeline di ingestion documenti](#pipeline-di-ingestion-documenti)
- [Struttura del progetto](#struttura-del-progetto)
- [API Reference](#api-reference)
- [Migrazioni database](#migrazioni-database)
- [Ruoli e permessi](#ruoli-e-permessi)
- [FAQ e troubleshooting](#faq-e-troubleshooting)

---

## Architettura

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend React                       │
│               (chat UI + pannello Admin)                    │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / WebSocket
┌────────────────────────▼────────────────────────────────────┐
│              Backend FastAPI  (main.py)                     │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  /api/v1/    │  │  /api/v1/    │  │   /api/v1/       │   │
│  │    chat      │  │    admin     │  │    auth          │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘   │
│         │                 │                                 │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │            RAG Chain (LangGraph)                     │   │
│  │  guard → query (HyDE) → routing → retrieval →        │   │
│  │  relevance → answer → summary                        │   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │                                       │
│  ┌──────────────────▼──────────┐  ┌──────────────────────┐  │
│  │   SearchService (BM25 +     │  │  PostgreSQL          │  │
│  │   ChromaDB vettoriale)      │  │  (metadati + RBAC)   │  │
│  └─────────────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

Pipeline Ingestion (due varianti):
  PDF → [Marker locale] → Markdown → Chunker → JSON → Loader → ChromaDB + PostgreSQL
  PDF → [Mistral OCR API] ──────────────────→ JSON → Loader → ChromaDB + PostgreSQL
```

### Stack tecnologico

| Componente | Tecnologia |
|---|---|
| Backend | FastAPI + Python 3.11 |
| LLM | Mistral (via API) |
| Embedding | `qwen3-embedding:0.6b` (Ollama locale) |
| Vector DB | ChromaDB (HTTP client) |
| Relational DB | PostgreSQL 15 + pgvector |
| RAG Framework | LangChain + LangGraph |
| OCR Pipeline A | Marker (locale, CPU) |
| OCR Pipeline B | Mistral OCR API |
| Auth | JWT (access + refresh token) + bcrypt |
| Container | Docker Compose |

---

## Prerequisiti

- **Docker** e **Docker Compose** v2+
- **Python 3.11+**
- **Ollama** installato localmente (per gli embedding)
- Account **Mistral AI** con API key (per la pipeline Mistral OCR e/o l'LLM)
- (Opzionale) GPU o almeno 8 GB RAM per la pipeline Marker

---

## Installazione rapida

### 1. Clona il repository

```bash
git clone https://github.com/<tuo-username>/policy-navigator.git
cd policy-navigator
```

### 2. Avvia i database con Docker

```bash
docker compose up -d db_marker chroma_marker
# oppure, per la pipeline Mistral:
docker compose up -d db_mistral chroma_mistral
```

### 3. Installa il modello di embedding con Ollama

```bash
ollama pull qwen3-embedding:0.6b
```

### 4. Installa le dipendenze Python

```bash
cd backend
pip install -r requirements.txt
```

### 5. Configura il file `.env`

Copia il file di esempio e compilalo (vedi sezione [Configurazione `.env`](#configurazione-env)):

```bash
cp .env.example .env
# modifica .env con i tuoi valori
```

### 6. Esegui le migrazioni database

```bash
# Prima esegui lo schema base, poi le migrazioni in ordine
docker exec -i policy_db_marker psql -U admin -d policy_db < sql_scripts/01_schema.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < sql_scripts/02_seed.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < migrations/03_migration.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < migrations/04_migration_log_e_ruoli.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < migrations/05_migration_refresh_token.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < migrations/06_migration_rbac_matrix.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < migrations/07_migration_ownership.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < migrations/08_migration_chat_history.sql
docker exec -i policy_db_marker psql -U admin -d policy_db < migrations/09_migration_sources_json.sql
```

### 7. Avvia il backend

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

Il backend sarà disponibile su `http://localhost:8080`.

---

## Configurazione `.env`

Crea `backend/.env` con questo contenuto (vedi anche `backend/.env.example`):

```dotenv
# ── PIPELINE ───────────────────────────────────────────────
# "marker"  → OCR locale con Marker (richiede modelli locali ~600MB+)
# "mistral" → OCR cloud con Mistral API (consigliato, zero setup locale)
INGESTION_PIPELINE=mistral

# ── DATABASE PIPELINE MARKER (porta 5432 / ChromaDB 8000) ──
MARKER_DATABASE_URL="postgresql://admin:POLICYNAVIGATOR@localhost:5432/policy_db"
MARKER_CHROMA_HOST="localhost"
MARKER_CHROMA_PORT="8000"
MARKER_CHROMA_COLLECTION_NAME="documenti_semantici"

# ── DATABASE PIPELINE MISTRAL (porta 5433 / ChromaDB 8001) ─
MISTRAL_DATABASE_URL="postgresql://admin:POLICYNAVIGATOR@localhost:5433/policy_db"
MISTRAL_CHROMA_HOST="localhost"
MISTRAL_CHROMA_PORT="8001"
MISTRAL_CHROMA_COLLECTION_NAME="documenti_semantici_mistral"

# ── MISTRAL API ─────────────────────────────────────────────
MISTRAL_API_KEY="la-tua-api-key-mistral"
MISTRAL_OCR_MODEL=mistral-ocr-latest

# ── JWT ─────────────────────────────────────────────────────
# Genera con: python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET_KEY="stringa-casuale-minimo-32-caratteri"
JWT_ALGORITHM=HS256
JWT_ACCESS_EXPIRE_MINUTES=15
JWT_REFRESH_EXPIRE_DAYS=30
ENVIRONMENT=development

# ── CARTELLE (percorsi assoluti) ────────────────────────────
STATIC_DIR=/percorso/assoluto/backend/static
PDF_DIR=/percorso/assoluto/backend/data

MARKER_OUTPUT_DIR=/percorso/assoluto/backend/output_json
MARKER_CHUNKS_DIR=/percorso/assoluto/backend/chunks

MISTRAL_OUTPUT_DIR=/percorso/assoluto/backend/output_json_mistral
MISTRAL_CHUNKS_DIR=/percorso/assoluto/backend/chunks_mistral
```

> **Nota:** non committare mai il file `.env` reale. È già incluso nel `.gitignore`.

---

## Avvio dei servizi

### Avvio completo (entrambe le pipeline)

```bash
docker compose up -d
```

### Avvio selettivo (solo pipeline Marker)

```bash
docker compose up -d db_marker chroma_marker
```

### Avvio selettivo (solo pipeline Mistral)

```bash
docker compose up -d db_mistral chroma_mistral
```

### Verifica stato container

```bash
docker compose ps
```

### Log database

```bash
docker logs policy_db_marker
docker logs chromadb_marker
```

---

## Pipeline di ingestion documenti

Ogni PDF passa attraverso tre fasi prima di essere interrogabile via chat.

### Fase 1 — Upload

Tramite il pannello Admin (`/admin`) carica il PDF. Il file viene salvato nella cartella `data/`.

### Fase 2 — Ingestion (conversione in chunk)

Avvia la pipeline dal pannello Admin cliccando **Converti**. Il processo (asincrono, con log in tempo reale via WebSocket) esegue:

**Pipeline Marker (locale):**
```
PDF → Marker (OCR) → _raw.md → Postprocessor → .md pulito → Chunker → _chunks.json
```

**Pipeline Mistral (cloud):**
```
PDF → Mistral OCR API → pagine Markdown → Chunker ibrido → _chunks.json
```

### Fase 3 — Loader (indicizzazione)

Sempre dal pannello Admin, clicca **Carica in DB**. Inserisci i metadati (tipo documento, livello riservatezza, date di validità) e conferma. Il processo:

1. Salva il record in PostgreSQL (`Documento`)
2. Genera gli embedding con `qwen3-embedding:0.6b` via Ollama
3. Carica i vettori in ChromaDB

### Esecuzione da riga di comando (avanzato)

```bash
# Chunking manuale di un markdown
cd backend
python -m app.services.rag_chunker --input output_json/documento.md --output chunks/

# Pipeline Marker su una cartella di PDF
python -m app.services.ingestionaMarker --input data/ --output output_json/

# Pipeline Marker + Gemini LLM (migliore qualità)
python -m app.services.ingestionaMarker --input data/ --output output_json/ --gemini
```

---

## Struttura del progetto

```
policy-navigator/
├── backend/
│   ├── main.py                          # Entry point FastAPI
│   ├── .env                             # Configurazione locale (non committare)
│   ├── requirements.txt
│   └── app/
│       ├── api/v1/
│       │   ├── auth.py                  # Login, JWT, gestione utenti, RBAC
│       │   ├── admin.py                 # Upload, ingestion, loader, sync
│       │   └── chat.py                  # Chatbot endpoint + sessioni
│       ├── core/
│       │   ├── db_config.py             # Selezione pipeline (marker/mistral)
│       │   └── rag_chain_langgraph.py   # Grafo RAG con LangGraph
│       ├── db/
│       │   └── session.py               # SQLAlchemy engine + get_db
│       ├── models/
│       │   └── rag_models.py            # ORM SQLAlchemy (tutte le tabelle)
│       └── services/
│           ├── AI_Services.py           # Embedding via Ollama (qwen3)
│           ├── Search_Service_langchain2.py  # BM25 + ChromaDB retriever
│           ├── admin_search_service.py  # Gestione chunk per pannello admin
│           ├── auth_service.py          # JWT, RBAC, ownership helpers
│           ├── chat_history_service.py  # Persistenza sessioni chat
│           ├── chunker_service.py       # Wrapper chunker per API
│           ├── ingestionaMarker.py      # Pipeline OCR Marker (batch)
│           ├── loader_service.py        # Carica JSON → PostgreSQL + ChromaDB
│           ├── marker_service.py        # Wrapper Marker per API
│           ├── mistral_ocr_service.py   # Pipeline OCR Mistral API
│           ├── postprocessor_service.py # Wrapper postprocessor per API
│           ├── postprocessor6.py        # Pulizia Markdown (tabelle, footnote)
│           ├── rag_chunker.py           # Chunker semantico (MarkdownHeader)
│           └── sync_service.py          # Sincronizzazione PostgreSQL ↔ ChromaDB
├── sql_scripts/
│   ├── 01_schema.sql                    # Schema base
│   └── 02_seed.sql                      # Dati iniziali (tipi, ruoli)
├── migrations/
│   ├── 03_migration.sql                 # sync_status + Sync_Log
│   ├── 04_migration_log_e_ruoli.sql     # SuperAdmin + Activity_Log
│   ├── 05_migration_refresh_token.sql   # Refresh Token
│   ├── 06_migration_rbac_matrix.sql     # RBAC granulare (permessi)
│   ├── 07_migration_ownership.sql       # Ownership Admin/Documenti
│   ├── 08_migration_chat_history.sql    # Sessioni chat persistenti
│   └── 09_migration_sources_json.sql    # sources_json su Log_Risposta
└── docker-compose.yml
```

---

## API Reference

### Autenticazione

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/api/v1/auth/token` | Login (form OAuth2, restituisce JWT) |
| POST | `/api/v1/auth/refresh` | Rinnova access token via cookie |
| POST | `/api/v1/auth/logout` | Logout (revoca refresh token) |
| GET  | `/api/v1/auth/me` | Profilo utente corrente |
| PUT  | `/api/v1/auth/me/password` | Cambio password |

### Gestione Utenti (Admin+)

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET  | `/api/v1/auth/users` | Lista utenti (con filtro ownership) |
| POST | `/api/v1/auth/users` | Crea utente |
| PUT  | `/api/v1/auth/users/{id}` | Modifica utente |
| DELETE | `/api/v1/auth/users/{id}` | Elimina utente |

### Admin — Documenti

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET  | `/api/v1/admin/pdfs` | Lista PDF caricati |
| POST | `/api/v1/admin/upload` | Carica PDF |
| POST | `/api/v1/admin/ingest/{filename}` | Avvia pipeline OCR + chunking |
| POST | `/api/v1/admin/load/{filename}` | Indicizza in PostgreSQL + ChromaDB |
| GET  | `/api/v1/admin/chunks/{filename}` | Esplora chunk di un documento |
| GET  | `/api/v1/admin/sync-status` | Stato sincronizzazione DB |
| DELETE | `/api/v1/admin/document/{filename}` | Elimina documento completo |
| GET  | `/api/v1/admin/document/{filename}/metadata` | Metadati documento |
| PUT  | `/api/v1/admin/document/{filename}` | Aggiorna metadati |

### Chat

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/api/v1/chat` | Invia messaggio al chatbot |
| POST | `/api/v1/chat/reset` | Resetta sessione in-memory |
| GET  | `/api/v1/chat/sessions` | Lista sessioni utente |
| GET  | `/api/v1/chat/sessions/{uuid}` | Dettaglio sessione |
| DELETE | `/api/v1/chat/sessions/{uuid}` | Archivia sessione |

### WebSocket — Progress ingestion

```
ws://localhost:8080/api/v1/admin/progress/{job_id}
```

Il server invia messaggi di log in tempo reale. Quando il job termina invia `__STATUS__done` o `__STATUS__error`.

---

## Migrazioni database

Le migrazioni vanno eseguite **in ordine** su ogni istanza PostgreSQL (marker e/o mistral).

```bash
# Template comando
docker exec -i <container_name> psql -U admin -d policy_db < <file.sql>

# Esempio completo per pipeline Marker
for f in sql_scripts/01_schema.sql sql_scripts/02_seed.sql \
          migrations/03_migration.sql migrations/04_migration_log_e_ruoli.sql \
          migrations/05_migration_refresh_token.sql migrations/06_migration_rbac_matrix.sql \
          migrations/07_migration_ownership.sql migrations/08_migration_chat_history.sql \
          migrations/09_migration_sources_json.sql; do
  echo "Eseguo $f..."
  docker exec -i policy_db_marker psql -U admin -d policy_db < $f
done
```

### Ordine e dipendenze

```
01_schema.sql          ← tabelle base (richiesto da tutti)
02_seed.sql            ← dati iniziali (richiesto da 04+)
03_migration.sql       ← sync_status
04_migration_log_e_ruoli.sql   ← SuperAdmin, Activity_Log
05_migration_refresh_token.sql ← Refresh_Token
06_migration_rbac_matrix.sql   ← RBAC (richiede 01-05)
07_migration_ownership.sql     ← ownership Admin/Utenti
08_migration_chat_history.sql  ← sessioni chat
09_migration_sources_json.sql  ← sources_json
```

---

## Ruoli e permessi

Il sistema ha tre ruoli predefiniti:

| Ruolo | Descrizione |
|-------|-------------|
| `SuperAdmin` | Accesso totale: gestisce tutto, vede tutti gli utenti e documenti |
| `Admin` | Gestisce i propri documenti e i propri utenti (User) |
| `User` | Solo accesso alla chat |

### Credenziali di default

Dopo la migration 04, viene creato un SuperAdmin di default:

| Campo | Valore |
|-------|--------|
| Email | `superadmin@azienda.it` |
| Password | `SuperAdmin123!` |

> ⚠️ **Cambia subito la password dopo il primo accesso!**

### Permessi principali

I permessi sono granulari e assegnabili individualmente tramite il pannello RBAC (tab Permessi, visibile solo a SuperAdmin):

- `doc_upload`, `doc_ingest`, `doc_load`, `doc_update`, `doc_delete`
- `user_view`, `user_create`, `user_update`, `user_delete`, `user_permissions`
- `page_chat`, `page_admin`, `tab_*` (visibilità tab pannello admin)
- `log_view`, `chat_history_view`, `chat_audit_view`

---

## FAQ e troubleshooting

**Il backend non si connette a ChromaDB**

Verifica che il container sia avviato e che le porte nel `.env` corrispondano:
```bash
docker compose ps
curl http://localhost:8000/api/v1/heartbeat
```

**Errore `MISTRAL_API_KEY non impostata`**

Assicurati che il file `.env` sia nella cartella `backend/` e che la variabile sia valorizzata.

**Ollama non risponde / embedding lenti**

Verifica che Ollama sia in esecuzione e che il modello sia scaricato:
```bash
ollama list
ollama pull qwen3-embedding:0.6b
curl http://localhost:11434/api/embeddings -d '{"model":"qwen3-embedding:0.6b","prompt":"test"}'
```

**ChromaDB vuoto dopo il riavvio**

I dati sono persistiti in `./chroma_data` (Marker) o `./chroma_data_mistral` (Mistral). Se la cartella è mancante, i dati vengono persi al riavvio del container. Verifica il mount in `docker-compose.yml`.

**`sync_status = solo_postgres`**

Il documento è in PostgreSQL ma i chunk non sono in ChromaDB. Usa il tab **Sync** nel pannello Admin per ripristinare.

**La pipeline Marker è molto lenta**

Marker usa la CPU per l'inferenza dei modelli surya. È normale che il primo documento impieghi 2-5 minuti. Usa la pipeline Mistral per documenti in produzione.


