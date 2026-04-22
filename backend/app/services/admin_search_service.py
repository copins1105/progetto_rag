# app/services/admin_search_service.py
"""
AdminSearchService
==================
Servizio ChromaDB dedicato al pannello amministrativo.

FIX rispetto alla versione precedente:
- _build_stem_map() ora gestisce documenti senza anchor_link (campo vuoto o None)
  usando il campo titolo_documento direttamente come fallback per lo stem
- indexed_stems ora include SEMPRE tutti i documenti indicizzati, anche quelli
  privi di anchor_link (es. documenti caricati senza mappa pagine)
- delete_document() pulisce anche dalla mappa _title_to_stems
- reload() è thread-safe (crea nuove mappe e le assegna atomicamente)
"""

import os
import logging
import re
from pathlib import Path
from typing import Optional

import chromadb

logger = logging.getLogger(__name__)


class AdminSearchService:
    def __init__(self):
        self.client = chromadb.HttpClient(
            host=os.getenv("CHROMA_HOST", "localhost"),
            port=int(os.getenv("CHROMA_PORT", 8000))
        )
        self.collection_name = os.getenv("CHROMA_COLLECTION_NAME", "documenti_semantici")

        try:
            self.collection = self.client.get_collection(self.collection_name)
            logger.info(f"AdminSearchService connesso a ChromaDB: {self.collection_name}")
        except Exception as e:
            logger.error(f"AdminSearchService: impossibile connettersi a ChromaDB: {e}")
            self.collection = None

        self._stem_to_title: dict[str, str] = {}
        self._title_to_stems: dict[str, list[str]] = {}
        # Set di tutti i titoli indicizzati (anche senza anchor_link)
        self._all_indexed_titles: set[str] = set()
        self._build_stem_map()

    # ─────────────────────────────────────────────
    # BUILD MAPPA STEM → TITOLO
    # ─────────────────────────────────────────────

    def _build_stem_map(self) -> None:
        """
        Legge i metadata da ChromaDB e costruisce:
          - _stem_to_title:       stem_file → titolo_documento
          - _title_to_stems:      titolo_documento → [stem_file, ...]
          - _all_indexed_titles:  set di tutti i titoli presenti in ChromaDB

        FIX: i documenti senza anchor_link (campo vuoto o None) vengono
        comunque registrati in _all_indexed_titles. Per questi documenti
        usiamo il titolo_documento stesso come stem (normalizzato).
        """
        if not self.collection:
            return

        new_stem_to_title:   dict[str, str]        = {}
        new_title_to_stems:  dict[str, list[str]]  = {}
        new_all_titles:      set[str]               = set()

        try:
            results = self.collection.get(include=["metadatas"])
            metas   = results.get("metadatas", [])

            for meta in metas:
                titolo = meta.get("titolo_documento", "")
                if not titolo:
                    continue

                new_all_titles.add(titolo)

                anchor = meta.get("anchor_link", "") or ""

                if anchor:
                    # Estrai stem da anchor_link: "/static/DOC.pdf#page=1" → "DOC"
                    filename = anchor.split("/")[-1].split("#")[0]  # "DOC.pdf"
                    stem     = Path(filename).stem                   # "DOC"
                    if stem:
                        if stem not in new_stem_to_title:
                            new_stem_to_title[stem] = titolo
                        new_title_to_stems.setdefault(titolo, [])
                        if stem not in new_title_to_stems[titolo]:
                            new_title_to_stems[titolo].append(stem)
                else:
                    # FIX: nessun anchor_link → usa il titolo normalizzato come stem fallback.
                    # Questo permette a indexed_stems di includere questi documenti.
                    normalized_stem = self._normalize_title_to_stem(titolo)
                    if normalized_stem and normalized_stem not in new_stem_to_title:
                        new_stem_to_title[normalized_stem] = titolo
                    new_title_to_stems.setdefault(titolo, [])
                    if normalized_stem and normalized_stem not in new_title_to_stems[titolo]:
                        new_title_to_stems[titolo].append(normalized_stem)

            # Assegnazione atomica (thread-safe rispetto a letture concorrenti)
            self._stem_to_title      = new_stem_to_title
            self._title_to_stems     = new_title_to_stems
            self._all_indexed_titles = new_all_titles

            logger.info(
                f"AdminSearchService: mappa stem costruita — "
                f"{len(new_stem_to_title)} stem, {len(new_all_titles)} titoli"
            )

        except Exception as e:
            logger.warning(f"AdminSearchService: errore build stem map: {e}")

    @staticmethod
    def _normalize_title_to_stem(titolo: str) -> str:
        """
        Converte un titolo in uno stem usabile per ricerche.
        Es: "BANDO DI SELEZIONE ITS 2025" → "BANDO-DI-SELEZIONE-ITS-2025"
        """
        # Prende solo i primi 60 caratteri, sostituisce spazi con trattini
        stem = re.sub(r'[^\w\s-]', '', titolo)[:60].strip()
        stem = re.sub(r'\s+', '-', stem)
        return stem

    def reload(self) -> None:
        """Ricarica la mappa stem → titolo (chiamare dopo nuove indicizzazioni)."""
        self._build_stem_map()
        logger.info("AdminSearchService: mappa ricaricata")

    # ─────────────────────────────────────────────
    # HELPER: stem → titolo
    # ─────────────────────────────────────────────

    def _resolve_title(self, stem: str) -> Optional[str]:
        """
        Restituisce il titolo_documento corrispondente allo stem.
        Strategia a cascata:
          1. Match esatto sulla mappa
          2. Match parziale case-insensitive
          3. Match per parole chiave (stem contiene parole del titolo)
        """
        if not stem:
            return None

        # 1. Match esatto
        if stem in self._stem_to_title:
            return self._stem_to_title[stem]

        # 2. Match parziale case-insensitive
        stem_lower = stem.lower().replace("-", " ").replace("_", " ")
        for s, titolo in self._stem_to_title.items():
            s_lower = s.lower().replace("-", " ").replace("_", " ")
            if stem_lower == s_lower or stem_lower in s_lower or s_lower in stem_lower:
                return titolo

        # 3. Match titolo contenente le parole dello stem
        stem_words = set(stem_lower.split())
        for titolo in self._all_indexed_titles:
            titolo_lower = titolo.lower()
            titolo_words = set(titolo_lower.split())
            # Almeno il 70% delle parole dello stem sono nel titolo
            if stem_words and len(stem_words & titolo_words) / len(stem_words) >= 0.7:
                return titolo

        return None

    # ─────────────────────────────────────────────
    # PROPERTY: indexed_stems
    # ─────────────────────────────────────────────

    @property
    def indexed_stems(self) -> list[str]:
        """
        Lista degli stem dei file attualmente indicizzati.

        FIX: restituisce gli stem dalla mappa, che ora include anche
        i documenti senza anchor_link (tramite stem normalizzato dal titolo).
        """
        return list(self._stem_to_title.keys())

    @property
    def indexed_titles(self) -> set[str]:
        """Set di tutti i titoli indicizzati in ChromaDB."""
        return set(self._all_indexed_titles)

    # ─────────────────────────────────────────────
    # IS INDEXED
    # ─────────────────────────────────────────────

    def is_indexed(self, stem: str) -> bool:
        """
        Controlla se un documento è indicizzato in ChromaDB.
        Usa $eq su titolo_documento (supportato da ChromaDB HTTP).
        """
        if not self.collection:
            return False

        titolo = self._resolve_title(stem)
        if not titolo:
            return False

        try:
            results = self.collection.get(
                where={"titolo_documento": {"$eq": titolo}},
                include=[],
                limit=1,
            )
            return bool(results and results.get("ids"))
        except Exception as e:
            logger.warning(f"AdminSearchService.is_indexed error: {e}")
            return False

    # ─────────────────────────────────────────────
    # GET CHUNKS
    # ─────────────────────────────────────────────

    def get_chunks(self, stem: str, page: int = 0, page_size: int = 15) -> dict:
        """
        Recupera i chunk di un documento da ChromaDB, paginati.
        """
        empty = {"total": 0, "page": page, "page_size": page_size, "chunks": []}

        if not self.collection:
            return empty

        titolo = self._resolve_title(stem)
        if not titolo:
            return empty

        try:
            results = self.collection.get(
                where={"titolo_documento": {"$eq": titolo}},
                include=["documents", "metadatas"],
            )

            docs  = results.get("documents", [])
            metas = results.get("metadatas", [])
            ids   = results.get("ids", [])
            total = len(docs)
            start = page * page_size
            end   = min(start + page_size, total)

            chunks = [
                {
                    "id":       ids[i],
                    "text":     docs[i],
                    "metadata": metas[i],
                    "preview":  docs[i][:200] + ("…" if len(docs[i]) > 200 else ""),
                }
                for i in range(start, end)
            ]

            return {"total": total, "page": page, "page_size": page_size, "chunks": chunks}

        except Exception as e:
            logger.error(f"AdminSearchService.get_chunks error: {e}")
            return empty

    # ─────────────────────────────────────────────
    # DELETE DOCUMENT
    # ─────────────────────────────────────────────

    def delete_document(self, stem: str) -> int:
        """
        Rimuove tutti i chunk di un documento da ChromaDB
        e aggiorna le mappe interne.

        FIX: rimuove anche da _title_to_stems e _all_indexed_titles.
        """
        if not self.collection:
            return 0

        titolo = self._resolve_title(stem)
        if not titolo:
            return 0

        try:
            results = self.collection.get(
                where={"titolo_documento": {"$eq": titolo}},
                include=[],
            )
            ids = results.get("ids", [])
            if ids:
                self.collection.delete(ids=ids)

            # Aggiorna mappe interne
            if stem in self._stem_to_title:
                del self._stem_to_title[stem]
            if titolo in self._title_to_stems:
                stems = self._title_to_stems[titolo]
                if stem in stems:
                    stems.remove(stem)
                if not stems:
                    del self._title_to_stems[titolo]
                    self._all_indexed_titles.discard(titolo)

            logger.info(f"AdminSearchService: eliminati {len(ids)} chunk per '{titolo}'")
            return len(ids)

        except Exception as e:
            logger.error(f"AdminSearchService.delete_document error: {e}")
            return 0