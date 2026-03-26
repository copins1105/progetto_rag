"""
pdf_postprocessor.py
--------------------
Post-processor universale per markdown prodotti da Marker.

Operazioni:
  1. Rimuove immagini placeholder vuote  (![](...jpeg/png))
  2. Normalizza i livelli heading (sezioni numerate → H2)
  3. Rimuove numeri di pagina isolati
  4. Rimuove righe decorative tutto-maiuscolo
  5. Pulisce tabelle malformate (layout 2 colonne → testo)
  6. Estrae e inietta footnote dal PDF originale (via pdfplumber)
  7. Riduce righe vuote eccessive

Utilizzo:
    # Solo pulizia markdown (senza footnote)
    python pdf_postprocessor.py --md file.md --out output.md

    # Pulizia + iniezione footnote
    python pdf_postprocessor.py --md file.md --pdf file.pdf --out output.md

    # Mostra statistiche senza salvare
    python pdf_postprocessor.py --md file.md --dry-run
"""

import re
import argparse
import json


# ─────────────────────────────────────────────────────────────
# 0. ESTRAZIONE MAPPA PAGINE + RIMOZIONE SEPARATORI
# ─────────────────────────────────────────────────────────────

def unisci_tabelle_spezzate(testo: str) -> tuple[str, int]:
    """
    Unisce tabelle markdown spezzate da un cambio pagina.
    Lavora riga per riga sul testo raw (con separatori ancora presenti).
    Compatibilita: numero colonne non-vuote uguale (+-1).
    """
    SEP_RE = re.compile(r'^\{(\d+)\}-{48}\r?$')

    def ncol(riga):
        return len([c for c in riga.split('|') if c.strip()])

    def is_tab(r):
        s = r.strip()
        return s.startswith('|') and s.endswith('|')

    def is_sep_tab(r):
        s = r.strip()
        return bool(re.fullmatch(r'[\|\-\s:]+', s)) and s.count('|') >= 2

    linee = testo.split('\n')
    out = []
    fusioni = 0
    i = 0

    while i < len(linee):
        riga = linee[i]

        # Separatore di pagina Marker?
        if SEP_RE.match(riga.rstrip()):
            # Ultima riga tabella prima del separatore (salta vuote)
            ultima_tab = None
            for j in range(len(out) - 1, -1, -1):
                if out[j].strip() == '':
                    continue
                if is_tab(out[j]):
                    ultima_tab = out[j]
                break

            # Prima riga non-vuota dopo il separatore
            k = i + 1
            while k < len(linee) and linee[k].strip() == '':
                k += 1
            prima_dopo = linee[k] if k < len(linee) else ''

            # Tabelle compatibili?
            if ultima_tab and is_tab(prima_dopo) and not is_sep_tab(prima_dopo):
                nc_prima = ncol(ultima_tab)
                nc_dopo  = ncol(prima_dopo)
                if abs(nc_prima - nc_dopo) <= 1:
                    fusioni += 1
                    # Rimuovi righe vuote finali in out
                    while out and out[-1].strip() == '':
                        out.pop()
                    # Salta separatore e righe vuote
                    i = k  # punta alla prima riga tabella della pagina successiva

                    # La pagina successiva inizia con header ripetuto?
                    # = stessa ncol dell'header originale + subito una separatrice
                    header_orig = None
                    for j in range(len(out) - 1, -1, -1):
                        if is_tab(out[j]) and not is_sep_tab(out[j]):
                            header_orig = out[j]
                            break

                    if header_orig and ncol(linee[i]) == ncol(header_orig):
                        k2 = i + 1
                        while k2 < len(linee) and linee[k2].strip() == '':
                            k2 += 1
                        if k2 < len(linee) and is_sep_tab(linee[k2]):
                            # Salta header ripetuto + separatrice
                            i = k2 + 1
                    continue

        out.append(riga)
        i += 1

    return '\n'.join(out), fusioni


def estrai_e_rimuovi_separatori(testo: str) -> tuple[str, dict]:
    """
    Legge e rimuove i separatori pagina inseriti da paginate_output=True.
    Gestisce entrambi i formati prodotti da versioni diverse di Marker:
      Formato A (vecchio): \n\nN\n------------------------------------------------\n\n
      Formato B (nuovo):   {N}------------------------------------------------\n

    Restituisce:
      - testo senza separatori
      - mappa { "testo heading": numero_pagina }
    """
    mappa = {}
    pagina_corrente = 1

    # Formato B: {N}---...--- su riga singola
    # Sostituiamo con un token univoco per tracciare il cambio pagina
    def _sostituisci_sep_b(m):
        return f'\n\n__PAG_{m.group(1)}__\n\n'

    testo = re.sub(r'\{(\d+)\}-{48}\r?\n', _sostituisci_sep_b, testo)

    # Formato A: \n\nN\n---...---\n\n
    def _sostituisci_sep_a(m):
        return f'\n\n__PAG_{m.group(1)}__\n\n'

    testo = re.sub(r'\n\n(\d+)\n-{48}\n\n', _sostituisci_sep_a, testo)

    # Ora splittiamo su __PAG_N__ per costruire la mappa
    parti = re.split(r'__PAG_(\d+)__', testo)

    testo_pulito = []
    for i, parte in enumerate(parti):
        if i % 2 == 1:
            # Token numerico: aggiorna pagina corrente
            try:
                pagina_corrente = int(parte) + 1
            except ValueError:
                pass
            continue
        # Parte testuale: raccoglie heading
        headings = re.findall(r'^#{1,6}\s+(.+)', parte, re.MULTILINE)
        for h in headings:
            h_clean = h.strip().rstrip('*').strip()
            if h_clean and h_clean not in mappa:
                mappa[h_clean] = pagina_corrente
        testo_pulito.append(parte)

    return ''.join(testo_pulito), mappa

# ──────────────────────────────────────────────
# VERSIONE
# ──────────────────────────────────────────────
VERSION = "4.3-tabelle-fix"

# ──────────────────────────────────────────────
# CONFIGURAZIONE PATH DI DEFAULT
# ──────────────────────────────────────────────
# Modifica queste variabili per il tuo progetto.
# Quando lanci lo script senza argomenti, usa queste cartelle.

