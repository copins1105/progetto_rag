"""
rag_chunker.py
==============
Pipeline per la segmentazione di documenti Markdown in chunk ottimizzati
per RAG con EmbeddingGemma (308M, Gemma 3).

Strategia di splitting
-----------------------
1.  Pre-processing: estrae la mappa footnote {n -> testo} dal documento
2.  Pulizia del rumore (separatori, numeri pagina, footer ripetuti)
    — le definizioni footnote [^N]: vengono rimosse dal testo principale
      ma salvate nella mappa per essere reinserite nel chunk di riferimento
3.  Split con MarkdownHeaderTextSplitter (LangChain):
      separa il documento per intestazioni H1/H2/H3, mantenendo il contesto
      gerarchico nei metadati di ogni segmento
4.  Sub-split con RecursiveCharacterTextSplitter (LangChain):
      i segmenti che superano MAX_CHUNK_CHARS vengono ulteriormente spezzati
      ricorsivamente (\n\n → \n → ". " → " " → "")
5.  Fusione preventiva: chunk con solo heading (senza corpo) vengono uniti
      al frammento successivo
6.  Merging: chunk troppo piccoli (< MIN_WORDS_RAG parole) vengono fusi
      con il successivo dello stesso H2 (poi H1 cross-H2)
7.  Iniezione footnote: per ogni [^N] nel testo del chunk,
      appende la nota al fondo come "> [^N]: testo"
8.  Estrazione keyword con TF pesato sulla lunghezza del token
9.  Classificazione frammento (content / toc / cover / noise)
10. Preparazione testo_embedding nel formato nativo EmbeddingGemma:
      documento → "Documento: {doc_id} | title: {breadcrumb} | text: {testo}"
      tabelle Markdown → "Header: valore | Header: valore" (leggibili dal modello)
11. Serializzazione JSON con schema completo (documento + frammenti)

Formato prompt EmbeddingGemma (dal model card ufficiale)
---------------------------------------------------------
  Documenti  →  title: {titolo} | text: {testo}       ← usato in testo_embedding
  Query RAG  →  task: search result | query: {testo}  ← da usare lato backend
  QA         →  task: question answering | query: {q}

  ⚠  Il prompt DEVE essere anteposto anche lato query prima di chiamare
     ollama embed, altrimenti query e documenti non sono nello stesso spazio.

Vedere quantizzazione del modello Ollama
-----------------------------------------
  ollama show embedding-gemma
  ollama show embedding-gemma --modelfile   (cerca riga "quantization")
  # dimensione indicativa: ~600 MB = Q4_0, ~1.1 GB = Q8_0, ~2.2 GB = F16
  # Q4_0 perde ~0.36 punti MTEB vs full precision → ottimo per uso locale

Schema JSON prodotto
─────────────────────
{
  "documento": {
    "id":                   str
    "file_md":              str
    "documento_id":         str | null
    "versione":             str | null
    "data_validita":        str | null
    "data_scadenza":        str | null
    "area_responsabile":    str | null
    "livello_accesso":      str | null
    "keywords_documento":   [str]
    "n_frammenti":          int
    "n_frammenti_rag":      int
  },
  "frammenti": [
    {
      "id":              str   (uuid4)
      "chunk_index":     int
      "tipo":            str   ("content" | "toc" | "cover" | "noise")
      "index_for_rag":   bool
      "breadcrumb":      str
      "h1":              str | null
      "h2":              str | null
      "h3":              str | null
      "pagina":          int | null
      "anchor_link":     str | null
      "keywords":        [str]
      "testo":           str
      "testo_embedding": str
      "n_parole":        int
      "n_caratteri":     int
      "documento_id":    str
    }
  ]
}

Uso
---
  python rag_chunker.py -i documento.md -o chunks.json
  python rag_chunker.py -i docs/*.md -o out/ --batch
  python rag_chunker.py -i doc.md -o out.json --max-chars 5500 --min-words 15

Dipendenze
----------
  pip install langchain-text-splitters stop-words
"""

from __future__ import annotations

import re
import json
import uuid
import argparse
import unicodedata
import math
import glob as glob_module
from pathlib import Path
from collections import Counter
from typing import Optional

from langchain_text_splitters import MarkdownHeaderTextSplitter
from langchain_text_splitters import RecursiveCharacterTextSplitter


# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
MAX_CHUNK_CHARS = 5500    # ~900 parole — soglia per il RecursiveCharacterTextSplitter
CHUNK_OVERLAP   = 200     # overlap in caratteri tra sub-chunk
MIN_WORDS_RAG   = 15      # soglia minima parole per indicizzare un frammento
STATIC_PDF_PATH = '/static/'

HEADERS_TO_SPLIT = [("#", "h1"), ("##", "h2"), ("###", "h3")]


# ---------------------------------------------------------------------------
# STOPWORDS
# ---------------------------------------------------------------------------
try:
    from stop_words import get_stop_words
    STOPWORDS: set[str] = set(get_stop_words("italian")) | set(get_stop_words("english"))
except ImportError:
    STOPWORDS = {
        "il","lo","la","i","gli","le","un","uno","una","di","a","da","in",
        "con","su","per","tra","fra","e","o","ma","se","che","non","si","ci",
        "ne","mi","ti","vi","lui","lei","noi","voi","loro","è","sono","ha",
        "hanno","del","della","dello","dei","degli","delle","al","alla","allo",
        "ai","agli","alle","dal","dalla","dallo","dai","dagli","dalle","nel",
        "nella","nello","nei","negli","nelle","sul","sulla","sullo","sui","sugli",
        "sulle","questo","questa","questi","queste","quello","quella","quelli",
        "quelle","come","quando","dove","anche","più","meno","molto","poco",
        "ogni","tutti","tutte","tutto","tutta","essere","avere","fare","suo",
        "sua","suoi","sue","mio","mia","tuo","tua","nostro","nostra","vostro",
        "proprio","propria","propri","già","ancora","sempre","mai","qui","qua",
        "quindi","però","mentre","ovvero","oppure","qualora","pertanto","dunque",
        "invece","stessa","stesso","tale","tali","caso","parte","volta","modo",
        "tipo","livello","punto","fine","base","forma","esso","essa","essi","esse",
        "cui","quale","quali","qualche","alcun","alcuna","alcuno","alcuni","alcune",
        "altri","altre","altro","altra",
        # English
        "the","a","an","and","or","but","in","on","at","to","for","of","with",
        "by","from","as","is","are","was","were","be","been","have","has","had",
        "do","does","did","will","would","could","should","may","might","shall",
        "not","no","nor","so","yet","both","either","each","every","all","any",
        "few","more","most","other","such","than","that","these","those","this",
        "it","its","he","she","we","they","what","which","who","when","where",
        "how","why","if","then","else","while","after","before","can","our",
    }


# ---------------------------------------------------------------------------
# UTILITY TESTO
# ---------------------------------------------------------------------------

def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def count_words(text: str) -> int:
    return len(text.split())


