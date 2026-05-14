# app/services/mistral_ocr_service.py
"""
mistral_ocr_service.py
======================
Pipeline OCR + Chunking basata su Mistral OCR API.

Sostituisce COMPLETAMENTE:
  - marker_service.py        (conversione PDF → testo)
  - postprocessor_service.py (pulizia Markdown)
  - rag_chunker.py           (segmentazione in chunk)

Il Loader (loader_service.py) rimane INVARIATO perché il JSON
prodotto da questo servizio è identico allo schema del rag_chunker.

Flusso:
  PDF → Mistral OCR API → pagine Markdown → chunk ibridi → JSON

Strategia di chunking ibrida (per pagina + per heading):
  1. Mistral OCR restituisce il testo diviso per pagina (già strutturato)
  2. Ogni pagina viene analizzata per trovare heading H1/H2/H3
  3. Se una pagina contiene più sezioni vengono separate
  4. Se un chunk è troppo lungo (> MAX_CHUNK_CHARS) viene ulteriormente
     diviso per paragrafi
  5. Chunk troppo corti (< MIN_WORDS) vengono fusi con il successivo
  6. Ogni chunk mantiene il numero di pagina originale → link PDF funzionanti

Perché è meglio del setup precedente:
  - Zero dipendenze hardware (no GPU, no modelli locali da 600MB+)
  - Mistral OCR gestisce PDF scansionati, tabelle, layout complessi
  - Il testo estratto è più pulito (no artefatti OCR da Marker su CPU)
  - La pipeline è più veloce (API cloud vs inferenza locale)
  - Meno codice da mantenere (3 servizi → 1)

Schema JSON prodotto (identico a rag_chunker.py):
{
  "documento": { "id", "file_pdf", "documento_id", "versione",
                 "n_frammenti", "n_frammenti_rag", ... },
  "frammenti": [ { "id", "chunk_index", "tipo", "index_for_rag",
                   "breadcrumb", "h1", "h2", "h3", "pagina",
                   "anchor_link", "keywords", "testo",
                   "testo_embedding", "n_parole", "n_caratteri",
                   "documento_id" } ]
}
"""

from __future__ import annotations

import os
import re
import uuid
import json
import math
import time
import logging
import unicodedata
from pathlib import Path
from collections import Counter
from typing import Callable, Optional

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
MAX_CHUNK_CHARS  = 5500   # chunk più lungo accettato prima di spezzare
MIN_WORDS        = 15     # chunk con meno parole vengono fusi o scartati
CHUNK_OVERLAP    = 0      # overlap in caratteri (non necessario con split per heading)
STATIC_PDF_PATH  = "/static/"
MISTRAL_OCR_URL  = "https://api.mistral.ai/v1/ocr"
MISTRAL_FILE_URL = "https://api.mistral.ai/v1/files"

# ---------------------------------------------------------------------------
# STOPWORDS (identiche a rag_chunker per coerenza embedding)
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
        "the","a","an","and","or","but","in","on","at","to","for","of","with",
        "by","from","as","is","are","was","were","be","been","have","has","had",
    }

# ---------------------------------------------------------------------------
# UTILITY TESTO (stesse funzioni di rag_chunker)
# ---------------------------------------------------------------------------

def _count_words(text: str) -> int:
    return len(text.split())


def _tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text.lower())
    tokens = re.findall(r"[a-zàèéìîòùü][a-zàèéìîòùü\-']{2,}", text)
    return [t for t in tokens if t not in STOPWORDS and len(t) > 2]


def _estrai_keywords(heading: str, testo: str, top_n: int = 7) -> list[str]:
    keywords: list[str] = []
    if heading:
        for w in re.sub(r'[^a-zA-ZÀ-ÿ\s]', ' ', heading).split():
            w = w.lower().strip()
            if len(w) > 3 and w not in STOPWORDS and w not in keywords:
                keywords.append(w)
    tokens = _tokenize(testo)
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