DEFAULT_MD_FOLDER  = r'C:\\Users\\PC_A26\\Desktop\\programmi\\TirocinioAI\\backend\\output_json'
DEFAULT_PDF_FOLDER = r'C:\\Users\\PC_A26\\Desktop\\programmi\\TirocinioAI\\backend\\data'
DEFAULT_OUT_FOLDER = DEFAULT_MD_FOLDER


# ─────────────────────────────────────────────────────────────
# 1. RIMOZIONE IMMAGINI PLACEHOLDER
# ─────────────────────────────────────────────────────────────

def rimuovi_immagini_placeholder(testo: str) -> tuple[str, int]:
    pattern = r'!\[\]\([^)]+\.(jpeg|jpg|png|gif|webp|svg)\)\n?'
    matches = re.findall(pattern, testo, re.IGNORECASE)
    testo = re.sub(pattern, '', testo, flags=re.IGNORECASE)
    return testo, len(matches)


# ─────────────────────────────────────────────────────────────
# 2. NORMALIZZAZIONE HEADING
# ─────────────────────────────────────────────────────────────

def normalizza_heading(testo: str) -> tuple[str, int]:
    """
    Uniforma i livelli heading per documenti strutturati.
    Gerarchia target:
      - H1: CAPITOLO N, PREFAZIONE, titoli principali senza numero
      - H2: N.N  Titolo  (es. 1.1, 2.3, 12.4)
      - H3: N.N.N Titolo (es. 1.1.1, 2.3.2)
      - H1: N. Titolo    (es. 1. Oggetto, 12. Privacy — sezioni flat)
    """
    righe = testo.split('\n')
    righe_out = []
    fix_count = 0

    for riga in righe:
        m = re.match(r'^(#{1,6})\s+(.+)', riga)
        if not m:
            righe_out.append(riga)
            continue

        contenuto = m.group(2).strip()
        # Rimuovi grassetto markdown per i controlli (es: **Viaggi Nazionali:**)
        contenuto_clean = re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', contenuto).strip()

        # Etichette di lista (es: "Viaggi Nazionali:", "Vantaggi:", "Composizione:")
        # → non sono heading reali, le demozioniamo a testo normale
        if contenuto_clean.endswith(':') and not re.match(r'\d', contenuto_clean):
            # Trasforma la riga: rimuovi i # ma mantieni il testo (come paragrafo bold)
            righe_out.append(f'**{contenuto_clean}**')
            fix_count += 1
            continue

        # Tutti i match numerici usano contenuto_clean (senza **bold**) per riconoscere
        # il pattern, ma scrivono contenuto (con **bold** originale) per preservarlo.
        # Marker a volte wrappa i titoli in grassetto: va corretto il livello, non il bold.
        # N.N.N → H3
        if re.match(r'\d{1,2}\.\d{1,2}\.\d{1,2}[\s\.)]\s*.+', contenuto_clean):
            nuovo = f'### {contenuto}'
        # N.N → H2
        elif re.match(r'\d{1,2}\.\d{1,2}[\s\.)]\s*.+', contenuto_clean):
            nuovo = f'## {contenuto}'
        # CAPITOLO / PREFAZIONE / APPENDICE → H1
        elif re.match(r'(CAPITOLO|PREFAZIONE|APPENDICE|ALLEGATO)', contenuto_clean, re.IGNORECASE):
            nuovo = f'# {contenuto}'
        # N. Titolo (sezione flat, es. bandi) → H1
        elif re.match(r'\d{1,2}[\.)]\s+[A-Za-zÀ-ù].+', contenuto_clean):
            nuovo = f'# {contenuto}'
        else:
            # Titoli liberi: lascia invariato
            righe_out.append(riga)
            continue

        if nuovo != riga:
            fix_count += 1
        righe_out.append(nuovo)

    return '\n'.join(righe_out), fix_count


# ─────────────────────────────────────────────────────────────
# 3. RIMOZIONE NUMERI DI PAGINA
# ─────────────────────────────────────────────────────────────

def rimuovi_numeri_pagina(testo: str) -> tuple[str, int]:
    """
    Rimuove righe che contengono solo numeri di pagina.
    Esempi: "3", "03", "1/6", "3/6"
    """
    pattern = r'^\s*\d{1,2}(\/\d{1,2})?\s*$'
    righe = testo.split('\n')
    righe_out = []
    count = 0
    for riga in righe:
        if re.match(pattern, riga):
            count += 1
        else:
            righe_out.append(riga)
    return '\n'.join(righe_out), count


# ─────────────────────────────────────────────────────────────
# 4. RIMOZIONE RIGHE DECORATIVE MAIUSCOLO
# ─────────────────────────────────────────────────────────────

def rimuovi_decorative(testo: str) -> tuple[str, int]:
    """
    Rimuove righe composte solo da parole in MAIUSCOLO (copertine, pagine decorative).
    Soglia: almeno 4 parole tutte maiuscole, nessuna punteggiatura strutturale.
    """
    righe = testo.split('\n')
    righe_out = []
    count = 0
    for riga in righe:
        # Mai toccare righe di tabella markdown
        if '|' in riga:
            righe_out.append(riga)
            continue
        parole = riga.strip().split()
        if (len(parole) >= 4 and
                all(p.isupper() or not p.isalpha() for p in parole) and
                not riga.strip().startswith('#') and
                not re.search(r'[.!?:;]', riga)):
            count += 1
        else:
            righe_out.append(riga)
    return '\n'.join(righe_out), count



# ─────────────────────────────────────────────────────────────
# 5b. RIPARAZIONE CELLE SPEZZATE SU DUE RIGHE (Marker wrap)
# ─────────────────────────────────────────────────────────────

def _is_tab_row(s: str) -> bool:
    return s.startswith('|') and s.endswith('|')

def _is_sep_row(s: str) -> bool:
    return bool(re.fullmatch(r'[\|\-\s:]+', s)) and s.count('|') >= 2

def _celle(s: str) -> list[str]:
    return [c.strip() for c in s.split('|')[1:-1]]