def strip_md(text: str) -> str:
    """Rimuove markup Markdown per analisi testuale."""
    text = re.sub(r"\*{1,3}(.+?)\*{1,3}", r"\1", text)
    text = re.sub(r"_{1,2}(.+?)_{1,2}", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"^\|.+", "", text, flags=re.M)
    return text


def tokenize(text: str) -> list[str]:
    text = strip_md(text)
    text = unicodedata.normalize("NFC", text.lower())
    tokens = re.findall(r"[a-zàèéìîòùü][a-zàèéìîòùü\-']{2,}", text)
    return [t for t in tokens if t not in STOPWORDS and len(t) > 2]


# ---------------------------------------------------------------------------
# KEYWORDS
# ---------------------------------------------------------------------------

def estrai_keywords(heading: str, testo: str, top_n: int = 7) -> list[str]:
    """
    Estrae keyword privilegiando le parole del heading, poi integra
    con le più frequenti (pesate per lunghezza) del testo.
    """
    keywords: list[str] = []

    # Parole significative dell'heading (priorità alta)
    if heading:
        for w in re.sub(r'[^a-zA-ZÀ-ÿ\s]', ' ', heading).split():
            w = w.lower().strip()
            if len(w) > 3 and w not in STOPWORDS and w not in keywords:
                keywords.append(w)

    # TF pesato per lunghezza sul corpo del testo
    tokens = tokenize(testo)
    if tokens:
        freq = Counter(tokens)
        scored = {w: c * math.log(1 + len(w)) for w, c in freq.items()}
        seen_stems = {w[:5] for w in keywords}
        for w in sorted(scored, key=lambda x: -scored[x]):
            stem = w[:5]
            if stem not in seen_stems and w not in keywords:
                seen_stems.add(stem)
                keywords.append(w)
            if len(keywords) >= top_n:
                break

    return keywords[:top_n]


# ---------------------------------------------------------------------------
# FOOTNOTE
# ---------------------------------------------------------------------------

_FN_DEF_RE = re.compile(
    r"^\[\^(\d+)\]:\s*(.+?)(?=\n\[\^\d+\]:|^---|\Z)",
    re.M | re.S,
)
_FN_REF_RE = re.compile(r"\[\^(\d+)\](?!:)")


def extract_footnotes(md: str) -> dict[str, str]:
    fn_map: dict[str, str] = {}
    for m in _FN_DEF_RE.finditer(md):
        num  = m.group(1)
        text = m.group(2).strip().replace("\n", " ")
        text = _FN_REF_RE.sub("", text).strip()
        fn_map[num] = text
    return fn_map


def inject_footnotes(text: str, fn_map: dict[str, str]) -> str:
    """
    Appende in fondo al chunk le note relative ai riferimenti [^N]
    presenti nel testo, in formato blockquote Markdown.
    """
    refs = _FN_REF_RE.findall(text)
    if not refs:
        return text
    seen: set[str] = set()
    ordered: list[str] = []
    for r in refs:
        if r not in seen and r in fn_map:
            seen.add(r)
            ordered.append(r)
    if not ordered:
        return text
    notes = "\n".join(f"> [^{r}]: {fn_map[r]}" for r in ordered)
    return text + "\n\n" + notes


# ---------------------------------------------------------------------------
# NOISE REMOVAL
# ---------------------------------------------------------------------------

_NOISE_RE = [
    re.compile(r"^[-=]{3,}\s*$", re.M),
    re.compile(r"^\s*\d{1,3}\s*$", re.M),
    re.compile(r"^\|[^|]*(?:CODICE ETICO|pag\.|page)[^|]*\|.*$", re.M | re.I),
]

_TOC_BLOCK_RE = re.compile(
    r"(?m)^#{1,3}\s+(?:Sommario|Indice|Table of Contents|Contents)\s*$"
    r".*?(?=\n#{1,2}\s+[^#])",
    re.S,
)

_FN_DEFS_BLOCK_RE = re.compile(
    r"^\[\^\d+\]:.*?(?=\n\[\^\d+\]:|\Z)",
    re.M | re.S,
)


def remove_noise(md: str) -> str:
    md = _TOC_BLOCK_RE.sub("", md)
    md = _FN_DEFS_BLOCK_RE.sub("", md)
    for pat in _NOISE_RE:
        md = pat.sub("", md)
    return md


# ---------------------------------------------------------------------------
# CLASSIFICAZIONE FRAMMENTI
# ---------------------------------------------------------------------------

_TOC_HDR_RE    = re.compile(r'^(sommario|indice|table of contents|contents)\s*$', re.IGNORECASE)
_TOC_PARENT_RE = re.compile(r'^(sommario|indice|table of contents|contents|premessa)\s*$', re.IGNORECASE)
_COVER_RE      = re.compile(
    r'^(codice\s+documento|versione|data\s+entrata|data\s+prossima|area\s+responsabile'
    r'|livello\s+di\s+accesso|parole\s+chiave|documento:|versione:|categoria:|prot\.)',
    re.IGNORECASE
)


def _is_toc_content(testo: str) -> bool:
    """Riconosce un vero indice/sommario basandosi sulla struttura delle righe."""
    righe = [r.strip() for r in testo.splitlines() if r.strip()]
    if len(righe) < 4:
        return False
    _TOC_LINE = re.compile(
        r'^(\d+[\.\d]*\s+.{5,}[\.\s]{3,}\d+$'
        r'|\d+[\.\d]*\s+.{5,}$'
        r'|[A-Z].{10,}[\.\s]{3,}\d+$)',
        re.IGNORECASE
    )
    bullet_righe = sum(1 for r in righe if r.startswith(('-', '*', '•', '+')))
    if bullet_righe / len(righe) > 0.4:
        return False
    voci_toc = sum(1 for r in righe if _TOC_LINE.match(r))
    return voci_toc / len(righe) > 0.60


def classifica(heading: str, testo: str, n_parole: int, h1_parent: str = None) -> tuple[str, bool]:
    """
    Ritorna (tipo, index_for_rag).
    tipo ∈ {'content', 'toc', 'cover', 'noise'}
    """
    testo_body = re.sub(r'^#{1,6}\s+.+$', '', testo, flags=re.MULTILINE).strip()
    if not testo_body:
        return 'noise', False
    if n_parole < MIN_WORDS_RAG:
        return 'noise', False

    h_clean = re.sub(r'\*{1,2}', '', (heading or '')).strip()
    if _TOC_HDR_RE.match(h_clean):
        return 'toc', False
    if h1_parent:
        p_clean = re.sub(r'\*{1,2}', '', h1_parent).strip()
        if _TOC_PARENT_RE.match(p_clean):
            return 'toc', False
    if sum(1 for l in testo.splitlines() if _COVER_RE.match(l.strip())) >= 2:
        return 'cover', False
    if _is_toc_content(testo):
        return 'toc', False
    return 'content', True


# ---------------------------------------------------------------------------
# BREADCRUMB E TESTO EMBEDDING
# ---------------------------------------------------------------------------

