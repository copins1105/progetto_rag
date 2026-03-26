# app/services/sync_service.py
"""
SyncService — Idea 4
====================
Confronta PostgreSQL e ChromaDB per ogni documento e restituisce
lo stato di sincronizzazione.

Stati possibili per documento:
  - synced        → presente in entrambi i DB, chunk coerenti
  - solo_postgres → presente in PostgreSQL ma non in ChromaDB
  - solo_chroma   → presente in ChromaDB ma non in PostgreSQL
  - mismatch      → presente in entrambi ma sync_status='error' o 'pending'
  - pending       → caricamento in corso
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class SyncService:
    def __init__(self, chroma_collection):
        self.collection = chroma_collection

    # ─────────────────────────────────────────────
    # STATO SINGOLO DOCUMENTO
    # ─────────────────────────────────────────────

    def stato_documento(self, db: Session, titolo: str) -> dict:
        """
        Controlla lo stato di sincronizzazione di un documento.

        Returns:
            {
                "titolo": str,
                "stato": "synced"|"solo_postgres"|"solo_chroma"|"mismatch"|"pending",
                "documento_id": int|None,
                "n_chunk_chroma": int,
                "sync_status_db": str|None,
                "dettaglio": str,
            }
        """
        from app.models.rag_models import Documento

        # Cerca in PostgreSQL
        doc_pg = db.query(Documento).filter_by(titolo=titolo).first()

        # Cerca in ChromaDB
        n_chunk_chroma = 0
        try:
            results = self.collection.get(
                where={"titolo_documento": {"$eq": titolo}},
                include=[],
            )
            n_chunk_chroma = len(results.get("ids", []))
        except Exception as e:
            logger.warning(f"SyncService: errore ChromaDB per '{titolo}': {e}")

        in_postgres = doc_pg is not None
        in_chroma   = n_chunk_chroma > 0

        # Determina stato
        if in_postgres and in_chroma:
            if doc_pg.sync_status in ("error", "pending"):
                stato    = doc_pg.sync_status
                dettaglio = f"sync_status={doc_pg.sync_status} — possibile caricamento incompleto"
            else:
                stato    = "synced"
                dettaglio = f"{n_chunk_chroma} chunk in ChromaDB"
        elif in_postgres and not in_chroma:
            stato    = "solo_postgres"
            dettaglio = "Documento in PostgreSQL ma nessun chunk in ChromaDB"
        elif not in_postgres and in_chroma:
            stato    = "solo_chroma"
            dettaglio = f"{n_chunk_chroma} chunk in ChromaDB ma nessun record in PostgreSQL"
        else:
            stato    = "not_found"
            dettaglio = "Documento non trovato in nessun DB"

        return {
            "titolo"          : titolo,
            "stato"           : stato,
            "documento_id"    : doc_pg.documento_id if doc_pg else None,
            "n_chunk_chroma"  : n_chunk_chroma,
            "sync_status_db"  : doc_pg.sync_status if doc_pg else None,
            "dettaglio"       : dettaglio,
        }

    # ─────────────────────────────────────────────
    # STATO DI TUTTI I DOCUMENTI
    # ─────────────────────────────────────────────

    def stato_tutti(self, db: Session) -> list[dict]:
        """
        Restituisce lo stato di sincronizzazione di tutti i documenti
        trovati in PostgreSQL o ChromaDB.
        """
        from app.models.rag_models import Documento

        # Tutti i titoli da PostgreSQL
        titoli_pg = {doc.titolo for doc in db.query(Documento).all()}

        # Tutti i titoli da ChromaDB
        titoli_chroma = set()
        try:
            results = self.collection.get(include=["metadatas"])
            for meta in results.get("metadatas", []):
                t = meta.get("titolo_documento", "")
                if t:
                    titoli_chroma.add(t)
        except Exception as e:
            logger.warning(f"SyncService: errore lettura ChromaDB: {e}")

        # Unione dei titoli
        tutti_titoli = titoli_pg | titoli_chroma

        return [self.stato_documento(db, titolo) for titolo in sorted(tutti_titoli)]

    # ─────────────────────────────────────────────
    # RIPRISTINO (solo_postgres o solo_chroma)
    # ─────────────────────────────────────────────

    def ripristina_solo_postgres(
        self,
        db: Session,
        titolo: str,
        ai_service,
        json_dir: str,
        emit=print,
    ) -> bool:
        """
        Se un documento è solo in PostgreSQL, cerca il JSON in output_json
        e ricarica i chunk in ChromaDB.
        """
        from pathlib import Path
        from app.models.rag_models import Documento

        doc = db.query(Documento).filter_by(titolo=titolo).first()
        if not doc:
            emit(f"❌ Documento '{titolo}' non trovato in PostgreSQL")
            return False

        # Cerca il JSON corrispondente
        json_dir_path = Path(json_dir)
        candidates = list(json_dir_path.glob(f"{titolo}*_chunks.json"))
        if not candidates:
            emit(f"❌ Nessun JSON trovato per '{titolo}' in {json_dir}")
            return False

        json_path = candidates[0]
        emit(f"📂 JSON trovato: {json_path.name}")

        from app.services.loader_service import carica_documento
        try:
            carica_documento(
                json_path   = str(json_path),
                id_tipo     = doc.id_tipo,
                id_livello  = doc.id_livello,
                data_validita = str(doc.data_validita_inizio),
                data_scadenza = str(doc.data_scadenza) if doc.data_scadenza else None,
                ai_service  = ai_service,
                chroma_collection = self.collection,
                emit        = emit,
                forza_sovrascrivi = True,
            )
            return True
        except Exception as e:
            emit(f"❌ Ripristino fallito: {e}")
            return False