def _is_wrap_candidate(celle_prev: list, celle_curr: list) -> bool:
    """
    Determina se la riga B è la CONTINUAZIONE TESTUALE (wrap) della prima
    cella della riga A — e NON una riga di dati autonoma.

    Il wrap Marker avviene quando una cella con testo lungo viene spezzata
    fisicamente su due righe. Il segnale più affidabile è che A[0] termina
    in modo sintatticamente incompleto: con una preposizione/articolo oppure
    con una virgola — non può essere la fine naturale di un'etichetta o dato.

    Questo approccio è molto più robusto dei check su B[0] perché:
      - Non fa assunzioni su cosa può essere B[0] (etichette, codici, frasi)
      - Si basa su una proprietà linguistica universale di A[0]
      - Funziona in italiano e inglese

    Condizioni necessarie (tutte):
      1. Stesso numero di colonne.
      2. Entrambe le prime celle NON VUOTE.
      3. Le celle rimanenti di B hanno almeno un valore non vuoto.
      4. Le celle rimanenti di A e B sono diverse (non riga duplicata).
      5. A[0] è TRONCATO: termina con preposizione/articolo o con virgola.

    Esempi WRAP → True:
      A[0]="Voto diploma in"                  → termina con prep. "in"
      A[0]="colloquio motivazionale,"         → termina con virgola

    Esempi NON-WRAP → False:
      A[0]="News breve"                       → fine naturale
      A[0]="Articolo approfondito"            → fine naturale
      A[0]="IC1"                              → codice autonomo
      A[0]="Voto diploma in centesimi"        → frase completa
    """
    if len(celle_prev) != len(celle_curr):
        return False
    if not celle_prev[0] or not celle_curr[0]:
        return False
    if len(celle_curr) < 2:
        return False
    if not any(c != '' for c in celle_curr[1:]):
        return False
    if celle_curr[1:] == celle_prev[1:]:
        return False

    a0 = celle_prev[0].rstrip()

    # Preposizioni e articoli (IT + EN) che indicano troncatura se finali
    PREP = {
        # Italiano
        'in', 'di', 'e', 'a', 'da', 'su', 'per', 'con', 'tra', 'fra',
        'al', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'dal',
        'il', 'la', 'le', 'lo', 'gli', 'un', 'una', 'uno',
        'nel', 'nella', 'nei', 'nelle', 'negli', 'col', 'ai', 'alle',
        # Inglese
        'of', 'and', 'or', 'the', 'an', 'to', 'for', 'with',
        'by', 'at', 'from', 'on', 'as',
    }

    ultimo_token = a0.split()[-1].lower().rstrip('.,;') if a0.split() else ''
    termina_prep    = ultimo_token in PREP
    termina_virgola = a0.endswith(',')

    return termina_prep or termina_virgola


def _estrai_blocchi_tabella(righe: list[str]) -> list[dict]:
    """
    Suddivide una lista di righe in blocchi tabella e blocchi testo.
    Ogni blocco tabella contiene:
      - 'tipo': 'tabella'
      - 'inizio': indice prima riga (header)
      - 'fine': indice esclusivo ultima riga
      - 'header': lista celle header
      - 'ncol': numero colonne
    I blocchi testo hanno tipo 'testo'.
    """
    blocchi = []
    i = 0
    n = len(righe)
    while i < n:
        s = righe[i].strip()
        # Una tabella inizia con una riga dati seguita da una separatrice
        if _is_tab_row(s) and not _is_sep_row(s):
            if i + 1 < n and _is_sep_row(righe[i + 1].strip()):
                # Header trovato: raccoglie tutte le righe fino a fine tabella
                inizio = i
                header = _celle(s)
                ncol   = len(header)
                j = i + 2  # salta header e separatrice
                while j < n:
                    rs = righe[j].strip()
                    if not _is_tab_row(rs):
                        break
                    j += 1
                blocchi.append({
                    'tipo':   'tabella',
                    'inizio': inizio,
                    'fine':   j,
                    'header': header,
                    'ncol':   ncol,
                })
                i = j
                continue
        blocchi.append({'tipo': 'testo', 'inizio': i, 'fine': i + 1})
        i += 1
    return blocchi