def build_breadcrumb(h1: str, h2: str, h3: str) -> str:
    def clean(h: str) -> Optional[str]:
        if not h:
            return None
        return re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', h).strip() or None
    return ' > '.join(p for p in [clean(h1), clean(h2), clean(h3)] if p)


def _normalizza_tabella_md(blocco: str) -> str:
    """
    Normalizza una tabella Markdown per EmbeddingGemma mantenendo
    il formato nativo (pipe + intestazioni) con tre miglioramenti:

    1. Colonne vuote eliminate
    2. Celle vuote / trattini solitari → "N/D"  (evita token semanticamente vuoti)
    3. Allineamento colonne → :--- (left-aligned, più pulito per il modello)

    La struttura Markdown viene PRESERVATA perché EmbeddingGemma è addestrato
    su enormi quantità di GitHub/docs e riconosce nativamente le tabelle Markdown.
    NON si converte in testo lineare.
    """
    _SEP_RE = re.compile(r'^[\|\-\s:]+$')

    righe_raw = [r for r in blocco.splitlines() if r.strip()]
    if not righe_raw:
        return ''

    def parse_celle(r: str) -> list[str]:
        r = r.strip()
        if r.startswith('|'):
            r = r[1:]
        if r.endswith('|'):
            r = r[:-1]
        return [c.strip() for c in r.split('|')]

    # Separa header / separatore / dati
    header: list[str] = []
    dati: list[list[str]] = []
    for riga in righe_raw:
        if _SEP_RE.match(riga.strip()):
            continue
        celle = parse_celle(riga)
        if not header:
            header = celle
        else:
            dati.append(celle)

    if not header:
        return blocco  # fallback

    # Padding colonne
    n_col = max(len(header), max((len(r) for r in dati), default=0))
    header = header + [''] * (n_col - len(header))
    dati = [r + [''] * (n_col - len(r)) for r in dati]

    # Elimina colonne interamente vuote
    col_attive = [
        ci for ci in range(n_col)
        if header[ci] or any(r[ci] for r in dati)
    ]
    header = [header[ci] for ci in col_attive]
    dati   = [[r[ci] for ci in col_attive] for r in dati]
    n_col  = len(header)

    # Sostituisci celle vuote e trattini solitari con N/D
    def _normalizza_cella(v: str) -> str:
        v = v.strip()
        if not v or v in ('-', '–', '—', '/', 'n/a', 'n.d.', 'nd'):
            return 'N/D'
        return v

    dati = [[_normalizza_cella(c) for c in riga] for riga in dati]
    header = [h if h else 'N/D' for h in header]

    # Ricostruisci tabella Markdown con allineamento left
    sep = '| ' + ' | '.join(':---' for _ in header) + ' |'
    hdr = '| ' + ' | '.join(header) + ' |'
    righe_out = [hdr, sep]
    for riga in dati:
        righe_out.append('| ' + ' | '.join(riga) + ' |')

    return '\n'.join(righe_out)


def _estrai_contesto_pre_tabella(righe: list[str], idx_tabella: int, max_frasi: int = 2) -> str:
    """
    Estrae le ultime `max_frasi` frasi di testo che precedono una tabella.
    Salta righe vuote e heading (# ...). Usato come descrizione contestuale
    nella struttura gold standard EmbeddingGemma.

    Esempio:
        "I candidati vengono valutati secondo i seguenti criteri di punteggio."
        → diventa la descrizione sopra la tabella dei punteggi
    """
    testo_pre: list[str] = []
    for j in range(idx_tabella - 1, max(idx_tabella - 20, -1), -1):
        riga = righe[j].strip()
        if not riga:
            continue
        if re.match(r'^#{1,6}\s', riga):
            break  # heading → stop, non è testo descrittivo
        if riga.startswith('|'):
            break  # altra tabella sopra
        testo_pre.insert(0, riga)
        if len(testo_pre) >= max_frasi:
            break

    if not testo_pre:
        return ''

    # Unisci in un unico paragrafo e taglia se troppo lungo
    descrizione = ' '.join(testo_pre)
    if len(descrizione) > 300:
        descrizione = descrizione[:300].rsplit(' ', 1)[0] + '…'
    return descrizione


def _processa_tabelle_nel_testo(testo: str, breadcrumb_tabella: str = '') -> str:
    """
    Trova i blocchi tabella nel testo, li normalizza con _normalizza_tabella_md
    e li arricchisce con il contesto gold standard EmbeddingGemma:

        ### {breadcrumb}
        {ultime 1-2 frasi che precedono la tabella nel chunk}

        | intestazione | ... |
        | :---         | ... |
        | valore       | ... |

    Il modello riceve così: titolo semantico + descrizione contestuale + dati strutturati.
    """
    righe = testo.split('\n')
    risultato: list[str] = []
    i = 0
    while i < len(righe):
        if righe[i].strip().startswith('|'):
            # Raccoglie il blocco tabella
            idx_inizio = i
            blocco: list[str] = []
            while i < len(righe) and righe[i].strip().startswith('|'):
                blocco.append(righe[i])
                i += 1

            tabella_norm = _normalizza_tabella_md('\n'.join(blocco))

            # Costruisci contesto: heading + descrizione pre-tabella
            contesto_parti: list[str] = []
            if breadcrumb_tabella:
                contesto_parti.append(f'### {breadcrumb_tabella}')
            descrizione = _estrai_contesto_pre_tabella(righe, idx_inizio)
            if descrizione:
                contesto_parti.append(descrizione)

            if contesto_parti:
                tabella_norm = '\n'.join(contesto_parti) + '\n\n' + tabella_norm

            risultato.append(tabella_norm)
        else:
            risultato.append(righe[i])
            i += 1
    return '\n'.join(risultato)


