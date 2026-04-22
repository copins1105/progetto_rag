# app/services/loader_service.py
"""
LoaderService — versione corretta con id_utente_caricamento

FIX rispetto alla versione precedente:
- carica_documento() accetta il parametro id_utente_caricamento (owner Admin)
- il parametro viene salvato sul record Documento in PostgreSQL
- senza questo fix i documenti caricati da un Admin hanno NULL come owner
  e diventano invisibili al filtro ownership del pannello admin
"""

import json
import logging
import datetime
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# UTILITY DATE
# ─────────────────────────────────────────────

_MESI_IT = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4,
    "maggio": 5, "giugno": 6, "luglio": 7, "agosto": 8,
    "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}


def safe_parse_date(date_str) -> Optional[datetime.date]:
    if not date_str or str(date_str).strip().lower() in ("null", "none", ""):
        return None
    s = str(date_str).strip()
    try:
        return datetime.datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        pass
    import re
    m = re.match(r'^(\d{1,2})[/\.\-](\d{1,2})[/\.\-](\d{4})$', s)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass
    parti = s.lower().split()
    if len(parti) == 3 and parti[1] in _MESI_IT:
        try:
            return datetime.date(int(parti[2]), _MESI_IT[parti[1]], int(parti[0]))
        except ValueError:
            pass
    return None


# ─────────────────────────────────────────────
# SYNC LOG
# ─────────────────────────────────────────────

def _log_sync(db: Session, documento_id: int, evento: str, dettaglio: str, esito: str = "ok") -> None:
    try:
        from app.models.rag_models import SyncLog
        db.add(SyncLog(documento_id=documento_id, evento=evento, dettaglio=dettaglio, esito=esito))
        db.commit()
    except Exception as e:
        logger.warning(f"Impossibile scrivere Sync_Log: {e}")


# ─────────────────────────────────────────────
# CONTROLLO DUPLICATI
# ─────────────────────────────────────────────

class DuplicatoError(Exception):
    def __init__(self, dove: str, documento_id: Optional[int] = None):
        self.dove = dove
        self.documento_id = documento_id
        super().__init__(f"Documento già presente in: {dove}")


def controlla_duplicati(db: Session, chroma_collection, titolo: str, versione: str) -> None:
    from app.models.rag_models import Documento

    in_postgres = db.query(Documento).filter_by(titolo=titolo, versione=versione).first()

    in_chroma = False
    try:
        res = chroma_collection.get(
            where={"titolo_documento": {"$eq": titolo}}, include=[], limit=1,
        )
        in_chroma = bool(res and res.get("ids"))
    except Exception:
        pass

    if in_postgres and in_chroma:
        raise DuplicatoError("entrambi", documento_id=in_postgres.documento_id)
    elif in_postgres:
        raise DuplicatoError("postgres", documento_id=in_postgres.documento_id)
    elif in_chroma:
        raise DuplicatoError("chroma")


# ─────────────────────────────────────────────
# CORE LOADER
# ─────────────────────────────────────────────

