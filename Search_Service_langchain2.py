# import os
# import chromadb
# from dotenv import load_dotenv
# from langchain_chroma import Chroma
# from langchain_community.retrievers import BM25Retriever
# from langchain_classic.retrievers import EnsembleRetriever
# from langchain_core.documents import Document
# from typing import List

# from app.services.AI_Services import AIService

# load_dotenv()


# class SearchService:
#     def __init__(self, ai_service: AIService):
#         self.ai = ai_service

#         self.chroma_client = chromadb.HttpClient(
#             host=os.getenv("CHROMA_HOST", "localhost"),
#             port=int(os.getenv("CHROMA_PORT", 8000))
#         )

#         coll_name = os.getenv("CHROMA_COLLECTION_NAME", "default_collection")

#         # Vectorstore LangChain con il tuo embedder
#         self.vectorstore = Chroma(
#             client=self.chroma_client,
#             collection_name=coll_name,
#             embedding_function=self.ai,
#         )

#         # Carica tutti i documenti in memoria per BM25
#         print("Caricamento documenti per BM25 in memoria...")
#         self._docs = self._load_all_docs()
#         print(f"BM25 pronto con {len(self._docs)} documenti.")
#         print(f"Connesso con successo alla collezione ChromaDB: {coll_name}")

#     def _load_all_docs(self) -> List[Document]:
#         collection = self.vectorstore._collection
#         results = collection.get(include=["documents", "metadatas"])

#         docs = []
#         for i, text in enumerate(results["documents"]):
#             meta = results["metadatas"][i]
#             docs.append(Document(
#                 page_content=text,
#                 metadata={
#                     "titolo_documento": meta.get("titolo_documento", ""),
#                     "documento_id":     meta.get("documento_id", ""),
#                     "id_riservatezza":  meta.get("id_riservatezza", ""),
#                     "pagina":           meta.get("pagina", ""),
#                     "anchor_link":      meta.get("anchor_link", ""),
#                     "breadcrumb":       meta.get("breadcrumb", ""),
#                     "h1":               meta.get("h1", ""),
#                     "h2":               meta.get("h2", ""),
#                     "h3":               meta.get("h3", ""),
#                     "keywords":         meta.get("keywords", ""),
#                     "chunk_index":      meta.get("chunk_index", ""),
#                 }
#             ))
#         return docs

#     def as_langchain_retriever(self, k: int = 15, fetch_k: int = None):
#         """
#         Restituisce un EnsembleRetriever ibrido (BM25 + vettoriale) via LangChain.

#         - k       : numero di risultati finali dopo fusione RRF
#         - fetch_k : quanti risultati per ciascun metodo prima della fusione (default k*2)
#         - weights : 0.3 BM25 / 0.7 vettoriale — privilegia la similarità semantica
#         - c=60    : costante RRF standard
#         """
#         if fetch_k is None:
#             fetch_k = k * 2

#         vector_retriever = self.vectorstore.as_retriever(
#             search_kwargs={"k": fetch_k}
#         )

#         bm25_retriever = BM25Retriever.from_documents(self._docs, k=fetch_k)

#         ensemble = EnsembleRetriever(
#             retrievers=[bm25_retriever, vector_retriever],
#             weights=[0.3, 0.7],
#             c=60
#         )

#         return ensemble




"""
Search_Service_langchain2.py — versione migliorata

MIGLIORAMENTI:
  1. BM25Retriever cached per la collezione completa — evita rebuild O(n) ad ogni richiesta
  2. _load_all_docs: batch fetch più robusto con gestione errori per singolo documento
  3. available_titles: property cached (non ricalcolata ad ogni accesso)
  4. as_langchain_retriever: parametro weights esposto per tuning esterno
  5. Logging strutturato con livelli invece di print
  6. Type hints completi
"""

import os
import re
import logging
import chromadb
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from langchain_classic.retrievers import EnsembleRetriever
from langchain_core.documents import Document
from typing import List, Optional, Tuple

from app.services.AI_Services import AIService
from stop_words import get_stop_words

load_dotenv()