def _build_breadcrumb(h1: str, h2: str, h3: str) -> str:
    def clean(h):
        if not h:
            return None
        return re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', h).strip() or None
    return ' > '.join(p for p in [clean(h1), clean(h2), clean(h3)] if p)


def _prepara_testo_embedding(testo: str, breadcrumb: str, documento_id: str) -> str:
    t = re.sub(r'^#{1,6}\s+', '', testo, flags=re.MULTILINE)
    t = re.sub(r'[ \t]{2,}', ' ', t)
    t = re.sub(r'\n{3,}', '\n\n', t).strip()
    title_val = breadcrumb.strip() if breadcrumb else 'none'
    doc_prefix = f'Documento: {documento_id} | ' if documento_id else ''
    return f'{doc_prefix}title: {title_val} | text: {t}'


def _classifica(testo: str, n_parole: int) -> tuple[str, bool]:
    """Classifica il chunk: (tipo, index_for_rag)"""
    testo_body = re.sub(r'^#{1,6}\s+.+$', '', testo, flags=re.MULTILINE).strip()
    if not testo_body or n_parole < MIN_WORDS:
        return 'noise', False
    _TOC_RE = re.compile(
        r'^(sommario|indice|table of contents|contents)\s*$', re.IGNORECASE
    )
    first_line = testo.splitlines()[0].strip() if testo.strip() else ''
    if _TOC_RE.match(re.sub(r'#+\s*', '', first_line)):
        return 'toc', False
    return 'content', True


# ---------------------------------------------------------------------------
# MISTRAL OCR API
# ---------------------------------------------------------------------------

def _mistral_ocr(pdf_path: Path, api_key: str, emit: Callable) -> list[dict]:
    """
    Chiama Mistral OCR e restituisce lista di pagine:
    [ { "page_num": int, "markdown": str }, ... ]
    """
    headers_auth = {"Authorization": f"Bearer {api_key}"}

    # ── Step 1: upload ────────────────────────────────────────
    emit("📤 Caricamento PDF su Mistral OCR...")
    with open(pdf_path, "rb") as f:
        resp = requests.post(
            MISTRAL_FILE_URL,
            headers=headers_auth,
            files={"file": (pdf_path.name, f, "application/pdf")},
            data={"purpose": "ocr"},
            timeout=120,
        )
    resp.raise_for_status()
    file_id = resp.json()["id"]
    emit(f"   ✅ File caricato (id={file_id})")

    try:
        # ── Step 2: signed URL ────────────────────────────────
        url_resp = requests.get(
            f"{MISTRAL_FILE_URL}/{file_id}/url?expiry=1",
            headers=headers_auth,
            timeout=30,
        )
        url_resp.raise_for_status()
        signed_url = url_resp.json()["url"]

        # ── Step 3: OCR ───────────────────────────────────────
        model = os.getenv("MISTRAL_OCR_MODEL", "mistral-ocr-latest")
        emit(f"🔍 OCR in corso con {model}...")
        ocr_resp = requests.post(
            MISTRAL_OCR_URL,
            headers={**headers_auth, "Content-Type": "application/json"},
            json={
                "model": model,
                "document": {"type": "document_url", "document_url": signed_url},
            },
            timeout=300,
        )
        ocr_resp.raise_for_status()
        pages_raw = ocr_resp.json().get("pages", [])

    finally:
        # ── Step 4: cleanup remoto ────────────────────────────
        try:
            requests.delete(
                f"{MISTRAL_FILE_URL}/{file_id}",
                headers=headers_auth,
                timeout=10,
            )
        except Exception:
            pass

    if not pages_raw:
        raise ValueError("Mistral OCR ha restituito 0 pagine.")

    # Normalizza la struttura delle pagine
    # Mistral restituisce { "index": 0, "markdown": "..." }
    pages = []
    for p in pages_raw:
        md = p.get("markdown", "").strip()
        # Rimuove immagini base64 (grandi e inutili per il RAG testuale)
        md = re.sub(r'!\[.*?\]\(data:image/[^)]+\)', '', md)
        md = md.strip()
        pages.append({
            "page_num": p.get("index", len(pages)) + 1,  # 1-based
            "markdown": md,
        })

    emit(f"   ✅ {len(pages)} pagine estratte")
    return pages