def carica_documento(
    json_path: str,
    id_tipo: Optional[int],
    id_livello: int,
    data_validita: str,
    data_scadenza: Optional[str],
    ai_service,
    chroma_collection,
    emit: Callable[[str], None] = print,
    forza_sovrascrivi: bool = False,
    id_utente_caricamento: Optional[int] = None,   # ← FIX: owner Admin
) -> dict:
    """
    Carica un documento da JSON in PostgreSQL e ChromaDB.

    Il parametro id_utente_caricamento deve essere l'utente_id dell'Admin
    che sta caricando il documento. Senza di esso, il documento sarà
    invisibile al filtro ownership e apparirà solo al SuperAdmin.
    """
    from app.db.session import SessionLocal
    from app.models.rag_models import Documento

    emit("📂 Lettura JSON chunks...")
    try:
        data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    except Exception as e:
        raise Exception(f"Impossibile leggere il JSON: {e}")

    meta          = data.get("documento", {})
    frammenti     = data.get("frammenti", [])
    frammenti_rag = [f for f in frammenti if f.get("index_for_rag", False)]

    titolo   = meta.get("documento_id") or meta.get("id", Path(json_path).stem)
    versione = meta.get("versione") or "1.0"

    emit(f"📄 Documento: {titolo} v{versione} — {len(frammenti_rag)} frammenti RAG")

    data_val = safe_parse_date(data_validita)
    data_sca = safe_parse_date(data_scadenza)

    if data_val is None:
        raise Exception("data_validita_inizio è obbligatoria.")
    if data_sca is not None and data_sca <= data_val:
        emit("⚠️  data_scadenza non successiva a data_validita — ignorata.")
        data_sca = None

    db = SessionLocal()
    nuovo_doc_id = None

    try:
        emit("🔍 Controllo duplicati...")
        try:
            controlla_duplicati(db, chroma_collection, titolo, versione)
        except DuplicatoError as e:
            if not forza_sovrascrivi:
                raise
            emit(f"⚠️  Già presente in {e.dove} — sovrascrittura in corso...")
            _elimina_esistente(db, chroma_collection, titolo, versione, e.documento_id, emit)

        emit("💾 Salvataggio in PostgreSQL...")
        nuovo_doc = Documento(
            titolo                = titolo,
            versione              = versione,
            id_tipo               = id_tipo,
            id_livello            = id_livello,
            data_validita_inizio  = data_val,
            data_scadenza         = data_sca,
            is_archiviato         = False,
            sync_status           = "pending",
            id_utente_caricamento = id_utente_caricamento,   # ← FIX
        )
        db.add(nuovo_doc)
        db.commit()
        db.refresh(nuovo_doc)
        nuovo_doc_id = nuovo_doc.documento_id
        emit(f"✅ PostgreSQL: documento_id={nuovo_doc_id}")

        if frammenti_rag:
            emit(f"🧠 Generazione embedding per {len(frammenti_rag)} frammenti...")
            vectors = ai_service.embed_documents([f["testo_embedding"] for f in frammenti_rag])

            ids_c, docs_c, metas_c = [], [], []
            for i, frag in enumerate(frammenti_rag):
                ids_c.append(frag.get("id", f"{titolo}_{i}"))
                docs_c.append(frag["testo"])
                metas_c.append({
                    "documento_id"    : str(nuovo_doc_id),
                    "titolo_documento": titolo,
                    "versione"        : versione,
                    "id_tipo"         : str(id_tipo) if id_tipo is not None else "",
                    "id_livello"      : str(id_livello),
                    "pagina"          : str(frag.get("pagina") or ""),
                    "anchor_link"     : frag.get("anchor_link") or "",
                    "breadcrumb"      : frag.get("breadcrumb") or "",
                    "h1"              : frag.get("h1") or "",
                    "h2"              : frag.get("h2") or "",
                    "h3"              : frag.get("h3") or "",
                    "keywords"        : ", ".join(frag.get("keywords") or []),
                    "chunk_index"     : str(frag.get("chunk_index", i)),
                })

            chroma_collection.add(ids=ids_c, embeddings=vectors, documents=docs_c, metadatas=metas_c)
            emit(f"✅ ChromaDB: {len(frammenti_rag)} frammenti caricati")
        else:
            emit("⚠️  Nessun frammento RAG trovato nel JSON")

        nuovo_doc.sync_status = "synced"
        db.commit()
        _log_sync(db, nuovo_doc_id, "load", f"Caricati {len(frammenti_rag)} frammenti", "ok")
        emit("🎉 Caricamento completato con successo!")

        return {"documento_id": nuovo_doc_id, "n_frammenti": len(frammenti_rag), "status": "ok"}

    except DuplicatoError:
        raise

    except Exception as e:
        emit(f"❌ Errore: {e} — rollback in corso...")
        db.rollback()

        if nuovo_doc_id:
            try:
                _elimina_chroma_per_titolo(chroma_collection, titolo)
                emit("↩️  ChromaDB: rollback completato")
            except Exception as ce:
                emit(f"⚠️  ChromaDB rollback parziale: {ce}")
            try:
                doc = db.query(Documento).get(nuovo_doc_id)
                if doc:
                    doc.sync_status = "error"
                    db.commit()
                    _log_sync(db, nuovo_doc_id, "rollback", str(e), "error")
            except Exception:
                pass
        raise

    finally:
        db.close()


# ─────────────────────────────────────────────
# HELPER ELIMINAZIONE
# ─────────────────────────────────────────────