def prepara_testo_embedding(testo: str, breadcrumb: str = '', keep_bold: bool = True, documento_id: str = '') -> str:
    """
    Prepara il testo_embedding nel formato gold standard per EmbeddingGemma.

    Struttura output:
    ─────────────────────────────────────────────────────────
    Documento: {documento_id} | title: {breadcrumb} | text: {testo con Markdown preservato}
    ─────────────────────────────────────────────────────────

    Il prefisso "Documento:" permette al retriever di filtrare per fonte e
    contestualizza semanticamente il frammento nell'embedding space.

    Principi applicati (da documentazione EmbeddingGemma + best practice):

    1. MARKDOWN PRESERVATO — bold, italic, liste, heading nel testo
       EmbeddingGemma è addestrato su GitHub/docs e capisce nativamenete
       il Markdown; rimuoverlo degrada la qualità semantica.

    2. TABELLE → formato Markdown normalizzato (NON testo lineare)
       - Celle vuote / trattini → "N/D" (evita token semanticamente vuoti)
       - Colonne vuote eliminate
       - Heading ### contestuale anteposto alla tabella (gold standard)
       Il modello mantiene la relazione colonna→valore grazie ai separatori.

    3. HEADING # rimossi dal corpo — già nel title: del prompt, evita
       duplicazione. Safety-net ridondante con strip_headers=True di LangChain.

    4. PROMPT NATIVO EmbeddingGemma (model card Google):
       "title: {breadcrumb | none} | text: ..."
       Allinea lo spazio vettoriale documento con le query che useranno:
       "task: search result | query: ..."  (o "task: question answering | ...")

    5. NORMALIZZAZIONE spazi — rimuove spazi multipli e newline eccessivi.

    Esempio output con tabella:
        title: Criteri graduatoria | text: Punteggi ammissione

        ### Criteri graduatoria
        | Requisito | Criterio | Punteggio |
        | :--- | :--- | :--- |
        | Voto diploma | Da 90 a 100 | 9 |
        | Voto diploma | Da 80 a 89 | 7 |

    ⚠  Lato backend/query, anteponi SEMPRE il prompt:
       "task: search result | query: {domanda}"
       "task: question answering | query: {domanda}"
    """
    t = testo

    # 1. Rimuovi marcatori # (safety-net, LangChain li toglie già con strip_headers=True)
    t = re.sub(r'^#{1,6}\s+', '', t, flags=re.MULTILINE)

    # 2. Normalizza tabelle Markdown (preserva struttura, fix celle vuote + heading)
    t = _processa_tabelle_nel_testo(t, breadcrumb_tabella=breadcrumb)

    # 3. Bold/italic — mantenuti per default (keep_bold=True)
    #    EmbeddingGemma capisce il grassetto come enfasi semantica
    if not keep_bold:
        t = re.sub(r'\*{2}([^*\n]+)\*{2}', r'\1', t)
        t = re.sub(r'\*([^*\n]+)\*', r'\1', t)
        t = re.sub(r'_{2}([^_\n]+)_{2}', r'\1', t)
        t = re.sub(r'_([^_\n]+)_', r'\1', t)

    # 4. Normalizza spazi
    t = re.sub(r'[ \t]{2,}', ' ', t)
    t = re.sub(r'\n{3,}', '\n\n', t).strip()

    # 5. Prompt nativo EmbeddingGemma per documenti
    #    Formato: "Documento: {doc_id} | title: {breadcrumb} | text: {testo}"
    #    Il prefisso Documento consente al retriever di filtrare/identificare la fonte.
    title_val = breadcrumb.strip() if breadcrumb else 'none'
    doc_prefix = f'Documento: {documento_id} | ' if documento_id else ''
    return f'{doc_prefix}title: {title_val} | text: {t}'  


# ---------------------------------------------------------------------------
# MAPPA PAGINE (opzionale — file _pages.json accanto al .md)
# ---------------------------------------------------------------------------

def carica_mappa_pagine(md_path: Path) -> dict:
    p = md_path.with_name(md_path.stem + '_pages.json')
    if p.exists():
        return json.loads(p.read_text(encoding='utf-8'))
    return {}


def trova_pagina(heading: str, mappa: dict) -> Optional[int]:
    """
    Cerca la pagina nella mappa _pages.json.
    Prova in cascata: match esatto → case-insensitive → strip asterischi.
    'heading' è h3 or h2 or h1 (chiamante), ma qui accettiamo anche
    una lista di candidati per provare H3 → H2 → H1 in ordine.
    """
    if not mappa:
        return None
    if not heading:
        return None

    def _cerca(h: str) -> Optional[int]:
        if not h:
            return None
        if h in mappa:
            return mappa[h]
        hl = h.lower().strip()
        h_clean = re.sub(r'\*+', '', hl).strip()
        for k, v in mappa.items():
            kl = re.sub(r'\*+', '', k.lower().strip())
            if kl == hl or kl == h_clean:
                return v
        return None

    return _cerca(heading)


def trova_pagina_cascade(h1: str, h2: str, h3: str, mappa: dict) -> Optional[int]:
    """Prova H3 → H2 → H1 restituendo la prima pagina trovata."""
    for h in (h3, h2, h1):
        r = trova_pagina(h, mappa)
        if r is not None:
            return r
    return None


# ---------------------------------------------------------------------------
# ESTRAZIONE METADATI DOCUMENTO
# ---------------------------------------------------------------------------

# I label nei documenti Markdown possono apparire in diverse forme:
#   **Label:** valore        ← bold con ":**" dentro il bold
#   **Label**:   valore      ← bold solo sul label, ":" fuori
#   **Label**: valore        ← idem
#   Label: valore            ← plain
#
# Il pattern _LABEL() gestisce tutti i casi:
#   \*{0,2}  <label>  (?:\*{0,2})  \s*[:\-]\s*
def _LABEL(label_re: str) -> str:
    """Restituisce un pattern che matcha label in plain o bold Markdown."""
    return r'\*{0,2}' + label_re + r'(?:\*{0,2}:?\*{0,2})' + r'\s*:?\s*'

# Blocco data: supporta  gg Mese aaaa  |  Mese aaaa  |  gg/mm/aaaa  |  aaaa-mm-gg
_DATA_BLOCK = (
    r'(\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto'
    r'|settembre|ottobre|novembre|dicembre)\s+\d{4}'          # gg Mese aaaa
    r'|(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto'
    r'|settembre|ottobre|novembre|dicembre)\s+\d{4}'          # Mese aaaa
    r'|\d{1,2}[/\.\-]\d{1,2}[/\.\-]\d{2,4}'                  # gg/mm/aaaa
    r'|\d{4}[/\.\-]\d{1,2}[/\.\-]\d{1,2})'                   # aaaa-mm-gg
)

_META_PATTERNS = {
    # **Codice Documento:** ETH-COD-001  |  **Documento:** FORM-002  |  Documento: ...
    'documento_id': re.compile(
        _LABEL(r'(?:codice\s+)?documento')
        + r'([A-Z][A-Z0-9\-_]{2,})',
        re.IGNORECASE,
    ),

    # **Versione:** 3.2  |  Versione: 2.4  |  v2.4  |  Rev. 3
    'versione': re.compile(
        _LABEL(r'versione')
        + r'(?:v\.?)?(\d+[\.\d]*)',
        re.IGNORECASE,
    ),

    # Data validità / entrata in vigore — etichette IT + EN, con o senza bold
    'data_validita': re.compile(
        _LABEL(
            r'(?:data\s+(?:entrata\s+in\s+vigore|validit[àa]|di\s+emissione|emissione|vigore|inizio)'
            r'|effective\s+date|issue\s+date|start\s+date|data)'
        )
        + _DATA_BLOCK,
        re.IGNORECASE,
    ),

    # Data scadenza / prossima revisione — etichette IT + EN, con o senza bold
    'data_scadenza': re.compile(
        _LABEL(
            r'(?:data\s+(?:prossima\s+revisione|scadenza|revisione|rinnovo|aggiornamento)'
            r'|prossima\s+(?:revisione|review)'
            r'|next\s+(?:review|revision)'
            r'|expir[yi]\s*(?:date)?'
            r'|review\s+date'
            r'|prossima\s+review)'
        )
        + _DATA_BLOCK,
        re.IGNORECASE,
    ),

    'area_responsabile': re.compile(
        _LABEL(r'area\s+responsabile') + r'([^\n\*]+)',
        re.IGNORECASE,
    ),
    'livello_accesso': re.compile(
        _LABEL(r'livello\s+di\s+accesso') + r'([^\n\*]+)',
        re.IGNORECASE,
    ),
    'keywords_raw': re.compile(
        _LABEL(r'(?:parole\s+chiave|keywords?)') + r'([^\n\*]+)',
        re.IGNORECASE,
    ),
}

