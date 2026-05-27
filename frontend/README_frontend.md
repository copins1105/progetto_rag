← [Torna al README principale](../README.md)

# Policy Navigator — Frontend

> **Assistente documentale AI** per policy aziendali, basato su React + Vite.
> Design system Exprivia (blu `#2d6b9e` / arancio `#e8621a`), dark/light mode, RBAC completo.

---

## Indice

1. [Panoramica](#panoramica)
2. [Stack tecnologico](#stack-tecnologico)
3. [Struttura del progetto](#struttura-del-progetto)
4. [Prerequisiti](#prerequisiti)
5. [Installazione](#installazione)
6. [Variabili d'ambiente](#variabili-dambiente)
7. [Avvio in sviluppo](#avvio-in-sviluppo)
8. [Build di produzione](#build-di-produzione)
9. [Architettura e componenti](#architettura-e-componenti)
10. [Sistema di autenticazione](#sistema-di-autenticazione)
11. [RBAC — Permessi e ruoli](#rbac--permessi-e-ruoli)
12. [Temi dark/light](#temi-darklight)
13. [Pagine principali](#pagine-principali)
14. [Pannello Admin](#pannello-admin)
15. [Design system e CSS](#design-system-e-css)
16. [Responsive design](#responsive-design)
17. [WebSocket e ingestion](#websocket-e-ingestion)
18. [Sessioni chat e storico](#sessioni-chat-e-storico)
19. [Contribuire](#contribuire)

---

## Panoramica

Policy Navigator è una **Single Page Application** che espone un'interfaccia chat per interrogare una knowledge base di documenti PDF aziendali. Include un pannello amministrativo completo per:

- Caricare, indicizzare (ingestion) e caricare su ChromaDB + PostgreSQL i PDF
- Gestire utenti con ownership (SuperAdmin → Admin → User)
- Configurare permessi granulari per ogni utente (matrice RBAC)
- Auditare le conversazioni (Chat Audit)
- Monitorare l'activity log di sistema

---

## Stack tecnologico

| Categoria | Libreria / Strumento | Versione | Scopo |
|---|---|---|---|
| Framework UI | **React** | 18.x | Rendering dichiarativo, hooks |
| Build tool | **Vite** | 5.x | Dev server, HMR, build ottimizzata |
| Routing | **React Router DOM** | 6.x | SPA routing con guardie RBAC |
| CSS utility | **Tailwind CSS** (`@tailwindcss/vite`) | 4.x | Utility classes (via plugin Vite) |
| Markdown | **ReactMarkdown** + **remark-gfm** | — | Render messaggi bot con tabelle/codice |
| PDF viewer | **react-pdf** + **pdfjs-dist** | — | Visualizzatore PDF in-app |
| HTTP/Auth | **Fetch API** nativa | — | Chiamate REST con refresh token automatico |
| WebSocket | **WebSocket API** nativa | — | Streaming log ingestion in real-time |
| Font (runtime) | **Plus Jakarta Sans**, **JetBrains Mono** | — | Google Fonts, caricati in `App.css` |

### Dipendenze runtime principali (`package.json`)

```
react
react-dom
react-router-dom
react-markdown
remark-gfm
react-pdf
pdfjs-dist
```

### DevDependencies

```
vite
@vitejs/plugin-react
@tailwindcss/vite
```

---

## Struttura del progetto

```
frontend/
├── public/                  # Asset statici (favicon, ecc.)
├── src/
│   ├── assets/              # Immagini brand (logo Exprivia, logo robot)
│   ├── components/
│   │   └── ThemeToggle.jsx  # Bottone dark/light mode
│   ├── context/
│   │   ├── AuthContext.jsx      # Token JWT, refresh, authFetch, RBAC
│   │   ├── ChatContext.jsx      # Messaggi, sessionId, reset/load session
│   │   ├── IngestionContext.jsx # Job ingestion, WebSocket progress, loader
│   │   └── ThemeContext.jsx     # Tema dark/light, persistenza localStorage
│   ├── pages/
│   │   ├── Login.jsx            # Pagina di login
│   │   ├── ChatPage.jsx         # Chat principale con sidebar
│   │   ├── AdminPage.jsx        # Shell amministrativa con tab nav
│   │   ├── AdminPanel.jsx       # Gestione documenti PDF (3 colonne)
│   │   ├── ActivityLogPanel.jsx # Log attività sistema
│   │   ├── ChatAuditPanel.jsx   # Audit conversazioni
│   │   ├── OwnershipPanel.jsx   # Ownership documenti/utenti (SuperAdmin)
│   │   ├── PermissionMatrixPanel.jsx  # Matrice RBAC interattiva
│   │   ├── ProfilePage.jsx      # Profilo utente + cambio password
│   │   └── UserManagementPanel.jsx    # CRUD utenti con ownership
│   ├── App.jsx              # Router principale + guardie route
│   ├── App.css              # Design system completo (variabili CSS + classi)
│   ├── index.css            # Reset base + import Tailwind
│   ├── responsive.css       # Media queries (xs/sm/md/lg/xl)
│   └── main.jsx             # Entry point + provider tree
├── index.html
├── vite.config.js
└── package.json
```

---

## Prerequisiti

- **Node.js** ≥ 18.x (consigliato 20 LTS)
- **npm** ≥ 9.x oppure **pnpm** / **yarn**
- Backend Policy Navigator in esecuzione (FastAPI su `localhost:8080` di default)

---

## Installazione

```bash
# 1. Clona il repository
git clone https://github.com/tua-org/policy-navigator.git
cd policy-navigator/frontend

# 2. Installa le dipendenze
npm install

# 3. Copia il file env di esempio
cp .env.example .env.local
# → Modifica VITE_API_URL con l'URL del tuo backend
```

---

## Variabili d'ambiente

Crea un file `.env.local` nella cartella `frontend/`:

```env
# URL base del backend FastAPI (senza trailing slash)
VITE_API_URL=https://127.0.0.1:8080
```

Il frontend deriva automaticamente l'URL WebSocket da questa variabile:
- `https://` → `wss://`
- `http://` → `ws://`

> **Nota per certificati self-signed**: in sviluppo con HTTPS self-signed, accetta il certificato nel browser navigando direttamente sull'URL del backend prima di aprire il frontend.

---

## Avvio in sviluppo

```bash
npm run dev
```

Il dev server di Vite avvia su `http://localhost:5173` con:
- **HMR** (Hot Module Replacement) attivo
- **Proxy** automatico: `/api` e `/ws` vengono inoltrati a `VITE_API_URL`

---

## Build di produzione

```bash
npm run build
# Output in dist/

# Preview locale del build
npm run preview
```

---

## Architettura e componenti

### Provider tree (`main.jsx`)

```
BrowserRouter
└── ThemeProvider        ← dark/light mode
    └── AuthProvider     ← token JWT, user, permessi
        └── IngestionProvider  ← job PDF, WebSocket
            └── ChatProvider   ← messaggi, sessionId
                └── App        ← routing
```

Ogni provider è disponibile ovunque nel tree tramite il rispettivo hook:
- `useTheme()` — tema corrente e toggle
- `useAuth()` — token, user, authFetch, hasPermission, login, logout
- `useIngestion()` — avvio/stato job ingestion e loader
- `useChat()` — messaggi, sessionId, addMessage, resetChat, loadSession

### Route (`App.jsx`)

| Path | Componente | Permesso richiesto |
|---|---|---|
| `/login` | `Login` | — (redirect se già loggato) |
| `/` | `ChatPage` | `page_chat` |
| `/profile` | `ProfilePage` | `page_profile` |
| `/admin` | `AdminPage` | `page_admin` |
| `*` | redirect `/` | — |

---

## Sistema di autenticazione

**`AuthContext.jsx`** gestisce l'intero ciclo di vita dell'autenticazione:

### Login
```
POST /api/v1/auth/token (x-www-form-urlencoded)
→ access_token (JWT), user, permissions[]
```

### Refresh automatico
- Al mount: tenta `POST /api/v1/auth/refresh` (cookie HttpOnly)
- Su risposta `401` da qualsiasi chiamata: esegue refresh e riprova
- **Errore di rete** → non esegue logout (utente rimane loggato)
- **401 dal server di refresh** → logout corretto

### `authFetch(url, options)`
Wrapper intorno a `fetch` che:
1. Aggiunge header `Authorization: Bearer <token>`
2. Su `401`: tenta refresh, riprova la chiamata
3. Gestisce `Content-Type: application/json` automaticamente
4. Supporta `FormData` (upload file) senza sovrascrivere headers

---

## RBAC — Permessi e ruoli

I ruoli disponibili sono `SuperAdmin`, `Admin`, `User`.

I **permessi** sono codici stringa verificati con `hasPermission(codice)`:

| Categoria | Codici |
|---|---|
| Pagine | `page_chat`, `page_admin`, `page_profile` |
| Tab Admin | `tab_ingestion`, `tab_loader`, `tab_chunks`, `tab_modifica`, `tab_sync`, `tab_log`, `tab_users`, `tab_permissions` |
| Documenti | `doc_upload`, `doc_ingest`, `doc_load`, `doc_update`, `doc_delete` |
| Utenti | `user_view`, `user_create`, `user_update`, `user_delete`, `user_permissions` |
| Chat | `chat_history_view`, `chat_audit_view` |
| Log | `log_view` |

La **matrice permessi** in `PermissionMatrixPanel.jsx` consente al SuperAdmin di abilitare/disabilitare ogni permesso per ogni utente con salvataggio bulk.

---

## Temi dark/light

**`ThemeContext.jsx`** gestisce il tema:
- Valore salvato in `localStorage` con chiave `exprivia-theme`
- Applica `data-theme="dark"` o `data-theme="light"` su `<html>`
- Fallback automatico alla preferenza OS (`prefers-color-scheme`)

Il componente `ThemeToggle` mostra ☀️/🌙 ed è inserito nel footer della sidebar.

Tutte le variabili CSS cambiano in base a `[data-theme]` — vedi sezione [Design system](#design-system-e-css).

---

## Pagine principali

### Login (`Login.jsx`)
- Logo robot (grande, centrato) + logo Exprivia
- Form email + password
- Errori inline senza navigazione

### Chat (`ChatPage.jsx`)
- **Sidebar** collassabile: nuova chat, storico sessioni, navigazione admin, tema toggle
- **Hamburger** su mobile per aprire la sidebar come drawer con backdrop
- **Messaggi bot**: ReactMarkdown con GFM, citazioni inline `[Titolo|pN]` cliccabili
- **Feedback CSAT** (stelle 1–5) su ogni risposta del bot
- **Debug drawer**: mostra i chunk recuperati dal retrieval se modalità debug attiva
- **Watermark**: logo robot semitrasparente centrato nell'area chat

### Profile (`ProfilePage.jsx`)
- Info utente + ruoli
- Form cambio password con validazione lato client

---

## Pannello Admin

`AdminPage.jsx` è la shell con topbar + breadcrumb + tab nav. Le sezioni sono:

### Documenti (`AdminPanel.jsx`)
Layout a 3 colonne:

**Colonna sinistra — Knowledge Base**
- Lista PDF con badge stato: `Da indicizzare` / `In corso` / `Pronto` / `Completato`
- Upload drag-and-drop o click (solo `.pdf`)

**Colonna centrale — PDF Viewer**
- Visualizzatore in-app con zoom e navigazione pagine
- Highlight del chunk selezionato se il PDF ha text layer
- Avviso automatico per PDF scansionati (no text layer)

**Colonna destra — Pannello azioni**
Tab disponibili in base ai permessi:

| Tab | Descrizione |
|---|---|
| **Ingestion** | Avvia pipeline di chunking/embedding. Log in streaming via WebSocket |
| **Loader** | Carica il documento in PostgreSQL + ChromaDB con metadati (tipo, livello riservatezza, date validità/scadenza) |
| **Chunks** | Esplora i chunk indicizzati, paginati. Click su chunk evidenzia nel viewer |
| **Modifica** | Aggiorna metadati di un documento già caricato |
| **Sync** | Mostra stato sincronizzazione tra PostgreSQL e ChromaDB |

### Utenti (`UserManagementPanel.jsx`)
- SuperAdmin: vede tutti gli utenti con colonna "Creato da"
- Admin: vede solo gli utenti che ha creato lui
- CRUD completo: crea, modifica nome/cognome/ruolo, elimina
- Modal creazione con selezione ruolo in base al ruolo corrente

### Log (`ActivityLogPanel.jsx`)
- Tabella paginata (50 eventi/pagina) con griglia desktop e card su mobile
- Filtri: utente, azione, esito (ok/warning/error)
- Auto-refresh ogni 8 secondi con badge "+N nuovi"
- Dettaglio espandibile per ogni evento

### Permessi (`PermissionMatrixPanel.jsx`)
- Matrice utenti × permessi con celle toggle ✓/—
- Modifiche in batch con indicatore "N modifiche non salvate"
- Filtro per nome/email utente
- Toggle per categoria (Pagine, Tab Admin, Documenti, Utenti, Log, Chat)
- Sticky header colonna utente per scroll orizzontale

### Chat Audit (`ChatAuditPanel.jsx`)
- Lista sessioni con filtri data, utente, "solo bloccate"
- Dettaglio sessione: ogni Q&A con risposta in Markdown, latenza, chunk usati, fonti cliccabili
- Eliminazione sessione (solo SuperAdmin)
- Mobile: view switching lista/dettaglio

---

## Design system e CSS

Il design system è definito in `App.css` tramite **variabili CSS** su `:root` e `[data-theme]`.

### Palette dark mode
```css
--bg:            #080d12   /* sfondo principale */
--surface:       #111822   /* card/sidebar */
--accent:        #3580b8   /* blu Exprivia */
--orange:        #e8621a   /* arancio Exprivia */
--green:         #3ac98a   /* successo */
--red:           #e05a5a   /* errore */
```

### Palette light mode
```css
--bg:            #cfd8e3
--surface:       #e4eaf2
--accent:        #1558a0
--orange:        #c44e0c
```

### Classi utility principali

| Classe | Descrizione |
|---|---|
| `.btn-primary` | Bottone blu con glow |
| `.btn-ghost` | Bottone outline neutro |
| `.btn-danger` | Bottone rosso semi-trasparente |
| `.card` | Card con border e shadow |
| `.status-pill.ok/warn/error` | Badge stato colorato |
| `.form-input`, `.form-select`, `.form-label` | Elementi form consistenti |
| `.mono` | Font JetBrains Mono |
| `.accent-strip` | Striscia gradiente blu→arancio |
| `.bubble.bot`, `.bubble.user` | Bubble chat |
| `.typing-bubble` + `.typing-dot` | Indicatore digitazione animato |

---

## Responsive design

`responsive.css` definisce breakpoint con media queries:

| Breakpoint | Larghezza | Comportamento principale |
|---|---|---|
| xs | < 480px | Login full-screen, sidebar drawer, card layout log |
| sm | 480–767px | Padding ridotti, header compatto |
| md | 768–1023px | Sidebar 220px, colonne admin ridotte |
| lg | 1024–1279px | Layout quasi-desktop |
| xl | ≥ 1280px | Layout desktop completo |

**Mobile chat**: la sidebar diventa un drawer slide-in con overlay backdrop e può essere aperta/chiusa con il pulsante hamburger nella topbar.

**Pannello admin su mobile**: le 3 colonne si impilano verticalmente; il viewer PDF è nascosto (troppo piccolo per essere utile).

---

## WebSocket e ingestion

`IngestionContext.jsx` gestisce due tipi di job:

### Ingestion (chunking + embedding)
```
POST /api/v1/admin/ingest/:filename
→ { job_id }
→ WS wss://.../api/v1/admin/progress/:job_id
   messaggi: log di testo | __STATUS__done | __STATUS__error
```

### Loader (caricamento PostgreSQL + ChromaDB)
```
POST /api/v1/admin/load/:filename
→ { job_id }
→ WS messaggi: log | __LOAD_OK__<docId> | __DUPLICATO__<dove>__<docId> | __STATUS__<stato>
```

**Fix badge ottimistico**: lo stato del job viene impostato a `"processing"` immediatamente al click, prima ancora che il server risponda, garantendo feedback visivo istantaneo.

Il token JWT viene passato come query parameter al WebSocket (il protocollo WS non supporta header `Authorization` durante l'handshake).

---

## Sessioni chat e storico

Ogni conversazione ha un `session_id` UUID generato lato client. Il contesto è mantenuto nel backend per la durata della sessione.

**Ripristino sessione** (`handleSelectSession`):
1. `GET /api/v1/chat/sessions/:uuid` — carica messaggi storici
2. `loadSession(msgs, uuid)` — aggiorna lo stato React
3. `POST /api/v1/chat/restore/:uuid` — pre-riscalda il contesto nel backend (fire-and-forget)

Le **citazioni inline** nel testo del bot usano la sintassi `[Titolo documento|pN]` e vengono rese come badge cliccabili che aprono il PDF alla pagina indicata.

---

## Contribuire

1. Fork del repository
2. Crea un branch: `git checkout -b feature/nome-feature`
3. Commit con messaggi descrittivi
4. Pull request verso `main`

### Convenzioni codice

- Componenti React in PascalCase, hook in camelCase con prefisso `use`
- Stili inline per componenti isolati, classi CSS per stili condivisi
- `useCallback` su tutte le funzioni passate come prop o usate in `useEffect`
- Evitare stale closure negli effect: usare `useRef` per valori che cambiano frequentemente

### Variabili d'ambiente per CI

```env
VITE_API_URL=https://backend.example.com
```