def _elimina_chroma_per_titolo(chroma_collection, titolo: str) -> int:
    results = chroma_collection.get(
        where={"titolo_documento": {"$eq": titolo}}, include=[],
    )
    ids = results.get("ids", [])
    if ids:
        chroma_collection.delete(ids=ids)
    return len(ids)


def _elimina_esistente(
    db: Session, chroma_collection, titolo: str, versione: str,
    documento_id: Optional[int], emit: Callable,
) -> None:
    from app.models.rag_models import Documento
    n = _elimina_chroma_per_titolo(chroma_collection, titolo)
    emit(f"  ↩️  ChromaDB: eliminati {n} chunk esistenti")
    if documento_id:
        doc = db.query(Documento).get(documento_id)
        if doc:
            db.delete(doc)
            db.commit()
            emit(f"  ↩️  PostgreSQL: documento_id={documento_id} eliminato")


# ─────────────────────────────────────────────
# AGGIORNAMENTO DOCUMENTO
# ─────────────────────────────────────────────

def aggiorna_documento(
    documento_id: int,
    id_tipo: Optional[int],
    id_livello: int,
    versione: str,
    data_validita: str,
    data_scadenza: Optional[str],
    chroma_collection,
    emit: Callable[[str], None] = print,
) -> dict:
    from app.db.session import SessionLocal
    from app.models.rag_models import Documento

    data_val = safe_parse_date(data_validita)
    data_sca = safe_parse_date(data_scadenza)

    if data_val is None:
        raise Exception("data_validita_inizio è obbligatoria.")
    if data_sca is not None and data_sca <= data_val:
        emit("⚠️  data_scadenza non successiva a data_validita — ignorata.")
        data_sca = None

    db = SessionLocal()
    ids = []
    try:
        doc = db.query(Documento).filter_by(documento_id=documento_id).first()
        if not doc:
            raise Exception(f"Documento id={documento_id} non trovato.")

        titolo = doc.titolo
        emit(f"📄 Aggiornamento: {titolo} (id={documento_id})")

        if versione != doc.versione:
            emit(f"🔍 Controllo duplicati versione {versione}...")
            duplicato = db.query(Documento).filter(
                Documento.titolo == titolo,
                Documento.versione == versione,
                Documento.documento_id != documento_id,
            ).first()
            if duplicato:
                raise Exception(
                    f"Esiste già '{titolo}' v{versione} (documento_id={duplicato.documento_id})."
                )

        emit("💾 Aggiornamento PostgreSQL...")
        doc.id_tipo              = id_tipo
        doc.id_livello           = id_livello
        doc.versione             = versione
        doc.data_validita_inizio = data_val
        doc.data_scadenza        = data_sca
        doc.sync_status          = "pending"
        db.commit()
        emit("✅ PostgreSQL aggiornato")

        emit("🔄 Aggiornamento metadati ChromaDB...")
        try:
            results = chroma_collection.get(
                where={"titolo_documento": {"$eq": titolo}}, include=["metadatas"],
            )
            ids   = results.get("ids", [])
            metas = results.get("metadatas", [])

            if ids:
                nuovi_metas = []
                for meta in metas:
                    m = dict(meta)
                    m["id_tipo"]    = str(id_tipo) if id_tipo is not None else ""
                    m["id_livello"] = str(id_livello)
                    m["versione"]   = versione
                    nuovi_metas.append(m)
                chroma_collection.update(ids=ids, metadatas=nuovi_metas)
                emit(f"✅ ChromaDB: {len(ids)} chunk aggiornati")
            else:
                emit("⚠️  Nessun chunk trovato in ChromaDB")

        except Exception as ce:
            emit(f"❌ ChromaDB fallito: {ce} — rollback PostgreSQL...")
            doc.sync_status = "error"
            db.commit()
            _log_sync(db, documento_id, "update_rollback", str(ce), "error")
            raise Exception(f"Aggiornamento ChromaDB fallito: {ce}")

        doc.sync_status = "synced"
        db.commit()
        _log_sync(db, documento_id, "update", f"Aggiornati {len(ids)} chunk", "ok")
        emit("🎉 Aggiornamento completato!")

        return {"documento_id": documento_id, "n_chunk_aggiornati": len(ids), "status": "ok"}

    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()