# ── Regex secondari / fallback più larghi ─────────────────────────────────────

# Date in formato italiano con giorno opzionale: "14 Gennaio 2024" o "Gennaio 2024"
_DATE_IT_RE = re.compile(
    r'\b(?:(\d{1,2})\s+)?(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto'
    r'|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b',
    re.IGNORECASE,
)
_DATE_NUM_RE = re.compile(r'\b(\d{1,2})[/\.\-](\d{1,2})[/\.\-](\d{2,4})\b')

# Versione autonoma: "Rev. 2.1" | "Ver. 3" | "v1.0" | "Vers. 2.4" | "Version: 4.0"
_VERSION_RE2 = re.compile(
    r'\b(?:rev(?:isione)?\.?|vers?(?:ione)?\.?|version|v\.?)\s*[:\-]?\s*(\d+[\.\d]*)',
    re.IGNORECASE,
)

# ── Regex contestuale date (a livello modulo, non ridefinito ad ogni chiamata) ─
# Etichette IT + EN che introducono una data in una riga
_DATE_CTX_RE = re.compile(
    r'(?:\*{0,2})'                                  # bold opzionale
    r'((?:data|date|ultimo\s+aggiornamento|last\s+update|prossima\s+review'
    r'|next\s+review|effective|expir\w*|review)\s*\w*\s*\w*)'
    r'(?:\*{0,2})'
    r'\s*[:\-]\s*'
    + _DATA_BLOCK,
    re.IGNORECASE,
)
_VIGORE_WORDS   = {
    'vigore', 'validita', 'validità', 'emissione', 'entrata', 'inizio',
    'effective', 'issue', 'start', 'data',
}
_SCADENZA_WORDS = {
    'revisione', 'scadenza', 'prossima', 'rinnovo', 'aggiornamento', 'fine',
    'review', 'next', 'expiry', 'expiration', 'expiring',
}

_MESI_IT = {
    'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4,
    'maggio': 5, 'giugno': 6, 'luglio': 7, 'agosto': 8,
    'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12,
}


def _normalizza_data(raw: str) -> str:
    """
    Normalizza una stringa data:
      - Rimuove bold Markdown residui (**) e punteggiatura finale
      - Capitalizza i mesi italiani scritti
      - Supporta date senza giorno: "gennaio 2024" → "Gennaio 2024"
    """
    raw = raw.strip().strip('*').rstrip('.- ')
    for mese in _MESI_IT:
        raw = re.sub(r'\b' + mese + r'\b', mese.capitalize(), raw, flags=re.IGNORECASE)
    return raw


def _parse_data(s: str) -> Optional[tuple[int, int, int]]:
    """
    Converte una stringa data normalizzata in (anno, mese, giorno) confrontabile.
    Per date senza giorno (es. "Gennaio 2024") usa giorno=1 come convenzione.
    Ritorna None se non riesce a parsare.

    Formati supportati:
      "14 Gennaio 2024"  →  (2024, 1, 14)
      "Gennaio 2024"     →  (2024, 1, 1)    ← mese senza giorno
      "01/05/2024"       →  (2024, 5, 1)
      "2024-05-01"       →  (2024, 5, 1)
    """
    if not s:
        return None
    s = s.strip().strip('*')

    mesi_pat = '|'.join(_MESI_IT.keys())

    # "14 Gennaio 2024"
    m = re.match(rf'(\d{{1,2}})\s+({mesi_pat})\s+(\d{{4}})', s, re.IGNORECASE)
    if m:
        return (int(m.group(3)), _MESI_IT[m.group(2).lower()], int(m.group(1)))

    # "Gennaio 2024"  (senza giorno → giorno=1)
    m = re.match(rf'({mesi_pat})\s+(\d{{4}})', s, re.IGNORECASE)
    if m:
        return (int(m.group(2)), _MESI_IT[m.group(1).lower()], 1)

    # "01/05/2024"  gg/mm/aaaa
    m = re.match(r'(\d{1,2})[/\.\-](\d{1,2})[/\.\-](\d{4})', s)
    if m:
        g, me, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= me <= 12 and 1 <= g <= 31:
            return (a, me, g)

    # "2024-05-01"  ISO
    m = re.match(r'(\d{4})[/\.\-](\d{1,2})[/\.\-](\d{1,2})', s)
    if m:
        a, me, g = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= me <= 12 and 1 <= g <= 31:
            return (a, me, g)

    return None


def _valida_date(meta: dict) -> dict:
    """
    Verifica che data_scadenza >= data_validita.

    Casi gestiti:
      - Se solo una delle due è presente: nessuna modifica.
      - Se entrambe presenti e data_scadenza < data_validita:
          → le scambia automaticamente e stampa un warning.
      - Se il parsing di una data fallisce: lascia le stringhe invariate
          e stampa un warning.
    """
    dv_str = meta.get('data_validita')
    ds_str = meta.get('data_scadenza')

    if not dv_str or not ds_str:
        return meta  # niente da validare

    dv = _parse_data(dv_str)
    ds = _parse_data(ds_str)

    if dv is None or ds is None:
        print(f"   ⚠️  Date non confrontabili — validità: {dv_str!r}  scadenza: {ds_str!r}")
        return meta

    if ds < dv:
        print(
            f"   ⚠️  data_scadenza ({ds_str}) < data_validita ({dv_str}) "
            f"— date scambiate automaticamente"
        )
        meta['data_validita'], meta['data_scadenza'] = ds_str, dv_str

    return meta