# ---------------------------------------------------------------------------
# CHUNKING IBRIDO (per pagina + per heading)
# ---------------------------------------------------------------------------

_HEADING_RE = re.compile(r'^(#{1,3})\s+(.+)', re.MULTILINE)


def _split_pagina_per_heading(testo: str) -> list[dict]:
    """
    Divide il testo di una pagina per heading H1/H2/H3.
    Restituisce lista di { h1, h2, h3, testo }.
    Se non ci sono heading → unico blocco con h1=h2=h3=None.
    """
    if not _HEADING_RE.search(testo):
        return [{"h1": None, "h2": None, "h3": None, "testo": testo.strip()}]

    sezioni: list[dict] = []
    corrente_h: dict = {"h1": None, "h2": None, "h3": None}
    buffer: list[str] = []

    for linea in testo.splitlines(keepends=True):
        m = re.match(r'^(#{1,3})\s+(.+)', linea.rstrip())
        if m:
            # Salva il blocco precedente
            if buffer:
                testo_blocco = "".join(buffer).strip()
                if testo_blocco:
                    sezioni.append({**corrente_h, "testo": testo_blocco})
            buffer = []
            livello = len(m.group(1))
            titolo  = m.group(2).strip()
            if livello == 1:
                corrente_h = {"h1": titolo, "h2": None, "h3": None}
            elif livello == 2:
                corrente_h = {**corrente_h, "h2": titolo, "h3": None}
            else:
                corrente_h = {**corrente_h, "h3": titolo}
            buffer.append(linea)
        else:
            buffer.append(linea)

    # Ultimo blocco
    if buffer:
        testo_blocco = "".join(buffer).strip()
        if testo_blocco:
            sezioni.append({**corrente_h, "testo": testo_blocco})

    return sezioni if sezioni else [{"h1": None, "h2": None, "h3": None, "testo": testo.strip()}]


def _split_per_paragrafi(testo: str, max_chars: int) -> list[str]:
    """
    Spezza un testo troppo lungo per paragrafi (doppio a capo),
    poi per singolo a capo, poi per frase.
    """
    if len(testo) <= max_chars:
        return [testo]

    # Prova doppio a capo
    parti = re.split(r'\n\n+', testo)
    risultato: list[str] = []
    buffer = ""
    for parte in parti:
        if len(buffer) + len(parte) + 2 <= max_chars:
            buffer = (buffer + "\n\n" + parte).strip() if buffer else parte
        else:
            if buffer:
                risultato.append(buffer)
            # Parte singola troppo lunga → spezza per frase
            if len(parte) > max_chars:
                frasi = re.split(r'(?<=[.!?])\s+', parte)
                buf_f = ""
                for frase in frasi:
                    if len(buf_f) + len(frase) + 1 <= max_chars:
                        buf_f = (buf_f + " " + frase).strip() if buf_f else frase
                    else:
                        if buf_f:
                            risultato.append(buf_f)
                        buf_f = frase
                if buf_f:
                    risultato.append(buf_f)
            else:
                buffer = parte
    if buffer:
        risultato.append(buffer)
    return [r for r in risultato if r.strip()]


def _costruisci_chunk_da_pagine(pagine: list[dict]) -> list[dict]:
    """
    Principale funzione di chunking ibrido.
    Input:  lista di { page_num, markdown }
    Output: lista di { h1, h2, h3, pagina, testo }
    """
    chunk_grezzi: list[dict] = []

    for pagina in pagine:
        page_num = pagina["page_num"]
        md       = pagina["markdown"]

        if not md.strip():
            continue

        sezioni = _split_pagina_per_heading(md)

        for sez in sezioni:
            testo = sez["testo"].strip()
            if not testo:
                continue

            # Spezza se troppo lungo
            if len(testo) > MAX_CHUNK_CHARS:
                parti = _split_per_paragrafi(testo, MAX_CHUNK_CHARS)
                for parte in parti:
                    if parte.strip():
                        chunk_grezzi.append({
                            "h1":     sez["h1"],
                            "h2":     sez["h2"],
                            "h3":     sez["h3"],
                            "pagina": page_num,
                            "testo":  parte.strip(),
                        })
            else:
                chunk_grezzi.append({
                    "h1":     sez["h1"],
                    "h2":     sez["h2"],
                    "h3":     sez["h3"],
                    "pagina": page_num,
                    "testo":  testo,
                })

    return chunk_grezzi


