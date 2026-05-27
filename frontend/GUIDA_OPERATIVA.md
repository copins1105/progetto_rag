# Guida operativa — Policy Navigator Frontend

Guida passo-passo per sviluppatori che devono configurare, eseguire ed estendere il frontend, e per amministratori che devono usare il pannello admin.

---

## Parte 1 — Setup iniziale per sviluppatori

### Passo 1 — Clonare il repository

```bash
git clone https://github.com/tua-org/policy-navigator.git
cd policy-navigator/frontend
```

### Passo 2 — Verificare Node.js

```bash
node --version   # deve essere >= 18.x
npm --version    # deve essere >= 9.x
```

Se Node non è installato, scaricalo da [nodejs.org](https://nodejs.org) (consigliata la versione LTS 20).

### Passo 3 — Installare le dipendenze

```bash
npm install
```

Questo comando legge `package.json` e scarica tutte le librerie in `node_modules/`. Le principali sono:

- `react`, `react-dom` — libreria UI
- `react-router-dom` — routing SPA
- `react-markdown`, `remark-gfm` — rendering Markdown nei messaggi chat
- `react-pdf`, `pdfjs-dist` — visualizzatore PDF in-app
- `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` — build tool e CSS utility

### Passo 4 — Configurare le variabili d'ambiente

Crea un file `.env.local` nella cartella `frontend/`:

```bash
# Su Linux/Mac
echo "VITE_API_URL=https://127.0.0.1:8080" > .env.local

# Su Windows (PowerShell)
echo "VITE_API_URL=https://127.0.0.1:8080" | Out-File .env.local
```

Sostituisci `https://127.0.0.1:8080` con l'URL reale del tuo backend FastAPI.

> **Attenzione con HTTPS self-signed**: se il backend usa un certificato auto-firmato, apri prima `https://127.0.0.1:8080` nel browser e accetta l'eccezione di sicurezza. Solo dopo il frontend potrà comunicarci.

### Passo 5 — Avviare il server di sviluppo

```bash
npm run dev
```

Il terminale mostrerà qualcosa del tipo:

```
  VITE v5.x.x  ready in 300ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.x:5173/
```

Apri `http://localhost:5173` nel browser. Le modifiche ai file vengono ricaricate automaticamente senza perdere lo stato (HMR — Hot Module Replacement).

---

## Parte 2 — Build per la produzione

### Passo 1 — Creare il build

```bash
npm run build
```

I file ottimizzati vengono generati in `dist/`. Questa cartella è quella da servire tramite un web server (Nginx, Apache, Caddy, ecc.).

### Passo 2 — Verificare il build localmente

```bash
npm run preview
```

Avvia un server locale che serve il contenuto di `dist/` esattamente come farebbe in produzione.

### Passo 3 — Configurare Nginx (esempio)

```nginx
server {
    listen 80;
    server_name tuodominio.com;
    root /var/www/policy-navigator/dist;
    index index.html;

    # Necessario per React Router (SPA)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy verso il backend
    location /api {
        proxy_pass http://localhost:8080;
    }
    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Parte 3 — Guida utente: login e chat

### Login

1. Apri l'URL del frontend nel browser.
2. Inserisci la tua **email aziendale** e la **password**.
3. Clicca **Accedi**.

Se le credenziali sono corrette verrai reindirizzato alla chat. In caso di errore apparirà un messaggio rosso sotto i campi.

### Usare la chat

**Inviare un messaggio**

Scrivi la tua domanda nel campo in basso e premi `Invio` oppure clicca **Invia**. Il bot risponderà basandosi sui documenti aziendali indicizzati.

**Citazioni nel testo**

Le risposte del bot possono contenere badge come `📄 Procedura-HR.pdf · p.12` — sono cliccabili e aprono il PDF alla pagina indicata.

**Valutare una risposta**

Sotto ogni risposta del bot trovi 5 stelle (☆). Clicca per indicare quanto la risposta è stata utile. Il feedback viene salvato in modo anonimo.

**Nuova chat**

Clicca **＋ Nuova chat** nella sidebar per resettare la conversazione e iniziarne una nuova.

**Storico sessioni**

Clicca su **Recenti** nella sidebar per vedere le conversazioni precedenti. Selezionandone una, i messaggi vengono ripristinati e puoi continuare a scrivere.

**Su mobile**

Tocca il pulsante ☰ (hamburger) in alto a sinistra per aprire la sidebar. Tocca fuori dalla sidebar o premi `Esc` per chiuderla.

---

## Parte 4 — Guida admin: gestione documenti

### Accedere al pannello admin

1. Clicca **⚙ Pannello Admin** nella sidebar (visibile solo se hai il permesso `page_admin`).
2. Oppure naviga direttamente a `/admin`.

### Caricare un PDF

1. Nella tab **Documenti**, vedi il pannello sinistro "Knowledge Base".
2. Trascina un file PDF nella zona tratteggiata, oppure cliccaci sopra per scegliere il file.
3. Il PDF appare nella lista con badge grigio **Da indicizzare**.

### Indicizzare un documento (Ingestion)

L'ingestion spezza il PDF in chunk e li vettorizza per la ricerca semantica.

1. Clicca sul documento nella lista di sinistra per selezionarlo.
2. Nel pannello destro, tab **Ingestion**, clicca **Avvia ingestion**.
3. Il badge diventa giallo **In corso…** e i log del processo appaiono in tempo reale.
4. Al completamento il badge diventa verde **Pronto** — il documento è pronto per essere caricato nel database.

> Se la pipeline fallisce, il badge torna grigio e i log mostrano l'errore. Puoi riprovare.

### Caricare nel database (Loader)

Dopo l'ingestion, carica il documento in PostgreSQL e ChromaDB con i suoi metadati.

1. Vai alla tab **Loader** (attiva solo se il documento è in stato **Pronto**).
2. Compila i campi:
   - **Tipo documento** — categoria (opzionale)
   - **Livello riservatezza** — obbligatorio
   - **Data validità** — data da cui il documento è in vigore (obbligatoria)
   - **Data scadenza** — data di fine validità (opzionale)
3. Clicca **⬆ Carica in ChromaDB + DB**.
4. Il badge diventa **Completato** quando tutto è andato a buon fine.

**Documento duplicato**: se il PDF è già presente nel database, apparirà un avviso giallo con le opzioni **Sovrascrivi** o **Annulla**.

### Esplorare i chunk (Chunks)

Disponibile solo per documenti in stato **Completato**.

1. Vai alla tab **Chunks**.
2. Scorrila per vedere i chunk indicizzati con anteprima testo e numero pagina.
3. Clicca su un chunk per evidenziarlo nel viewer PDF centrale (solo se il PDF ha testo selezionabile).

### Modificare i metadati (Modifica)

1. Vai alla tab **Modifica** (disponibile solo per documenti completati).
2. Aggiorna tipo, livello, versione, o date.
3. Clicca **💾 Salva modifiche**.

### Controllare la sincronizzazione (Sync)

La tab **Sync** mostra per ogni documento se è allineato tra PostgreSQL e ChromaDB:

| Stato | Significato |
|---|---|
| ✅ Sincronizzato | Presente in entrambi i database |
| ⚠️ Solo PostgreSQL | Presente solo nel DB relazionale |
| ⚠️ Solo ChromaDB | Presente solo nel vettoriale |
| ❌ Mismatch | Dati divergenti tra i due |

### Eliminare un documento

1. Seleziona il documento.
2. Nel pannello destro, clicca **🗑 Elimina**.
3. Conferma nella dialog. Il documento viene rimosso dal file system, da PostgreSQL e da ChromaDB.

---

## Parte 5 — Guida admin: gestione utenti

### Visualizzare gli utenti

Vai alla tab **Utenti** nel pannello admin. Vedrai:
- **SuperAdmin**: tutti gli utenti del sistema, con la colonna "Creato da"
- **Admin**: solo gli utenti che hai creato tu

### Creare un nuovo utente

1. Clicca **＋ Nuovo utente** (in alto a destra).
2. Compila email, password (min. 8 caratteri), nome, cognome e ruolo.
3. Clicca **Crea utente**.

> Admin può creare solo utenti con ruolo **User**. SuperAdmin può creare Admin e User.

### Modificare un utente

1. Trova l'utente nella lista.
2. Clicca ✏️ a destra.
3. Modifica nome, cognome o ruolo.
4. Clicca ✓ per salvare o ✕ per annullare.

### Eliminare un utente

1. Clicca 🗑 a destra del nome utente.
2. Clicca **Conferma** per procedere.

Non puoi eliminare te stesso.

---

## Parte 6 — Guida admin: matrice permessi

### Aprire la matrice

Vai alla tab **Permessi** nel pannello admin (solo per SuperAdmin e Admin con permesso `tab_permissions`).

### Leggere la matrice

- Righe = utenti
- Colonne = permessi (raggruppati per categoria)
- ✓ verde = permesso assegnato
- — grigio = permesso non assegnato
- ✓ tratteggiato = modifica non ancora salvata

### Modificare un permesso

1. Clicca sulla cella corrispondente all'incrocio utente/permesso.
2. La cella mostra il bordo tratteggiato — è una modifica pending.
3. Puoi fare più modifiche prima di salvare.
4. Clicca **💾 Salva (N)** per applicare tutte le modifiche.

Per annullare una modifica pending, riclicca sulla stessa cella prima di salvare.

### Filtrare gli utenti

Usa il campo di ricerca in alto per filtrare per nome o email.

Usa i chip colorati (Pagine, Tab Admin, ecc.) per mostrare/nascondere categorie di permessi.

---

## Parte 7 — Guida admin: audit e log

### Chat Audit

Vai alla tab **Chat** per vedere tutte le conversazioni degli utenti.

**Filtri disponibili:**
- Utente (email o nome) — solo SuperAdmin
- Data da / Data a
- "Solo sessioni con messaggi bloccati" — utile per trovare domande censurate

**Visualizzare una conversazione:**
1. Clicca su una sessione nella lista a sinistra.
2. Sulla destra appaiono tutti i Q&A con: testo completo, tipo risposta (content/courtesy/not_found/blocked), latenza, chunk usati, fonti cliccabili.
3. Clicca su **Risposta ▼** per espandere/collassare il testo.

**Eliminare una sessione** (solo SuperAdmin): clicca 🗑 nell'header del dettaglio e conferma.

### Activity Log

Vai alla tab **Log** per il registro completo delle azioni di sistema.

**Tipi di azione monitorati:**
- 🔐 Login / 🚪 Logout
- ⬆️ Upload PDF / ⚙️ Ingestion / 💾 Caricamento DB
- ✏️ Modifica documento / 🗑️ Eliminazione
- 👤 Utente creato/modificato/eliminato
- 🔒 Permesso modificato

**Filtri**: azione, esito (ok/warning/error), utente.

**Live mode**: attiva il toggle **● Live** per aggiornamento automatico ogni 8 secondi. Un badge "+N nuovi" appare quando ci sono nuovi eventi.

**Dettaglio**: clicca su una riga per espandere i dati tecnici (IP, parametri, ecc.).

---

## Parte 8 — Profilo utente

### Accedere al profilo

Clicca sul tuo nome nella sidebar oppure naviga a `/profile`.

### Cambiare la password

1. Inserisci la password attuale.
2. Inserisci la nuova password (minimo 8 caratteri).
3. Conferma la nuova password.
4. Clicca **Salva nuova password**.

> Dopo il cambio password tutte le sessioni attive vengono invalidate — dovrai rieseguire il login.

### Uscire dall'account

Clicca **Esci dall'account** in fondo alla pagina profilo, oppure **↩ Esci** nella sidebar della chat.

---

## Parte 9 — Debug e modalità avanzate

### Debug retrieval (solo nella chat)

1. Nella sidebar, clicca il bottone **○ Debug retrieval OFF** per attivarlo.
2. Invia un messaggio.
3. Il drawer laterale si apre mostrando i chunk recuperati dal sistema di retrieval, con: numero chunk, titolo documento, numero pagina, anteprima testo.
4. Ogni chunk con numero pagina ha un link **🔗 apri PDF** per verificare la fonte originale.

Questo strumento è utile per capire perché il bot ha risposto in un certo modo o per verificare la qualità dell'indicizzazione.

### Ownership (solo SuperAdmin)

Se hai il permesso SuperAdmin, nella tab **Utenti** trovi anche un link al pannello **Ownership** che mostra:
- Tutti i documenti con l'Admin che li ha caricati e la data
- Tutti gli utenti con l'Admin che li ha creati

Utile per audit e per tracciare la responsabilità dei contenuti.

---

## Domande frequenti

**Il badge del PDF rimane grigio anche dopo l'ingestion?**
Ricarica la pagina o clicca il bottone ↻ nella lista documenti. Se persiste, controlla i log nella tab Ingestion.

**La sidebar non appare su mobile?**
Tocca il pulsante ☰ in alto a sinistra nella chat.

**Il viewer PDF mostra "Impossibile caricare il PDF"?**
Il backend potrebbe non raggiungere il file. Verifica che il PDF sia stato caricato correttamente tramite il pannello admin.

**"Sessione scaduta" appare mentre stavo lavorando?**
Il token di refresh è scaduto o revocato. Riesegui il login. Le sessioni di chat non vanno perse — puoi riprenderle dallo storico.

**Come si aggiunge un tipo documento o livello riservatezza?**
Questi valori sono configurati nel backend (tabelle `tipo_documento` e `livello_riservatezza` su PostgreSQL). Non è possibile aggiungerli dal frontend.
