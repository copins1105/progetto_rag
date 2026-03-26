# app/services/admin_search_service.py
"""
AdminSearchService
==================
Servizio ChromaDB dedicato al pannello amministrativo.
Separato da Search_Service_langchain2.py che gestisce solo il retrieval del chatbot.

Responsabilità:
  - Verificare se un documento è indicizzato in ChromaDB
  - Recuperare i chunk di un documento (paginati)
  - Eliminare i chunk di un documento
  - Mantenere una mappa stem_file → titolo_documento

Non usa BM25, ensemble retriever o embedding — solo operazioni CRUD su ChromaDB.
"""

import os
import logging
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

        # Mappa stem_file → titolo_documento costruita all'avvio
        # Es: "BANDO-BIENNIO-2025-2027-finale" → "BANDO DI SELEZIONE CORSI ITS"
        self._stem_to_title: dict[str, str] = {}
        self._title_to_stems: dict[str, list[str]] = {}
        self._build_stem_map()

    # ─────────────────────────────────────────────
    # COSTRUZIONE MAPPA STEM → TITOLO
    # ─────────────────────────────────────────────

    def _build_stem_map(self) -> None:
        """
        Legge i metadata da ChromaDB e costruisce la mappa
        stem_file → titolo_documento.

        Usa anchor_link che contiene "/static/{stem}.pdf#page=N"
        per estrarre lo stem e associarlo al titolo_documento.
        """
        if not self.collection:
            return
        try:
            results = self.collection.get(include=["metadatas"])
            metas   = results.get("metadatas", [])

            for meta in metas:
                anchor = meta.get("anchor_link", "")
                titolo = meta.get("titolo_documento", "")
                if not titolo:
                    continue

                # Estrai stem da anchor_link: "/static/BANDO-BIENNIO.pdf#page=1" → "BANDO-BIENNIO"
                if anchor:
                    filename = anchor.split("/")[-1].split("#")[0]  # "BANDO-BIENNIO.pdf"
                    stem     = Path(filename).stem                   # "BANDO-BIENNIO"
                    if stem and stem not in self._stem_to_title:
                        self._stem_to_title[stem] = titolo
                        self._title_to_stems.setdefault(titolo, []).append(stem)

            logger.info(f"AdminSearchService: mappa stem costruita ({len(self._stem_to_title)} documenti)")
            for stem, titolo in self._stem_to_title.items():
                logger.debug(f"  {stem} → {titolo}")

        except Exception as e:
            logger.warning(f"AdminSearchService: errore build stem map: {e}")

    def reload(self) -> None:
        """Ricarica la mappa stem → titolo (chiamare dopo nuove indicizzazioni)."""
        self._stem_to_title  = {}
        self._title_to_stems = {}
        self._build_stem_map()
        logger.info("AdminSearchService: mappa ricaricata")

    # ─────────────────────────────────────────────
    # HELPER: stem → titolo_documento
    # ─────────────────────────────────────────────

    def _resolve_title(self, stem: str) -> Optional[str]:
        """
        Restituisce il titolo_documento corrispondente allo stem del file.
        Prima cerca nella mappa esatta, poi prova match parziale case-insensitive.
        """
        # Match esatto
        if stem in self._stem_to_title:
            return self._stem_to_title[stem]

        # Match parziale: lo stem contiene parte del titolo o viceversa
        stem_lower = stem.lower().replace("-", " ").replace("_", " ")
        for s, titolo in self._stem_to_title.items():
            s_lower = s.lower().replace("-", " ").replace("_", " ")
            if stem_lower in s_lower or s_lower in stem_lower:
                return titolo

        return None

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

    def get_chunks(
        self,
        stem: str,
        page: int      = 0,
        page_size: int = 15,
    ) -> dict:
        """
        Recupera i chunk di un documento da ChromaDB, paginati.

        Returns:
            { "total": int, "page": int, "page_size": int, "chunks": [...] }
        """
        if not self.collection:
            return {"total": 0, "page": page, "page_size": page_size, "chunks": []}

        titolo = self._resolve_title(stem)

        if not titolo:
            # Titolo non in mappa → documento non indicizzato
            return {"total": 0, "page": page, "page_size": page_size, "chunks": []}

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

            return {
                "total":     total,
                "page":      page,
                "page_size": page_size,
                "chunks":    chunks,
            }

        except Exception as e:
            logger.error(f"AdminSearchService.get_chunks error: {e}")
            return {"total": 0, "page": page, "page_size": page_size, "chunks": []}

    # ─────────────────────────────────────────────
    # DELETE DOCUMENT
    # ─────────────────────────────────────────────

    def delete_document(self, stem: str) -> int:
        """
        Rimuove tutti i chunk di un documento da ChromaDB.

        Returns:
            Numero di chunk eliminati (0 se non trovati o errore)
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
                # Rimuovi dalla mappa locale
                if stem in self._stem_to_title:
                    del self._stem_to_title[stem]
                logger.info(f"AdminSearchService: eliminati {len(ids)} chunk per '{titolo}'")
            return len(ids)
        except Exception as e:
            logger.error(f"AdminSearchService.delete_document error: {e}")
            return 0

    # ─────────────────────────────────────────────
    # AVAILABLE TITLES (per debug/info)
    # ─────────────────────────────────────────────

    @property
    def indexed_stems(self) -> list[str]:
        """Lista degli stem dei file attualmente indicizzati."""
        return list(self._stem_to_title.keys())