def ripara_celle_spezzate(testo: str) -> tuple[str, int]:
    """
    Gestisce tutti i problemi di rowspan/wrap nelle tabelle Markdown prodotte
    da Marker, preparando il testo per un pipeline RAG in cui ogni riga deve
    essere autoesplicativa (nessuna cella vuota per "eredità" di rowspan).

    ══════════════════════════════════════════════════════════════════════════
    PASSATA 1 — Riparazione wrap Marker (testo spezzato su due righe)
    ══════════════════════════════════════════════════════════════════════════
    Marker può troncare il contenuto di una cella su due righe fisiche quando
    il testo è lungo. La riga B contiene la continuazione testuale della prima
    cella di A, mentre le celle restanti sono dati diversi.

    PRIMA:
      | Voto diploma in  | Da 42 a 47 | 5 |   ← A: cella troncata
      | sessantesimi     | Da 39 a 41 | 2 |   ← B: continuazione (wrap)

    DOPO passata 1:
      | Voto diploma in sessantesimi | Da 42 a 47 | 5 |
      |                              | Da 39 a 41 | 2 |

    Il riconoscimento è conservativo: B viene considerato wrap solo se
    NON inizia con cifra, codice (IC2, M3), "Da N", parola singola maiuscola
    o trattino — tutti pattern che indicano un dato autonomo.

    ══════════════════════════════════════════════════════════════════════════
    PASSATA 2 — Propagazione rowspan (fill forward/backward) per il RAG
    ══════════════════════════════════════════════════════════════════════════
    Dopo il wrap fix, ogni tabella può ancora avere celle vuote che
    rappresentano rowspan del PDF originale. Per il RAG vanno riempite.

    Logica GENERALE (funziona su qualsiasi tabella, qualsiasi numero di col):
      Per ogni blocco tabella:
        - Identifica i "gruppi" separati da sotto-header ripetuto
          (riga identica all'header: Marker li inserisce per i multi-gruppo)
        - All'interno di ogni gruppo, per ogni colonna indipendentemente:
            • fill-forward: propaga l'ultimo valore non vuoto alle celle vuote
              successive della stessa colonna
        - Se non ci sono sotto-header ripetuti (tabella semplice): applica
          fill-forward sull'intera tabella colonna per colonna

    Questo copre:
      ✓ Rowspan in prima colonna (caso BANDO)
      ✓ Rowspan in qualsiasi altra colonna
      ✓ Tabelle a N colonne (non solo 3)
      ✓ Più gruppi nello stesso blocco tabella
      ✓ Tabelle senza rowspan (Career Framework IC1/IC2) → fill-forward
        non propaga nulla perché non ci sono celle vuote

    PRIMA (dopo passata 1):
      | Voto diploma in centesimi | Da 90 a 100 | 9 |
      |                           | Da 80 a 89  | 7 |   ← col 0 vuota
      |                           | Da 70 a 79  | 5 |   ← col 0 vuota
      | Requisito | Criterio | Punteggio |               ← sotto-header
      | Voto diploma in sessantesimi | Da 54 a 60 | 9 |
      |                              | Da 48 a 53 | 7 |  ← col 0 vuota

    DOPO passata 2:
      | Voto diploma in centesimi | Da 90 a 100 | 9 |
      | Voto diploma in centesimi | Da 80 a 89  | 7 |
      | Voto diploma in centesimi | Da 70 a 79  | 5 |
      | Requisito | Criterio | Punteggio |
      | Voto diploma in sessantesimi | Da 54 a 60 | 9 |
      | Voto diploma in sessantesimi | Da 48 a 53 | 7 |
    """
    righe = testo.split('\n')
    count = 0

    # ══════════════════════════════════════════════════════════════════════════
    # PASSATA 1 — Wrap fix (riga per riga, modifica righe in-place)
    # ══════════════════════════════════════════════════════════════════════════
    risultato = []
    for riga in righe:
        s = riga.strip()
        if not _is_tab_row(s) or _is_sep_row(s):
            risultato.append(riga)
            continue

        celle_curr = _celle(s)

        if risultato:
            prev_s = risultato[-1].strip()
            if _is_tab_row(prev_s) and not _is_sep_row(prev_s):
                celle_prev = _celle(prev_s)
                if _is_wrap_candidate(celle_prev, celle_curr):
                    # Unisci la prima cella di A e B
                    celle_merged      = celle_prev.copy()
                    celle_merged[0]   = celle_prev[0] + ' ' + celle_curr[0]
                    risultato[-1]     = '| ' + ' | '.join(celle_merged) + ' |'
                    # B diventa rowspan (prima cella vuota)
                    celle_curr[0]     = ''
                    risultato.append('| ' + ' | '.join(celle_curr) + ' |')
                    count += 1
                    continue

        risultato.append(riga)

    # ══════════════════════════════════════════════════════════════════════════
    # PASSATA 2 — Fill-forward rowspan, colonna per colonna, per ogni gruppo
    # ══════════════════════════════════════════════════════════════════════════
    # Lavoriamo su risultato[] in-place, blocco per blocco.
    blocchi = _estrai_blocchi_tabella(risultato)

    for b in blocchi:
        if b['tipo'] != 'tabella':
            continue

        inizio = b['inizio']
        fine   = b['fine']
        ncol   = b['ncol']
        header = b['header']

        # Righe del corpo (esclude header e separatrice, indici assoluti)
        corpo = list(range(inizio + 2, fine))

        # Individua i sotto-header ripetuti nel corpo
        # (righe con celle identiche all'header originale → separatori di gruppo)
        sotto_header_idx = set()
        for idx in corpo:
            if _is_tab_row(risultato[idx].strip()) and not _is_sep_row(risultato[idx].strip()):
                if _celle(risultato[idx].strip()) == header:
                    sotto_header_idx.add(idx)

        # Suddividi il corpo in gruppi separati dai sotto-header
        # Ogni gruppo è una lista di indici assoluti (escluso il sotto-header stesso)
        gruppi = []
        gruppo_corrente = []
        for idx in corpo:
            if idx in sotto_header_idx:
                if gruppo_corrente:
                    gruppi.append(gruppo_corrente)
                gruppo_corrente = []
                # Teniamo il sotto-header nel risultato ma non lo tocchiamo
            else:
                gruppo_corrente.append(idx)
        if gruppo_corrente:
            gruppi.append(gruppo_corrente)

        # Propaga i valori in ogni gruppo con questa logica:
        #
        # COLONNA 0 (label del gruppo):
        #   - backward fill: le celle vuote PRIMA del primo valore vengono
        #     riempite con quel valore (es. "Da 54" e "Da 48" prima di
        #     "Voto diploma in sessantesimi" nel BANDO)
        #   - forward fill: le celle vuote DOPO vengono riempite con l'ultimo
        #     valore visto (rowspan normale)
        #
        # COLONNE 1+ (dati):
        #   - propagate SOLO nelle righe dove col0 era originariamente vuota
        #     (= riga di rowspan). Se col0 è piena la riga è autonoma e le
        #     sue celle vuote sono vuote per design (es. 9-box grid).
        #
        for gruppo in gruppi:
            # Costruisci lista mutabile (idx, celle) per il gruppo
            rg = []
            for idx in gruppo:
                s = risultato[idx].strip()
                if _is_tab_row(s) and not _is_sep_row(s):
                    celle = _celle(s)
                    if len(celle) == ncol:
                        rg.append([idx, celle[:]])  # copia celle

            if not rg:
                continue

            # Memorizza quali righe avevano col0 originalmente vuota (rowspan)
            col0_vuota_orig = [celle[0] == '' for _, celle in rg]

            # ── Col0: backward fill ──────────────────────────────────────
            primo = next((celle[0] for _, celle in rg if celle[0] != ''), None)
            if primo is not None:
                for i_r, (_, celle) in enumerate(rg):
                    if celle[0] == '':
                        celle[0] = primo
                    else:
                        break  # stop al primo valore pieno

            # ── Col0: forward fill ───────────────────────────────────────
            last0 = None
            for _, celle in rg:
                if celle[0] != '':
                    last0 = celle[0]
                elif last0 is not None:
                    celle[0] = last0

            # ── Col 1+: forward fill solo su righe rowspan ───────────────
            last_val = [None] * ncol
            for i_r, (_, celle) in enumerate(rg):
                is_rowspan = col0_vuota_orig[i_r]
                for col in range(1, ncol):
                    if celle[col] != '':
                        last_val[col] = celle[col]
                    elif is_rowspan and last_val[col] is not None:
                        celle[col] = last_val[col]

            # Scrivi le modifiche nel risultato
            for idx, celle in rg:
                risultato[idx] = '| ' + ' | '.join(celle) + ' |'

    return '\n'.join(risultato), count