def estrai_metadati(contenuto: str, file_stem: str) -> dict:
    """
    Estrae i metadati del documento dall'intero contenuto Markdown
    (la ricerca NON è limitata alle prime righe: i metadati possono trovarsi
    ovunque, ad esempio in un frontmatter in fondo o in una sezione dedicata).

    Strategia a cascata:
      1. Pattern primari su tutto il documento
      2. Fallback specifici per versione e date
      3. Scansione riga-per-riga sull'intero testo
      4. Regex generici sull'intero testo
    """
    zona       = contenuto                    # intero documento
    zona_righe = contenuto.splitlines()       # tutte le righe
    zona_ext   = contenuto                    # alias per chiarezza nei fallback

    meta: dict = {
        'documento_id':       None,
        'versione':           None,
        'data_validita':      None,
        'data_scadenza':      None,
        'area_responsabile':  None,
        'livello_accesso':    None,
        'keywords_documento': [],
    }

    # ── 1. Pattern primari ────────────────────────────────────────────────────
    for campo, pat in _META_PATTERNS.items():
        m = pat.search(zona)
        if m:
            val = m.group(1).strip().rstrip('- ')
            if campo == 'keywords_raw':
                meta['keywords_documento'] = [k.strip() for k in re.split(r'[,;]', val) if k.strip()]
            elif campo in ('data_validita', 'data_scadenza'):
                meta[campo] = _normalizza_data(val)
            else:
                meta[campo] = val or None

    # ── 2. Fallback versione ──────────────────────────────────────────────────
    if not meta['versione']:
        m = _VERSION_RE2.search(zona_ext)
        if m:
            meta['versione'] = m.group(1).strip()

    # ── 3. Fallback date — scansione riga per riga sull'intero documento ────────
    # Raccoglie tutte le date trovate con il loro contesto testuale
    date_trovate: list[tuple[str, str]] = []  # (label, valore_normalizzato)
    for riga in zona_righe:
        for m in _DATE_CTX_RE.finditer(riga):
            label = m.group(1).lower()
            valore = _normalizza_data(m.group(2))
            date_trovate.append((label, valore))

    # Assegna le date ai campi giusti in base alle parole chiave nel label
    for label, valore in date_trovate:
        words = set(re.findall(r'\w+', label))
        if not meta['data_validita'] and words & _VIGORE_WORDS:
            meta['data_validita'] = valore
        elif not meta['data_scadenza'] and words & _SCADENZA_WORDS:
            meta['data_scadenza'] = valore

    # ── 4. Fallback generico date se ancora mancanti ─────────────────────────
    if not meta['data_validita'] or not meta['data_scadenza']:
        # Cerca date in formato italiano scritto, giorno opzionale
        dates_it = []
        for m in _DATE_IT_RE.finditer(zona_ext):
            giorno = m.group(1)   # può essere None se solo "Mese aaaa"
            mese   = m.group(2).capitalize()
            anno   = m.group(3)
            data_str = f"{giorno} {mese} {anno}" if giorno else f"{mese} {anno}"
            dates_it.append(data_str)
        # Cerca date numeriche
        dates_num = [
            f"{m.group(1)}/{m.group(2)}/{m.group(3)}"
            for m in _DATE_NUM_RE.finditer(zona_ext)
            if len(m.group(3)) == 4 and int(m.group(2)) <= 12
        ]
        all_dates = dates_it + dates_num

        if all_dates and not meta['data_validita']:
            meta['data_validita'] = all_dates[0]
        if len(all_dates) >= 2 and not meta['data_scadenza']:
            meta['data_scadenza'] = all_dates[1]

    # ── 5. Fallback documento_id ──────────────────────────────────────────────
    if not meta['documento_id']:
        # Prova pattern "[A-Z]{2,}-[A-Z]{2,}-\d{3}" tipico dei codici documento
        m = re.search(r'\b([A-Z]{2,}(?:\-[A-Z0-9]{2,})+)\b', zona)
        if m:
            meta['documento_id'] = m.group(1).strip()

    if not meta['documento_id']:
        for pat in (
            re.compile(r'^documento\s*[:\-]\s*(.+)$', re.IGNORECASE | re.MULTILINE),
            re.compile(r'codice\s+documento\s*[:\-]\s*([A-Z][A-Z0-9\-_]{2,})', re.IGNORECASE),
            re.compile(r'documento\s*[:\-]\s*([A-Z][A-Z0-9\-_]{2,})', re.IGNORECASE),
        ):
            m = pat.search(zona)
            if m:
                meta['documento_id'] = m.group(1).strip()
                break

    # ── 6. Fallback finale: primo H1 o nome file ──────────────────────────────
    if not meta['documento_id']:
        for line in contenuto.splitlines()[:20]:
            m = re.match(r'^#\s+(.+)', line)
            if m:
                meta['documento_id'] = re.sub(r'\*+', '', m.group(1)).strip()
                break

    if not meta['documento_id']:
        meta['documento_id'] = _clean_doc_id(file_stem)

    # ── 7. Validazione coerenza date ─────────────────────────────────────────
    meta = _valida_date(meta)

    return meta



# ---------------------------------------------------------------------------
# LANGCHAIN SPLITTER
# ---------------------------------------------------------------------------