def _merge_piccoli(chunks: list[dict]) -> list[dict]:
    """
    Fonde chunk troppo piccoli (< MIN_WORDS) con il successivo
    se condividono lo stesso numero di pagina.
    Poi applica un merge incondizionato per chunk < 30 parole.
    """
    # Pass 1: merge per pagina
    merged: list[dict] = []
    i = 0
    while i < len(chunks):
        c = dict(chunks[i])
        while (
            _count_words(c["testo"]) < MIN_WORDS
            and i + 1 < len(chunks)
            and chunks[i + 1]["pagina"] == c["pagina"]
        ):
            nxt = chunks[i + 1]
            c["testo"] = c["testo"] + "\n\n" + nxt["testo"]
            c["h1"] = c["h1"] or nxt["h1"]
            c["h2"] = c["h2"] or nxt["h2"]
            c["h3"] = c["h3"] or nxt["h3"]
            i += 1
        merged.append(c)
        i += 1

    # Pass 2: merge incondizionato < 30 parole
    ABSOLUTE_MIN = 30
    risultato: list[dict] = []
    i = 0
    while i < len(merged):
        c = dict(merged[i])
        if _count_words(c["testo"]) < ABSOLUTE_MIN and i + 1 < len(merged):
            nxt = merged[i + 1]
            c["testo"] = c["testo"] + "\n\n" + nxt["testo"]
            c["h1"] = c["h1"] or nxt["h1"]
            c["h2"] = c["h2"] or nxt["h2"]
            c["h3"] = c["h3"] or nxt["h3"]
            i += 1
        risultato.append(c)
        i += 1

    return risultato


# ---------------------------------------------------------------------------
# ESTRAZIONE METADATI DOCUMENTO
# ---------------------------------------------------------------------------

def _estrai_doc_id(testo_completo: str, file_stem: str) -> str:
    """Estrae il codice documento dal testo o usa il nome file."""
    # Pattern tipo ETH-COD-001, OPS-MAN-002
    m = re.search(r'\b([A-Z]{2,}(?:\-[A-Z0-9]{2,})+)\b', testo_completo)
    if m:
        return m.group(1)
    # Primo H1
    m = re.match(r'^#\s+(.+)', testo_completo, re.MULTILINE)
    if m:
        return re.sub(r'\*+', '', m.group(1)).strip()[:80]
    return file_stem


def _estrai_versione(testo_completo: str) -> Optional[str]:
    m = re.search(
        r'(?:versione|version|ver\.?|rev\.?)\s*[:\-]?\s*(\d+[\.\d]*)',
        testo_completo, re.IGNORECASE
    )
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# PIPELINE PRINCIPALE
# ---------------------------------------------------------------------------