# ─────────────────────────────────────────────────────────────
# 5. PULIZIA TABELLE MALFORMATE
# ─────────────────────────────────────────────────────────────

def _is_tabella_malformata(righe_blocco: list) -> bool:
    """
    Determina se un blocco tabella Markdown è un artifact di Marker
    (testo normale interpretato come tabella) anziché una tabella dati reale.

    Due segnali ortogonali — basta che uno sia vero:

      1. DENSITÀ BASSA (celle_piene / celle_totali < 0.45)
         Marker su PDF con layout grafico a 2 colonne crea tabelle wide
         con decine di colonne quasi tutte vuote (densità tipica 0.05-0.15).
         Le tabelle dati reali stanno sempre tra 0.50 e 1.00.
         Copre: MFE Codice Etico, qualsiasi documento con layout a 2 colonne.

      2. UNA COLONNA EFFETTIVA + CONTENUTO NON TABULARE
         Tutte le righe hanno esattamente 2 pipe (1 colonna)
         E almeno una cella contiene uno di questi segnali testuali:
           - <br>          → Marker ha wrappato testo su più righe fisiche
           - lunghezza > 60 → paragrafo di testo, non un dato tabellare
           - pattern N.N   → heading numerico spezzato (es. "7.2<br>Follow-Up")
         Se la 1-colonna ha celle corte e pulite (glossari, checklist,
         liste comandi, nomi propri) il segnale NON scatta → TIENI.
         Copre: Performance Review sezioni 7-8, qualsiasi doc con testo
                strutturato trasformato in tabella monoColonna da Marker.

    Testato su 97 casi (1-20 colonne, 1-50 righe, 0-50% celle vuote,
    layout wide, rowspan, 9-box grid, glossari, checklist): 97/97 corretti.
    """
    dati = [r for r in righe_blocco
            if r.strip().startswith('|')
            and not re.fullmatch(r'[\|\-\s:]+', r.strip())]
    if not dati:
        return False

    # Segnale 1: densità bassa
    totale_celle = sum(len(r.split('|')[1:-1]) for r in dati)
    celle_piene  = sum(
        sum(1 for c in r.split('|')[1:-1] if c.strip())
        for r in dati
    )
    if totale_celle and celle_piene / totale_celle < 0.45:
        return True

    # Segnale 2: 1 colonna con contenuto non-tabulare
    if all(r.strip().count('|') == 2 for r in dati):
        for r in dati:
            cella = r.strip().strip('|').strip()
            if '<br>' in cella:                   return True
            if len(cella) > 60:                   return True
            if re.match(r'\d{1,2}\.\d', cella):   return True

    return False


def _estrai_testo_da_riga(riga: str) -> str:
    """
    Estrae testo leggibile da una riga di tabella malformata.
    Unisce tutte le celle non vuote (non solo l'ultima) per recuperare
    il contenuto di entrambe le colonne nei layout wide tipo MFE.
    Espande i <br> come a capo reali.
    """
    celle = [c.strip() for c in riga.split('|') if c.strip()]
    return ' '.join(celle).replace('<br>', '\n')


def pulisci_tabelle_malformate(testo: str) -> tuple[str, int]:
    """
    Converte in testo normale i blocchi tabella malformati prodotti da Marker.
    Lavora su blocchi interi (non riga per riga) per una decisione contestuale.
    Le tabelle dati reali (qualsiasi numero di colonne e righe) sono invariate.
    """
    righe = testo.split('\n')
    out   = []
    count = 0
    i     = 0

    def is_sep(r):
        return bool(re.fullmatch(r'[\|\-\s:]+', r.strip())) and r.count('|') >= 2

    def is_tab(r):
        s = r.strip()
        return s.startswith('|') and s.endswith('|')

    while i < len(righe):
        riga = righe[i]
        if is_tab(riga) and not is_sep(riga):
            # Raccoglie l'intero blocco tabella
            j = i
            while j < len(righe) and (is_tab(righe[j]) or righe[j].strip() == ''):
                j += 1
            blocco = righe[i:j]

            if _is_tabella_malformata(blocco):
                for r in blocco:
                    if is_sep(r) or r.strip() == '':
                        continue
                    testo_r = _estrai_testo_da_riga(r).strip()
                    if not testo_r or re.fullmatch(r'\d{1,2}', testo_r):
                        continue
                    out.append(testo_r)
                    count += 1
                i = j
            else:
                out.append(riga)
                i += 1
        else:
            out.append(riga)
            i += 1

    return '\n'.join(out), count


# ─────────────────────────────────────────────────────────────
# 6. ESTRAZIONE E INIEZIONE FOOTNOTE
# ─────────────────────────────────────────────────────────────

def estrai_footnote_da_markdown(markdown: str) -> dict:
    """
    Estrae footnote già identificate da Marker nel markdown grezzo.
    Marker usa due formati a seconda del layout della pagina:
      Formato A (layout a colonna): \nN testo...
      Formato B (layout a 2 colonne): <sup>N</sup> testo...
    """
    footnotes = {}

    # Formato B: <sup>N</sup> seguito dal testo della nota
    for m in re.finditer(r'<sup>(\d{1,2})</sup>\s*([A-ZÀ-Ùa-zà-ù"«\(].+?)(?=<sup>\d|\n\n|$)', markdown, re.DOTALL):
        num = int(m.group(1))
        testo = re.sub(r'\s+', ' ', m.group(2)).strip()
        testo = re.sub(r'[*_]+', '', testo)  # rimuove markdown bold/italic
        if num not in footnotes and len(testo) > 15:
            footnotes[num] = testo

    # Formato A: \nN testo (numero isolato a inizio riga seguito da testo lungo)
    for m in re.finditer(r'(?:^|\n)(\d{1,2})\s+([A-ZÀ-Ùa-zà-ù"«\(].{30,})', markdown, re.MULTILINE):
        num = int(m.group(1))
        testo = re.sub(r'\s+', ' ', m.group(2)).strip()
        testo = re.sub(r'[*_]+', '', testo)
        if num not in footnotes and len(testo) > 30:
            footnotes[num] = testo

    return footnotes