def split_documento(contenuto_md: str) -> list[dict]:
    """
    Usa MarkdownHeaderTextSplitter per dividere il documento per sezione,
    poi RecursiveCharacterTextSplitter per sub-dividere i chunk troppo grandi.

    Ritorna una lista di dict con chiavi: h1, h2, h3, testo.
    """
    md_splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=HEADERS_TO_SPLIT,
        strip_headers=True,        # heading nel breadcrumb, non nel testo (evita duplicazione nei sub-chunk)
        return_each_line=False,
    )
    rc_splitter = RecursiveCharacterTextSplitter(
        chunk_size=MAX_CHUNK_CHARS,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    risultati: list[dict] = []
    for doc in md_splitter.split_text(contenuto_md):
        meta  = doc.metadata
        h1    = meta.get('h1') or None
        h2    = meta.get('h2') or None
        h3    = meta.get('h3') or None
        testo = doc.page_content.strip()

        if len(testo) > MAX_CHUNK_CHARS:
            # Sub-split ricorsivo mantenendo i metadati di sezione
            for sd in rc_splitter.create_documents([testo], metadatas=[meta]):
                risultati.append({
                    'h1': h1, 'h2': h2, 'h3': h3,
                    'testo': sd.page_content.strip(),
                })
        else:
            risultati.append({'h1': h1, 'h2': h2, 'h3': h3, 'testo': testo})

    return risultati


# ---------------------------------------------------------------------------
# FUSIONE E MERGING POST-SPLIT
# ---------------------------------------------------------------------------

def _fonde_heading_vuoti(sezioni: list[dict]) -> list[dict]:
    """
    Pass 1 — Fusione preventiva: chunk con solo heading (nessun body reale)
    vengono uniti al frammento successivo.
    """
    fuse: list[dict] = []
    i = 0
    while i < len(sezioni):
        sez = sezioni[i]
        testo_body = re.sub(
            r'^#{1,6}\s+\*{0,2}.+\*{0,2}\s*$', '',
            sez['testo'], flags=re.MULTILINE
        ).strip()
        solo_heading = not testo_body
        if solo_heading and i + 1 < len(sezioni):
            prossimo = sezioni[i + 1].copy()
            prossimo['testo'] = sez['testo'] + "  \n" + prossimo['testo']
            sezioni[i + 1] = prossimo
            i += 1
            continue
        fuse.append(sez)
        i += 1
    return fuse


def _merge_piccoli(sezioni: list[dict], min_words: int) -> list[dict]:
    """
    Pass 2 — Merging: chunk < min_words vengono fusi con il successivo
    se condividono lo stesso H2 (poi, se ancora piccolo, lo stesso H1).
    """
    def merge_pass(chunks: list[dict], campo: str) -> list[dict]:
        merged: list[dict] = []
        i = 0
        while i < len(chunks):
            c = dict(chunks[i])
            while (
                count_words(c['testo']) < min_words
                and i + 1 < len(chunks)
                and chunks[i + 1][campo] == c[campo]
            ):
                nxt = chunks[i + 1]
                c = {
                    'h1': c['h1'] or nxt['h1'],
                    'h2': c['h2'] or nxt['h2'],
                    'h3': c['h3'] or nxt['h3'],
                    'testo': c['testo'] + "\n\n" + nxt['testo'],
                }
                i += 1
            merged.append(c)
            i += 1
        return merged

    sezioni = merge_pass(sezioni, 'h2')
    sezioni = merge_pass(sezioni, 'h1')

    # Pass 3 — fallback incondizionato: chunk < 30 parole fuso con il successivo
    # indipendentemente dall'heading. Evita chunk troppo corti per il RAG
    # (es. sezioni di una sola frase come "4. Sede dei corsi").
    ABSOLUTE_MIN = 30
    merged: list[dict] = []
    i = 0
    while i < len(sezioni):
        c = dict(sezioni[i])
        if count_words(c['testo']) < ABSOLUTE_MIN and i + 1 < len(sezioni):
            nxt = sezioni[i + 1]
            c = {
                'h1': c['h1'] or nxt['h1'],
                'h2': c['h2'] or nxt['h2'],
                'h3': c['h3'] or nxt['h3'],
                'testo': c['testo'] + '\n\n' + nxt['testo'],
            }
            i += 1  # salta il successivo già assorbito
        merged.append(c)
        i += 1
    sezioni = merged

    return sezioni


# ---------------------------------------------------------------------------
# PROCESSA SINGOLO FILE MD
# ---------------------------------------------------------------------------

def _clean_doc_id(stem: str) -> str:
    """
    Rimuove suffissi tecnici comuni dal nome file per ottenere il document_id pulito
    (es. 'ETH-COD-001_fixed' → 'ETH-COD-001', 'OPS-MAN-001_v2_fixed' → 'OPS-MAN-001_v2').
    """
    # Rimuove _fixed, _clean, _processed, _raw (case-insensitive) alla fine
    cleaned = re.sub(r'[_\-](fixed|clean|cleaned|processed|raw|output|final)$', '', stem, flags=re.IGNORECASE)
    return cleaned or stem


def processa_md(md_path: Path) -> dict:
    """
    Elabora un singolo file Markdown e restituisce il dict con schema:
    { "documento": {...}, "frammenti": [...] }
    """
    doc_id    = _clean_doc_id(md_path.stem)   # rimuove _fixed e suffissi tecnici
    contenuto = md_path.read_text(encoding='utf-8', errors='replace')
    contenuto = normalize_text(contenuto)

    # 1. Estrai footnote PRIMA di qualsiasi pulizia
    fn_map = extract_footnotes(contenuto)

    # 2. Rimuovi rumore
    contenuto_clean = remove_noise(contenuto)

    # 3. Metadati documento (ricerca sull'intero testo originale, prima dello split)
    meta_doc = estrai_metadati(contenuto, doc_id)

    # 4. Mappa pagine (opzionale)
    mappa = carica_mappa_pagine(md_path)
    if mappa:
        print(f"   🗺️  Mappa pagine: {len(mappa)} heading tracciati")
    else:
        print(f"   ⚠️  Nessun _pages.json — anchor_link non disponibile")

    # 5. Split con LangChain (MarkdownHeader + Recursive)
    sezioni = split_documento(contenuto_clean)
    print(f"   ✂️  Frammenti LangChain: {len(sezioni)}")

    # 6. Fusione heading vuoti + merging chunk piccoli
    sezioni = _fonde_heading_vuoti(sezioni)
    sezioni = _merge_piccoli(sezioni, min_words=MIN_WORDS_RAG)

    # 7. Costruzione frammenti con schema chunker.py
    frammenti: list[dict] = []
    for idx, sez in enumerate(sezioni):
        testo      = sez['testo']
        h1, h2, h3 = sez['h1'], sez['h2'], sez['h3']
        heading    = h3 or h2 or h1 or ''
        breadcrumb = build_breadcrumb(h1, h2, h3)
        n_parole   = count_words(testo)
        n_car      = len(testo)
        parent     = h1 if (h2 or h3) else None

        tipo, index_for_rag = classifica(heading, testo, n_parole, h1_parent=parent)
        pagina     = trova_pagina_cascade(h1, h2, h3, mappa)
        anchor     = f"{STATIC_PDF_PATH}{doc_id}.pdf#page={pagina}" if pagina else None

        # Iniezione footnote nel testo del frammento
        testo_con_fn = inject_footnotes(testo, fn_map)

        keywords   = estrai_keywords(heading, testo_con_fn) if index_for_rag else []
        testo_emb  = prepara_testo_embedding(testo_con_fn, breadcrumb, keep_bold=True, documento_id=meta_doc['documento_id'])

        frammenti.append({
            'id':              str(uuid.uuid4()),
            'chunk_index':     idx,
            'tipo':            tipo,
            'index_for_rag':   index_for_rag,
            'breadcrumb':      breadcrumb,
            'h1':              h1,
            'h2':              h2,
            'h3':              h3,
            'pagina':          pagina,
            'anchor_link':     anchor,
            'keywords':        keywords,
            'testo':           testo_con_fn,
            'testo_embedding': testo_emb,
            'n_parole':        n_parole,
            'n_caratteri':     n_car,
            'documento_id':    meta_doc['documento_id'],
        })

    n_rag = sum(1 for f in frammenti if f['index_for_rag'])
    print(f"   📦 Totali: {len(frammenti)} | RAG: {n_rag} | scartati: {len(frammenti) - n_rag}")

    return {
        'documento': {
            'id':                 doc_id,
            'file_md':            md_path.name,
            'documento_id':       meta_doc['documento_id'],
            'versione':           meta_doc['versione'],
            'data_validita':      meta_doc['data_validita'],
            'data_scadenza':      meta_doc['data_scadenza'],
            'area_responsabile':  meta_doc['area_responsabile'],
            'livello_accesso':    meta_doc['livello_accesso'],
            'keywords_documento': meta_doc['keywords_documento'],
            'n_frammenti':        len(frammenti),
            'n_frammenti_rag':    n_rag,
        },
        'frammenti': frammenti,
    }


# ---------------------------------------------------------------------------
# PIPELINE BATCH (una cartella → un JSON per documento)
# ---------------------------------------------------------------------------

def processa_cartella(input_path: str, output_path: str) -> None:
    """
    Elabora tutti i .md in input_path e salva un _chunks.json per ognuno
    in output_path.
    """
    inp = Path(input_path)
    out = Path(output_path)
    out.mkdir(parents=True, exist_ok=True)

    md_files = sorted([
        f for f in inp.glob('*.md')
        if not f.stem.endswith('_raw')
    ])

    if not md_files:
        print(f"❌ Nessun .md trovato in: {inp}")
        return

    print(f"📂 Input  : {inp}")
    print(f"📂 Output : {out}")
    print(f"📄 File   : {len(md_files)}")
    for f in md_files:
        print(f"   • {f.name}")
    print(f"\n⚙️  MAX_CHUNK_CHARS={MAX_CHUNK_CHARS} | OVERLAP={CHUNK_OVERLAP} | MIN_WORDS_RAG={MIN_WORDS_RAG}")

    tot_fram = tot_rag = 0
    risultati: list[dict] = []

    for i, md_file in enumerate(md_files, 1):
        print(f"\n[{i}/{len(md_files)}] {md_file.name}")
        try:
            dati     = processa_md(md_file)
            out_file = out / f"{md_file.stem}_chunks.json"
            out_file.write_text(
                json.dumps(dati, ensure_ascii=False, indent=2),
                encoding='utf-8'
            )
            n  = dati['documento']['n_frammenti']
            nr = dati['documento']['n_frammenti_rag']
            tot_fram += n
            tot_rag  += nr
            d = dati['documento']
            print(f"   📋 documento_id  : {d['documento_id']}")
            print(f"   📋 versione      : {d['versione']}")
            print(f"   📋 data_validita : {d['data_validita']}")
            print(f"   📋 keywords_doc  : {d['keywords_documento']}")
            print(f"   ✅ Salvato: {out_file.name}")
            risultati.append({'file': md_file.name, 'status': 'ok', 'n': n, 'rag': nr})
        except Exception as e:
            import traceback; traceback.print_exc()
            risultati.append({'file': md_file.name, 'status': 'errore', 'errore': str(e)})

    ok  = [r for r in risultati if r['status'] == 'ok']
    err = [r for r in risultati if r['status'] == 'errore']

    print(f"\n{'='*50}")
    print(f"✅ CHUNKING COMPLETATO")
    print(f"{'='*50}")
    print(f"📄 Documenti     : {len(ok)}/{len(md_files)}")
    print(f"📦 Frammenti tot : {tot_fram}")
    print(f"🔍 Per RAG       : {tot_rag}")
    if err:
        print(f"❌ Errori: {len(err)}")
        for r in err:
            print(f"   • {r['file']}: {r['errore']}")
    if ok:
        print(f"\n{'File':<40} {'Fram':>6} {'RAG':>6}")
        print("─" * 55)
        for r in ok:
            print(f"  {r['file']:<38} {r['n']:>6} {r['rag']:>6}")


# ---------------------------------------------------------------------------
# PIPELINE FILE SINGOLO / GLOB → JSON UNICO
# ---------------------------------------------------------------------------

def processa_files(
    filepaths:  list[Path],
    output_file: Path,
    pretty: bool = True,
) -> None:
    """
    Elabora una lista di file Markdown e scrive un singolo JSON
    con lista di documenti: [ {documento: ..., frammenti: [...]}, ... ]
    """
    tutti: list[dict] = []
    for fp in filepaths:
        print(f"\n▶  {fp.name}")
        try:
            dati = processa_md(fp)
            tutti.append(dati)
        except Exception:
            import traceback; traceback.print_exc()

    indent = 2 if pretty else None
    output_file.write_text(
        json.dumps(tutti, ensure_ascii=False, indent=indent),
        encoding='utf-8'
    )
    tot_f = sum(d['documento']['n_frammenti']     for d in tutti)
    tot_r = sum(d['documento']['n_frammenti_rag'] for d in tutti)
    print(f"\n[OK] Scritto: {output_file}  ({output_file.stat().st_size // 1024} KB)")
    print(f"[OK] Documenti: {len(tutti)} | Frammenti: {tot_f} | RAG: {tot_r}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

DEFAULT_INPUT  = r'C:\Users\PC_A26\Desktop\programmi\TirocinioAI\backend\output_json'
DEFAULT_OUTPUT = r'C:\Users\PC_A26\Desktop\programmi\TirocinioAI\backend\chunks'


def main() -> None:
    global MAX_CHUNK_CHARS, CHUNK_OVERLAP, MIN_WORDS_RAG

    parser = argparse.ArgumentParser(
        description=(
            "RAG Chunker — segmenta documenti Markdown in chunk JSON\n"
            "ottimizzati per embedding usando LangChain splitters.\n\n"
            "Modalità:\n"
            "  --batch     : processa una cartella, un JSON per file (default)\n"
            "  --merge     : tutti i file → un unico JSON con lista documenti\n\n"
            "Esempi:\n"
            "  python rag_chunker.py\n"
            "  python rag_chunker.py -i /docs -o /out\n"
            "  python rag_chunker.py -i *.md -o all_chunks.json --merge\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--input',     '-i', default=DEFAULT_INPUT,
                        help=f'Cartella .md o glob (default: {DEFAULT_INPUT})')
    parser.add_argument('--output',    '-o', default=DEFAULT_OUTPUT,
                        help=f'Cartella output (batch) o file .json (merge) (default: {DEFAULT_OUTPUT})')
    parser.add_argument('--merge',     action='store_true',
                        help='Unisce tutti i documenti in un singolo JSON')
    parser.add_argument('--no-pretty', action='store_true',
                        help='Output JSON compatto (nessuna indentazione)')
    parser.add_argument('--max-chars', type=int, default=MAX_CHUNK_CHARS,
                        help=f'Dimensione max chunk in caratteri (default: {MAX_CHUNK_CHARS})')
    parser.add_argument('--overlap',   type=int, default=CHUNK_OVERLAP,
                        help=f'Overlap in caratteri tra sub-chunk (default: {CHUNK_OVERLAP})')
    parser.add_argument('--min-words', type=int, default=MIN_WORDS_RAG,
                        help=f'Parole minime per indicizzare un frammento (default: {MIN_WORDS_RAG})')
    args = parser.parse_args()

    # Applica override configurazione
    MAX_CHUNK_CHARS = args.max_chars
    CHUNK_OVERLAP   = args.overlap
    MIN_WORDS_RAG   = args.min_words

    # Risolvi input: cartella, file singolo o glob
    filepaths: list[Path] = []
    inp = Path(args.input)
    if inp.is_dir():
        # Cartella: prendi tutti i _fixed.md (escludi _raw)
        filepaths = sorted([
            f for f in inp.glob('*.md')
            if not f.stem.endswith('_raw')
        ])
    elif inp.exists() and inp.suffix == '.md':
        # File singolo
        filepaths = [inp]
    else:
        # Glob pattern (es. "docs/*.md")
        matches = glob_module.glob(args.input)
        filepaths = sorted([
            Path(m) for m in matches
            if Path(m).suffix == '.md' and not Path(m).stem.endswith('_raw')
        ])

    if not filepaths:
        print(f"❌ Nessun file .md trovato per: {args.input}")
        return

    print(f"📄 File da elaborare: {len(filepaths)}")
    for fp in filepaths:
        print(f"   • {fp.name}")
    print(f"\n⚙️  max_chars={MAX_CHUNK_CHARS} | overlap={CHUNK_OVERLAP} | min_words={MIN_WORDS_RAG}")

    if args.merge:
        out_file = Path(args.output)
        if out_file.is_dir() or not out_file.suffix:
            out_file = out_file / 'rag_chunks.json'
        out_file.parent.mkdir(parents=True, exist_ok=True)
        processa_files(filepaths, out_file, pretty=not args.no_pretty)
    else:
        processa_cartella(str(filepaths[0].parent), args.output)


if __name__ == '__main__':
    main()