def processa_pdf_con_mistral(
    pdf_path: str,
    output_dir: str,
    emit: Callable[[str], None] = print,
) -> dict:
    """
    Pipeline completa: PDF → Mistral OCR → chunking → JSON.

    Args:
        pdf_path:   percorso al PDF da elaborare
        output_dir: cartella dove salvare il JSON dei chunk
        emit:       callback per i log (usato dal WebSocket)

    Returns:
        dict con schema { "documento": {...}, "frammenti": [...] }
        identico a quello prodotto da rag_chunker.py

    Raises:
        Exception se Mistral API fallisce o il PDF è vuoto
    """
    api_key = os.getenv("MISTRAL_API_KEY", "")
    if not api_key:
        raise ValueError(
            "MISTRAL_API_KEY non impostata. "
            "Aggiungila al file .env del backend."
        )

    pdf_path   = Path(pdf_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = pdf_path.stem

    emit(f"🚀 Pipeline Mistral OCR: {pdf_path.name}")
    t0 = time.time()

    # ── 1. OCR ────────────────────────────────────────────────
    pagine = _mistral_ocr(pdf_path, api_key, emit)
    n_pagine = len(pagine)

    # Testo completo per estrarre metadati
    testo_completo = "\n\n".join(p["markdown"] for p in pagine)

    # ── 2. Estrazione metadati documento ──────────────────────
    doc_id   = _estrai_doc_id(testo_completo, stem)
    versione = _estrai_versione(testo_completo)
    emit(f"   📋 documento_id: {doc_id} | versione: {versione}")

    # ── 3. Chunking ibrido ────────────────────────────────────
    emit("✂️  Chunking in corso...")
    chunk_grezzi = _costruisci_chunk_da_pagine(pagine)
    chunk_grezzi = _merge_piccoli(chunk_grezzi)
    emit(f"   📦 {len(chunk_grezzi)} chunk dopo merge")

    # ── 4. Costruzione frammenti con schema completo ──────────
    frammenti: list[dict] = []
    for idx, c in enumerate(chunk_grezzi):
        h1, h2, h3 = c["h1"], c["h2"], c["h3"]
        testo       = c["testo"]
        pagina      = c["pagina"]
        heading     = h3 or h2 or h1 or ''
        breadcrumb  = _build_breadcrumb(h1, h2, h3)
        n_parole    = _count_words(testo)
        n_car       = len(testo)

        tipo, index_for_rag = _classifica(testo, n_parole)
        anchor_link = f"{STATIC_PDF_PATH}{stem}.pdf#page={pagina}" if pagina else None
        keywords    = _estrai_keywords(heading, testo) if index_for_rag else []
        testo_emb   = _prepara_testo_embedding(testo, breadcrumb, doc_id)

        frammenti.append({
            "id":              str(uuid.uuid4()),
            "chunk_index":     idx,
            "tipo":            tipo,
            "index_for_rag":   index_for_rag,
            "breadcrumb":      breadcrumb,
            "h1":              h1,
            "h2":              h2,
            "h3":              h3,
            "pagina":          pagina,
            "anchor_link":     anchor_link,
            "keywords":        keywords,
            "testo":           testo,
            "testo_embedding": testo_emb,
            "n_parole":        n_parole,
            "n_caratteri":     n_car,
            "documento_id":    doc_id,
        })

    n_rag = sum(1 for f in frammenti if f["index_for_rag"])
    elapsed = time.time() - t0

    emit(f"   ✅ Totali: {len(frammenti)} | RAG: {n_rag} | scartati: {len(frammenti) - n_rag}")
    emit(f"   ⏱️  Tempo totale: {elapsed:.1f}s ({n_pagine} pagine)")

    # ── 5. Costruzione oggetto documento ──────────────────────
    risultato = {
        "documento": {
            "id":                 stem,
            "file_pdf":           pdf_path.name,
            "documento_id":       doc_id,
            "versione":           versione,
            "data_validita":      None,  # inserita dall'utente nel Loader
            "data_scadenza":      None,  # inserita dall'utente nel Loader
            "area_responsabile":  None,
            "livello_accesso":    None,
            "keywords_documento": [],
            "n_frammenti":        len(frammenti),
            "n_frammenti_rag":    n_rag,
        },
        "frammenti": frammenti,
    }

    # ── 6. Salva JSON (compatibile con loader_service) ────────
    json_path = output_dir / f"{stem}_chunks.json"
    json_path.write_text(
        json.dumps(risultato, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    emit(f"💾 JSON salvato: {json_path.name} ({json_path.stat().st_size // 1024} KB)")
    emit("🎉 Pipeline completata! Usa il loader per indicizzare in ChromaDB.")

    return risultato