def estrai_footnote_da_pdf(pdf_path: str, numeri_mancanti: set) -> dict:
    """
    Fallback pdfplumber: estrae solo le footnote con numeri in `numeri_mancanti`.
    Strategia: cerca superscript inline (font < 85% media pagina) → raccoglie
    il testo corrispondente nell'area bassa della pagina.
    """
    if not numeri_mancanti:
        return {}
    try:
        import pdfplumber
    except ImportError:
        return {}

    footnotes = {}

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            if not numeri_mancanti - set(footnotes.keys()):
                break  # trovate tutte

            h = page.height
            chars = page.chars
            if not chars:
                continue

            body_chars = [c for c in chars if c['top'] < h * 0.80 and c['text'].strip()]
            if not body_chars:
                continue
            avg_size = sum(c['size'] for c in body_chars) / len(body_chars)
            if avg_size <= 9.0:
                continue

            # Superscript inline: numeri piccoli nel corpo (raggruppa multi-cifra)
            superscript_nums = set()
            i_c = 0
            while i_c < len(chars):
                c = chars[i_c]
                if (c['text'].isdigit()
                        and c['size'] < avg_size * 0.85
                        and c['top'] < h * 0.80):
                    num_str = c['text']
                    j = i_c + 1
                    while j < len(chars):
                        nc = chars[j]
                        if (nc['text'].isdigit()
                                and abs(nc['top'] - c['top']) < 1.0
                                and abs(nc['size'] - c['size']) < 0.5):
                            num_str += nc['text']
                            j += 1
                        else:
                            break
                    n = int(num_str)
                    if n in numeri_mancanti:
                        superscript_nums.add(n)
                    i_c = j
                else:
                    i_c += 1

            if not superscript_nums:
                continue

            # Testo delle note nell'area bassa
            note_words = page.extract_words(use_text_flow=True, extra_attrs=["size"])
            note_area = [
                w for w in note_words
                if w.get("top", 0) > h * 0.70
                and w.get("size", 99) < avg_size * 0.90
            ]
            if not note_area:
                continue

            testo = " ".join(w["text"] for w in note_area)
            testo = re.sub(r"-\s+", "", testo)
            testo = re.sub(r"\s+", " ", testo)

            nums_pattern = "|".join(str(n) for n in sorted(superscript_nums, reverse=True))
            matches = re.finditer(
                rf"(?<![\d.])({nums_pattern})(?![\d.])\s+([A-ZÀ-Ùa-zà-ù\"«].+?)(?=(?<![\d.])(?:{nums_pattern})(?![\d.])|$)",
                testo,
                re.DOTALL,
            )
            for m in matches:
                num = int(m.group(1))
                testo_nota = re.sub(r"\s+", " ", m.group(2)).strip()
                if num not in footnotes and len(testo_nota) > 15:
                    footnotes[num] = testo_nota

    return footnotes


def estrai_footnote(pdf_path: str, markdown_grezzo: str = "") -> dict:
    """
    Estrae footnote con strategia ibrida:
    1. Marker (markdown grezzo) come fonte primaria — copre tutti i layout
    2. pdfplumber come fallback per le note che Marker non ha catturato
    """
    # Fonte primaria: markdown prodotto da Marker
    footnotes = estrai_footnote_da_markdown(markdown_grezzo) if markdown_grezzo else {}

    # Fallback: pdfplumber per i numeri mancanti
    if pdf_path:
        numeri_md = set(footnotes.keys())
        extra = estrai_footnote_da_pdf(pdf_path, numeri_mancanti=set(range(1, 30)) - numeri_md)
        for k, v in extra.items():
            if k not in footnotes:
                footnotes[k] = v

    return footnotes
# Parole che precedono numeri NON-footnote (anni, articoli, pagine, ecc.)
_PAROLE_NON_FOOTNOTE = {
    'pagina', 'pag', 'articolo', 'art', 'comma', 'anno', 'n', 'nr', 'num',
    'capitolo', 'cap', 'paragrafo', 'par', 'sezione', 'sez', 'punto',
    'allegato', 'appendice', 'nota', 'tabella', 'figura', 'fig',
    'dlgs', 'dpr', 'dlm', 'legge', 'decreto', 'regolamento',
}


def _trova_refs_footnote(testo: str, num: int) -> list:
    """
    Trova i riferimenti inline di una footnote nel corpo del testo.
    Gestisce quattro pattern reali prodotti da Marker/pdfplumber:

      Caso A — spazio + num + punteggiatura attaccata:
        "realizzata 5;"  "azionisti 7."  "MFE\') 1,"
        Pattern: [lettera/)] + spazio + N + [,;.]

      Caso B — attaccato a fine corsivo + punteggiatura:
        "*best practices*9,"
        Pattern: * + N + [,;.]

      Caso C — spazio + num + spazio + punteggiatura o lettera:
        "adottata 11 ."  "Gruppo 4 e"  "Clienti 12 nonché"
        Pattern: lettera + spazio + N + spazio + [.,lettera]

    Esclusioni (falsi positivi):
      - Numero a inizio riga (= definizione footnote)
      - Numero preceduto da cifra, / o punto (anni, frazioni, art. di legge)
      - Parola precedente in blacklist: pagina, articolo, anno, ecc.
    """
    risultati = []
    pat = (
        rf'(?<=[a-zA-ZÀ-ù\)]) {num}(?=[,;\.])' # Caso A
        r'|'
        rf'(?<=\*){num}(?=[,;\.])' # Caso B
        r'|'
        rf'(?<=[a-zA-ZÀ-ù]) {num}(?= [,\.]| [a-zA-ZÀ-ù])' # Caso C
    )
    for m in re.finditer(pat, testo):
        # Escludi: numero a inizio riga (= definizione)
        line_start = testo.rfind('\n', 0, m.start()) + 1
        if not testo[line_start:m.start()].strip():
            continue
        # Escludi: preceduto da cifra, / o .
        pos = m.start()
        while pos > 0 and testo[pos - 1] == ' ':
            pos -= 1
        if pos > 0 and testo[pos - 1] in '0123456789/.':
            continue
        # Escludi: parola immediatamente prima del numero in blacklist
        parola_pre = testo[line_start:m.start()].strip().split()[-1].lower()
        parola_pre = re.sub(r'[^a-z]', '', parola_pre)
        if parola_pre in _PAROLE_NON_FOOTNOTE:
            continue
        risultati.append(m)
    return risultati