logger = logging.getLogger(__name__)

# Stopwords italiane — set per lookup O(1)
_IT_STOPWORDS: frozenset = frozenset(get_stop_words('it'))


def _italian_preprocess(text: str) -> List[str]:
    text   = text.lower()
    text   = re.sub(r'[^\w\s]', ' ', text)
    tokens = text.split()
    return [t for t in tokens if t not in _IT_STOPWORDS and len(t) > 2]


class SearchService:
    def __init__(
        self,
        ai_service: AIService,
        # MIGLIORAMENTO: parametri configurabili dall'esterno
        default_k: int      = 15,
        default_fetch_k: int = 30,
        bm25_weight: float   = 0.3,
        vector_weight: float = 0.7,
        rrf_c: int           = 60,
    ):
        self.ai             = ai_service
        self._default_k     = default_k
        self._default_fetch = default_fetch_k
        self._bm25_w        = bm25_weight
        self._vector_w      = vector_weight
        self._rrf_c         = rrf_c

        self.chroma_client = chromadb.HttpClient(
            host=os.getenv("CHROMA_HOST", "localhost"),
            port=int(os.getenv("CHROMA_PORT", 8000))
        )

        coll_name = os.getenv("CHROMA_COLLECTION_NAME", "default_collection")

        self.vectorstore = Chroma(
            client=self.chroma_client,
            collection_name=coll_name,
            embedding_function=self.ai,
        )

        logger.info("Caricamento documenti per BM25 in memoria...")
        self._docs = self._load_all_docs()
        logger.info(f"BM25 pronto con {len(self._docs)} documenti.")
        logger.info(f"Connesso alla collezione ChromaDB: {coll_name}")

        # Catalogo titoli — calcolato una sola volta
        self._available_titles: List[str] = sorted(set(
            d.metadata.get("titolo_documento", "")
            for d in self._docs
            if d.metadata.get("titolo_documento", "")
        ))
        logger.info(f"Titoli disponibili ({len(self._available_titles)}): {self._available_titles}")

        # MIGLIORAMENTO: cache del retriever senza filtro
        # Viene costruito una volta sola e riutilizzato per tutte le query generiche.
        # Il costo di BM25Retriever.from_documents() su grandi collezioni è O(n*avg_len),
        # quindi evitarlo ad ogni chiamata migliora la latenza in modo significativo.
        self._cached_bm25_full: Optional[BM25Retriever] = None
        self._cached_vector_full = self.vectorstore.as_retriever(
            search_kwargs={"k": self._default_fetch}
        )
        self._build_full_bm25_cache()

    def _build_full_bm25_cache(self) -> None:
        """Costruisce e cache il BM25Retriever sull'intera collezione."""
        try:
            self._cached_bm25_full = BM25Retriever.from_documents(
                self._docs,
                k=self._default_fetch,
                preprocess_func=_italian_preprocess,
            )
            logger.info("Cache BM25 completo costruita con successo.")
        except Exception as e:
            logger.warning(f"Impossibile costruire cache BM25: {e}")
            self._cached_bm25_full = None

    def _load_all_docs(self) -> List[Document]:
        """
        MIGLIORAMENTO: gestione errori per singolo documento — un metadata
        malformato non fa saltare l'intero caricamento.
        """
        try:
            collection = self.vectorstore._collection
            results    = collection.get(include=["documents", "metadatas"])
        except Exception as e:
            logger.error(f"Errore nel recupero documenti da ChromaDB: {e}")
            return []

        docs = []
        for i, text in enumerate(results.get("documents", [])):
            try:
                meta = results["metadatas"][i] if results.get("metadatas") else {}

                keywords_str = meta.get("keywords", "")
                bm25_text    = f"{text}\n{keywords_str}" if keywords_str else text

                docs.append(Document(
                    page_content=bm25_text,
                    metadata={
                        "titolo_documento": meta.get("titolo_documento", ""),
                        "documento_id":     meta.get("documento_id", ""),
                        "id_riservatezza":  meta.get("id_riservatezza", ""),
                        "pagina":           meta.get("pagina", ""),
                        "anchor_link":      meta.get("anchor_link", ""),
                        "breadcrumb":       meta.get("breadcrumb", ""),
                        "h1":               meta.get("h1", ""),
                        "h2":               meta.get("h2", ""),
                        "h3":               meta.get("h3", ""),
                        "keywords":         keywords_str,
                        "chunk_index":      meta.get("chunk_index", ""),
                    }
                ))
            except Exception as e:
                logger.warning(f"Documento {i} ignorato per errore metadata: {e}")
                continue

        return docs

    def reload(self) -> None:
        """
        MIGLIORAMENTO: metodo pubblico per ricaricare i documenti a caldo
        (utile dopo nuove ingestion senza riavviare il server).
        """
        logger.info("Ricaricamento documenti SearchService...")
        self._docs = self._load_all_docs()
        self._available_titles = sorted(set(
            d.metadata.get("titolo_documento", "")
            for d in self._docs
            if d.metadata.get("titolo_documento", "")
        ))
        self._build_full_bm25_cache()
        logger.info(f"Ricaricamento completato: {len(self._docs)} documenti.")

    @property
    def available_titles(self) -> List[str]:
        """Lista dei titoli documento presenti nella collezione."""
        return self._available_titles

    def as_langchain_retriever(
        self,
        k: int                       = None,
        fetch_k: int                 = None,
        filter_titles: Optional[List[str]] = None,
        bm25_weight: float           = None,
        vector_weight: float         = None,
    ) -> EnsembleRetriever:
        """
        Restituisce un EnsembleRetriever ibrido (BM25 + vettoriale).

        MIGLIORAMENTO: se filter_titles è None/vuoto, riutilizza i retriever
        cached invece di ricostruirli da zero ad ogni chiamata.

        Args:
            k             : risultati finali dopo fusione RRF
            fetch_k       : risultati per metodo prima della fusione
            filter_titles : lista titoli_documento su cui restringere la ricerca
            bm25_weight   : peso BM25 nell'ensemble (default da __init__)
            vector_weight : peso vettoriale nell'ensemble (default da __init__)
        """
        k             = k       or self._default_k
        fetch_k       = fetch_k or self._default_fetch
        bm25_w        = bm25_weight   if bm25_weight   is not None else self._bm25_w
        vector_w      = vector_weight if vector_weight is not None else self._vector_w

        # ── Caso senza filtro: usa cache ──────────────────────
        if not filter_titles:
            if self._cached_bm25_full is not None:
                bm25_retriever   = self._cached_bm25_full
                vector_retriever = self._cached_vector_full
            else:
                # fallback se la cache non è disponibile
                bm25_retriever = BM25Retriever.from_documents(
                    self._docs, k=fetch_k, preprocess_func=_italian_preprocess,
                )
                vector_retriever = self.vectorstore.as_retriever(
                    search_kwargs={"k": fetch_k}
                )

            return EnsembleRetriever(
                retrievers=[bm25_retriever, vector_retriever],
                weights=[bm25_w, vector_w],
                c=self._rrf_c,
            )

        # ── Caso con filtro: costruisce retriever filtrati ────
        chroma_filter = {"titolo_documento": {"$in": filter_titles}}

        filtered_docs = [
            d for d in self._docs
            if d.metadata.get("titolo_documento", "") in filter_titles
        ]

        if not filtered_docs:
            logger.warning(
                f"Nessun documento trovato per filter_titles={filter_titles}. "
                "Ricerca su tutta la collezione."
            )
            return self.as_langchain_retriever(k=k, fetch_k=fetch_k)

        vector_retriever = self.vectorstore.as_retriever(
            search_kwargs={"k": fetch_k, "filter": chroma_filter}
        )

        bm25_retriever = BM25Retriever.from_documents(
            filtered_docs,
            k=fetch_k,
            preprocess_func=_italian_preprocess,
        )

        return EnsembleRetriever(
            retrievers=[bm25_retriever, vector_retriever],
            weights=[bm25_w, vector_w],
            c=self._rrf_c,
        )