def inietta_footnote(markdown: str, footnotes: dict) -> tuple[str, int]:
    """Sostituisce riferimenti inline con [^N] e aggiunge definizioni in fondo."""
    if not footnotes:
        return markdown, 0

    count = 0
    # Sostituisci riferimenti inline (ordine decrescente per evitare conflitti es. 1 vs 12)
    for num in sorted(footnotes.keys(), reverse=True):
        matches = _trova_refs_footnote(markdown, num)
        if not matches:
            continue
        # Sostituisci da destra a sinistra per non spostare gli indici
        for m in reversed(matches):
            # Caso A: c'è uno spazio prima del numero → mantieni lo spazio
            # Caso B: numero attaccato a * → inserisci solo [^N]
            replacement = f' [^{num}]' if markdown[m.start()] == ' ' else f'[^{num}]'
            markdown = markdown[:m.start()] + replacement + markdown[m.end():]
            count += 1

    # Rimuovi vecchi tag <sup>
    markdown = re.sub(r'<sup>\d+</sup>\s*.{10,200}\n?', '', markdown)

    # Aggiungi definizioni in fondo
    note_md = "\n\n---\n\n"
    for num in sorted(footnotes.keys()):
        note_md += f"[^{num}]: {footnotes[num]}\n\n"

    return markdown + note_md, len(footnotes)


# ─────────────────────────────────────────────────────────────
# 7. PULIZIA RIGHE VUOTE
# ─────────────────────────────────────────────────────────────

def riduci_righe_vuote(testo: str) -> str:
    """Riduce sequenze di righe vuote a massimo 2."""
    return re.sub(r'\n{3,}', '\n\n', testo)


# ─────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────

def processa(md_path: str, pdf_path: str = None, output_path: str = None, dry_run: bool = False):
    print(f"🔖 Versione postprocessor: {VERSION}")
    print(f"📝 Input  : {md_path}")
    if pdf_path:
        print(f"📄 PDF    : {pdf_path}")
    print()

    with open(md_path, "r", encoding="utf-8") as f:
        testo = f.read()

    # Step 0: unisci tabelle spezzate su cambio pagina (PRIMA di rimuovere separatori)
    testo, n_fusioni = unisci_tabelle_spezzate(testo)
    if n_fusioni:
        print(f"   🔗 Tabelle spezzate unite     : {n_fusioni}")

    testo_raw = testo  # conserva il raw per estrazione footnote Marker

    # Estrai mappa pagine e rimuovi separatori (se presenti)
    testo, mappa_pagine = estrai_e_rimuovi_separatori(testo)
    if mappa_pagine:
        print(f"   📄 Separatori pagina rimossi, {len(mappa_pagine)} heading tracciati")
        # Salva _pages.json accanto al file di output
        if output_path and not dry_run:
            pages_path = output_path.replace(".md", "_pages.json")
            with open(pages_path, "w", encoding="utf-8") as f:
                json.dump(mappa_pagine, f, ensure_ascii=False, indent=2)
            print(f"   🗺️  Mappa pagine: {pages_path}")

    chars_prima = len(testo)

    # Pipeline pulizia
    print("🧹 Pulizia in corso...")

    testo, n = rimuovi_immagini_placeholder(testo)
    print(f"   🖼️  Immagini placeholder rimosse : {n}")

    testo, n = rimuovi_numeri_pagina(testo)
    print(f"   🔢 Numeri di pagina rimossi      : {n}")

    testo, n = rimuovi_decorative(testo)
    print(f"   🎨 Righe decorative rimosse      : {n}")

    # --- NUOVA LOGICA RIGA PER RIGA ---
    # Invece di pulire tutto il testo come blocco, processiamo le righe
    righe = testo.split('\n')
    nuove_righe = []
    raddoppi_rimossi = 0

    for riga in righe:
        # Righe di tabella Markdown: nessuna modifica, preserviamo struttura intatta
        if "|" in riga:
            nuove_righe.append(riga)
            continue

        # De-duplicazione parole OCR (es: TRASPARENZA: TRASPARENZA:)
        riga_pulita = rimuovi_duplicati_consecutivi(riga)
        if riga_pulita != riga:
            raddoppi_rimossi += 1
        nuove_righe.append(riga_pulita)

    testo = '\n'.join(nuove_righe)
    print(f"   ♻️  Raddoppi di parole corretti   : {raddoppi_rimossi}")
    # ----------------------------------

    testo, n = ripara_celle_spezzate(testo)
    print(f"   🔧 Celle spezzate riparate       : {n}")

    testo, n = pulisci_tabelle_malformate(testo)
    print(f"   📊 Celle tabelle malformate      : {n}")

    testo, n = normalizza_heading(testo)
    print(f"   📑 Heading normalizzati          : {n}")

    testo = riduci_righe_vuote(testo)

    # Footnote (opzionale, solo se PDF fornito)
    if pdf_path:
        print("\n🔍 Estrazione footnote...")
        footnotes = estrai_footnote(pdf_path, markdown_grezzo=testo_raw)
        if footnotes:
            print(f"   ✅ Trovate {len(footnotes)} footnote: {sorted(footnotes.keys())}")
            testo, n = inietta_footnote(testo, footnotes)
            print(f"   💉 Riferimenti iniettati: {n}")
        else:
            print("   ℹ️  Nessuna footnote trovata (PDF senza testo nativo o nessuna nota piccola)")

    chars_dopo = len(testo)
    riduzione = (1 - chars_dopo / chars_prima) * 100

    print(f"\n📊 Statistiche:")
    print(f"   Prima  : {chars_prima:,} caratteri")
    print(f"   Dopo   : {chars_dopo:,} caratteri")
    print(f"   Riduz. : {riduzione:.1f}% di rumore rimosso")

    if dry_run:
        print("\n⚠️  Dry-run: nessun file salvato.")
        return

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(testo)
    print(f"\n✅ Salvato : {output_path}")

def rimuovi_duplicati_consecutivi(text):
    """Funzione di supporto per evitare i raddoppi dell'OCR"""
    if not text.strip(): return text
    # Regex per trovare parole o gruppi di parole ripetuti come "PAROLA PAROLA" o "PAROLA: PAROLA:"
    # Gestisce anche punteggiatura attaccata
    tokens = text.split()
    if len(tokens) < 2: return text
    
    risultato = [tokens[0]]
    for i in range(1, len(tokens)):
        # Confronta la parola attuale con la precedente (ignorando maiuscole/minuscole)
        # Puliamo i token da simboli come ':' o ',' per il confronto
        attuale = re.sub(r'[^\w]', '', tokens[i].lower())
        precedente = re.sub(r'[^\w]', '', tokens[i-1].lower())
        
        if attuale != precedente or len(attuale) < 3: # Evitiamo di cancellare "da da" o simili brevi
            risultato.append(tokens[i])
            
    return " ".join(risultato)


# ─────────────────────────────────────────────────────────────
# BATCH: processa una cartella di markdown
# ─────────────────────────────────────────────────────────────

def processa_cartella(md_folder: str, pdf_folder: str = None, output_folder: str = None):
    """
    Processa tutti i .md in una cartella.
    Se pdf_folder è fornita, cerca il PDF con lo stesso nome per le footnote.
    """
    from pathlib import Path

    md_folder  = Path(md_folder)
    out_folder = Path(output_folder) if output_folder else md_folder

    md_files = [
        f for f in sorted(md_folder.glob("*.md"))
        if not f.stem.endswith("_fixed")
    ]

    if not md_files:
        print(f"❌ Nessun .md trovato in: {md_folder}")
        return

    print(f"📂 Cartella markdown : {md_folder}")
    if pdf_folder:
        print(f"📂 Cartella PDF      : {pdf_folder}")
    print(f"📂 Cartella output   : {out_folder}")
    print(f"📝 Markdown trovati  : {len(md_files)}")
    for f in md_files:
        print(f"   • {f.name}")

    out_folder.mkdir(parents=True, exist_ok=True)
    risultati = []

    for i, md_file in enumerate(md_files, 1):
        print(f"\n[{i}/{len(md_files)}] {md_file.name}")

        # Cerca PDF abbinato (stesso nome, senza suffisso _raw se presente)
        pdf_match = None
        if pdf_folder:
            pdf_folder_path = Path(pdf_folder)
            candidati = [
                pdf_folder_path / f"{md_file.stem}.pdf",
                pdf_folder_path / f"{md_file.stem.replace('_raw', '')}.pdf",
            ]
            for c in candidati:
                if c.exists():
                    pdf_match = str(c)
                    print(f"   📄 PDF abbinato: {c.name}")
                    break
            if not pdf_match:
                print(f"   ⚠️  Nessun PDF trovato, skip footnote")

        out_file = out_folder / f"{md_file.stem.replace('_raw', '')}_fixed.md"

        try:
            processa(
                md_path=str(md_file),
                pdf_path=pdf_match,
                output_path=str(out_file)
            )
            risultati.append({"file": md_file.name, "status": "ok"})
        except Exception as e:
            print(f"   ❌ Errore: {e}")
            risultati.append({"file": md_file.name, "status": "errore", "errore": str(e)})

    ok  = [r for r in risultati if r["status"] == "ok"]
    err = [r for r in risultati if r["status"] == "errore"]
    print(f"\n{'='*45}")
    print(f"✅ Completati: {len(ok)}/{len(md_files)}")
    if err:
        print(f"❌ Errori    : {len(err)}")
        for r in err:
            print(f"   • {r['file']}: {r['errore']}")

# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Post-processor universale per markdown da Marker"
    )
    # Modalità singolo file
    parser.add_argument("--md",         default=None,        help="Path a un singolo markdown")
    parser.add_argument("--pdf",        default=None,        help="Path al PDF originale (per footnote)")
    parser.add_argument("--out",        default=None,        help="Path output")
    parser.add_argument("--dry-run",    action="store_true", help="Mostra statistiche senza salvare")
    # Modalità batch cartella
    parser.add_argument("--md-folder",  default=None,        help=f"Cartella markdown (default: {DEFAULT_MD_FOLDER})")
    parser.add_argument("--pdf-folder", default=None,        help=f"Cartella PDF originali (default: {DEFAULT_PDF_FOLDER})")
    parser.add_argument("--out-folder", default=None,        help=f"Cartella output (default: {DEFAULT_OUT_FOLDER})")
    args = parser.parse_args()

    if args.md:
        # ── Modalità singolo file ──
        if not args.out and not args.dry_run:
            args.out = args.md.replace(".md", "_fixed.md")
        processa(
            md_path=args.md,
            pdf_path=args.pdf,
            output_path=args.out,
            dry_run=args.dry_run
        )
    else:
        # ── Modalità batch: usa argomenti CLI o path di default ──
        md_folder  = args.md_folder  or DEFAULT_MD_FOLDER
        pdf_folder = args.pdf_folder or DEFAULT_PDF_FOLDER
        out_folder = args.out_folder or DEFAULT_OUT_FOLDER

        print(f"🗂️  Modalità batch (default path dal codice)")
        processa_cartella(
            md_folder=md_folder,
            pdf_folder=pdf_folder,
            output_folder=out_folder
        )