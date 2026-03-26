# app/api/v1/admin.py
import os
import uuid
import asyncio
import logging
from pathlib import Path

from fastapi import (
    APIRouter, BackgroundTasks, UploadFile, File,
    HTTPException, WebSocket, WebSocketDisconnect, Request
)
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

# ─────────────────────────────────────────────
# CONFIGURAZIONE
# ─────────────────────────────────────────────

PDF_DIR    = Path(os.getenv("PDF_DIR",    "data"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "output_json"))
CHUNKS_DIR = Path(os.getenv("CHUNKS_DIR", str(Path("chunks"))))

PDF_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────
# STATO IN-MEMORY DEI JOB
# ─────────────────────────────────────────────

_jobs: dict[str, dict] = {}
_ws_connections: dict[str, list[WebSocket]] = {}


# ─────────────────────────────────────────────
# HELPER: AdminSearchService dallo stato app
# ─────────────────────────────────────────────

def _admin_search(request: Request):
    return request.app.state.admin_search_service

# ─────────────────────────────────────────────
# HELPER: AIService e ChromaDB collection dallo stato app
# ─────────────────────────────────────────────

def _ai_service(request: Request):
    """Restituisce l'AIService già inizializzato in main.py."""
    return request.app.state.search_service.ai

def _chroma_collection(request: Request):
    """Restituisce la collezione ChromaDB già aperta in main.py."""
    return request.app.state.search_service.vectorstore._collection




def _has_local_files(stem: str) -> bool:
    """Controlla se esistono file locali generati."""
    for d in [OUTPUT_DIR, CHUNKS_DIR]:
        for pattern in [f"{stem}_chunks.json", f"{stem}_fixed_chunks.json"]:
            if (d / pattern).exists():
                return True
    for suffix in [".md", "_fixed.md"]:
        if (OUTPUT_DIR / f"{stem}{suffix}").exists():
            return True
    return False


def _doc_status_batch(filenames: list, admin_svc) -> dict:
    """
    Calcola lo status di tutti i PDF in una sola passata.
    Una sola lettura degli stem indicizzati invece di N chiamate ChromaDB.
    """
    processing_filenames = {
        job["filename"]
        for job in _jobs.values()
        if job.get("status") == "processing"
    }
    indexed_stems = set(admin_svc.indexed_stems)

    result = {}
    for filename in filenames:
        stem = Path(filename).stem
        if filename in processing_filenames:
            result[filename] = "processing"
        elif stem in indexed_stems:
            result[filename] = "completed"
        elif _has_local_files(stem):
            result[filename] = "ready"
        else:
            result[filename] = "not_ingested"
    return result


def _doc_status(filename: str, admin_svc) -> str:
    return _doc_status_batch([filename], admin_svc)[filename]

def _resolve_documento_id_from_chroma(stem: str, admin_svc) -> int | None:
    """
    Legge il documento_id direttamente dai metadata dei chunk in ChromaDB.
    E' il metodo piu' robusto per collegare stem del file -> record PostgreSQL,
    perche' documento_id e' una chiave primaria e non dipende dal nome del file.
    Restituisce None se il documento non e' ancora indicizzato.
    """
    result = admin_svc.get_chunks(stem, page=0, page_size=1)
    chunks = result.get("chunks", [])
    if not chunks:
        return None
    raw = chunks[0].get("metadata", {}).get("documento_id", None)
    if raw is None:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None



# ─────────────────────────────────────────────
# ENDPOINT: lista PDF
# ─────────────────────────────────────────────

@router.get("/pdfs")
async def list_pdfs(request: Request):
    admin_svc = _admin_search(request)
    pdf_files = sorted(PDF_DIR.glob("*.pdf"))
    filenames = [p.name for p in pdf_files]
    statuses  = _doc_status_batch(filenames, admin_svc)
    pdfs = [
        {
            "filename": p.name,
            "size_kb":  round(p.stat().st_size / 1024, 1),
            "status":   statuses[p.name],
        }
        for p in pdf_files
    ]
    return {"pdfs": pdfs}


# ─────────────────────────────────────────────
# ENDPOINT: job attivi (per recupero dopo reload)
# ─────────────────────────────────────────────

@router.get("/jobs")
async def list_jobs():
    """
    Restituisce tutti i job con job_id, filename, status e logs.
    Il frontend lo chiama al mount per riconnettersi ai job in corso
    dopo un reload della pagina.
    """
    return {
        "jobs": [
            {
                "job_id":   job_id,
                "filename": job["filename"],
                "status":   job["status"],
                "logs":     job["logs"],
            }
            for job_id, job in _jobs.items()
        ]
    }


# ─────────────────────────────────────────────
# ENDPOINT: upload PDF
# ─────────────────────────────────────────────

@router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Solo file PDF accettati.")
    dest    = PDF_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)
    logger.info(f"Upload: {file.filename} ({len(content)//1024} KB)")
    return {
        "filename": file.filename,
        "size_kb":  round(len(content) / 1024, 1),
        "status":   "not_ingested",
    }


# ─────────────────────────────────────────────
# ENDPOINT: serve PDF al viewer
# ─────────────────────────────────────────────

@router.get("/pdf/{filename}")
async def serve_pdf(filename: str):
    path = PDF_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File non trovato.")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Content-Disposition": "inline",
        }
    )


# ─────────────────────────────────────────────
# PIPELINE INGESTION
# ─────────────────────────────────────────────

async def _broadcast(job_id: str, message: str):
    _jobs[job_id]["logs"].append(message)
    dead = []
    for ws in _ws_connections.get(job_id, []):
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_connections[job_id].remove(ws)


def _run_ingestion_sync(job_id: str, pdf_path: str, loop: asyncio.AbstractEventLoop):
    def emit(msg: str):
        asyncio.run_coroutine_threadsafe(_broadcast(job_id, msg), loop)

    try:
        emit(f"▶ Avvio pipeline: {Path(pdf_path).name}")

        # 1. Marker → markdown grezzo
        from app.services.marker_service import converti_pdf
        result = converti_pdf(pdf_path, str(OUTPUT_DIR), emit=emit)
        md_raw = result["md_raw"]

        # 2. Postprocessor → markdown pulito
        from app.services.postprocessor_service import processa_markdown
        md_fixed = processa_markdown(
            md_raw_path=md_raw,
            output_dir=str(OUTPUT_DIR),
            pdf_path=pdf_path,
            emit=emit,
        )

        # 3. Chunker → JSON
        from app.services.chunker_service import chunking_e_indicizzazione
        chunking_e_indicizzazione(
            md_path=md_fixed,
            output_dir=str(OUTPUT_DIR),
            emit=emit,
        )

        emit("🎉 Pipeline completata! Usa il loader per indicizzare in ChromaDB.")
        _jobs[job_id]["status"] = "done"

    except Exception as e:
        emit(f"❌ Errore pipeline: {e}")
        _jobs[job_id]["status"] = "error"


# ─────────────────────────────────────────────
# ENDPOINT: avvia ingestion
# ─────────────────────────────────────────────

@router.post("/ingest/{filename}")
async def ingest_pdf(filename: str, request: Request, background_tasks: BackgroundTasks):
    path = PDF_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File non trovato.")

    if _doc_status(filename, _admin_search(request)) == "processing":
        raise HTTPException(status_code=409, detail="Ingestion già in corso.")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"filename": filename, "status": "processing", "logs": []}
    _ws_connections[job_id] = []

    loop = asyncio.get_event_loop()
    background_tasks.add_task(
        loop.run_in_executor,
        None,
        _run_ingestion_sync,
        job_id,
        str(path),
        loop,
    )
    return {"job_id": job_id, "filename": filename, "status": "processing"}


# ─────────────────────────────────────────────
# WEBSOCKET: progress stream
# ─────────────────────────────────────────────

@router.websocket("/progress/{job_id}")
async def progress_ws(websocket: WebSocket, job_id: str):
    await websocket.accept()

    if job_id not in _jobs:
        await websocket.send_text("❌ Job non trovato.")
        await websocket.close()
        return

    for log in _jobs[job_id]["logs"]:
        await websocket.send_text(log)

    if _jobs[job_id]["status"] in ("done", "error"):
        await websocket.send_text(f"__STATUS__{_jobs[job_id]['status']}")
        await websocket.close()
        return

    _ws_connections.setdefault(job_id, []).append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if job_id in _ws_connections and websocket in _ws_connections[job_id]:
            _ws_connections[job_id].remove(websocket)


# ─────────────────────────────────────────────
# ENDPOINT: chunk explorer
# ─────────────────────────────────────────────

@router.get("/chunks/{filename}")
async def get_chunks(filename: str, request: Request, page: int = 0, page_size: int = 15):
    stem      = Path(filename).stem
    admin_svc = _admin_search(request)

    result = admin_svc.get_chunks(stem, page=page, page_size=page_size)
    return {
        "filename": filename,
        **result,
    }


# ─────────────────────────────────────────────
# ENDPOINT: tipi documento (da PostgreSQL)
# ─────────────────────────────────────────────

@router.get("/tipi-documento")
async def get_tipi_documento():
    """Restituisce i tipi documento da PostgreSQL per il form frontend."""
    from app.db.session import SessionLocal
    from app.models.rag_models import TipoDocumento
    db = SessionLocal()
    try:
        tipi = db.query(TipoDocumento).order_by(TipoDocumento.id_tipo).all()
        return {"tipi": [{"id": t.id_tipo, "nome": t.nome_tipo} for t in tipi]}
    finally:
        db.close()


# ─────────────────────────────────────────────
# ENDPOINT: livelli riservatezza (da PostgreSQL)
# ─────────────────────────────────────────────

@router.get("/livelli-riservatezza")
async def get_livelli_riservatezza():
    """Restituisce i livelli di riservatezza da PostgreSQL per il form frontend."""
    from app.db.session import SessionLocal
    from app.models.rag_models import LivelloRiservatezza
    db = SessionLocal()
    try:
        livelli = db.query(LivelloRiservatezza).order_by(LivelloRiservatezza.id_livello).all()
        return {"livelli": [{"id": l.id_livello, "nome": l.nome_livello} for l in livelli]}
    finally:
        db.close()


# ─────────────────────────────────────────────
# ENDPOINT: avvia loader (PostgreSQL + ChromaDB)
# ─────────────────────────────────────────────

@router.post("/load/{filename}")
async def load_document(
    filename: str,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    Avvia il caricamento di un documento in PostgreSQL e ChromaDB.
    I parametri (tipo, livello, date, forza_sovrascrivi) arrivano dal body JSON.
    Restituisce un job_id per seguire i log via WebSocket.
    """
    import json as json_lib
    body = await request.json()

    id_tipo           = body.get("id_tipo")
    id_livello        = body.get("id_livello")
    data_validita     = body.get("data_validita")
    data_scadenza     = body.get("data_scadenza")
    forza_sovrascrivi = body.get("forza_sovrascrivi", False)

    if not id_livello:
        raise HTTPException(status_code=400, detail="id_livello è obbligatorio.")
    if not data_validita:
        raise HTTPException(status_code=400, detail="data_validita è obbligatoria.")

    # Cerca il JSON in output_json
    stem = Path(filename).stem
    json_candidates = list(OUTPUT_DIR.glob(f"{stem}*_chunks.json"))
    if not json_candidates:
        raise HTTPException(
            status_code=404,
            detail=f"JSON chunks non trovato per '{filename}' in output_json. Esegui prima l'ingestion."
        )
    json_path = str(json_candidates[0])

    # Crea job per WebSocket progress
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"filename": filename, "status": "processing", "logs": []}
    _ws_connections[job_id] = []

    loop = asyncio.get_event_loop()

    # Recupera ai, collection e admin_svc dallo stato app PRIMA del thread
    # (request non è accessibile dentro run_in_executor)
    ai         = _ai_service(request)
    collection = _chroma_collection(request)
    admin_svc  = _admin_search(request)

    def _run_loader():
        def emit(msg: str):
            asyncio.run_coroutine_threadsafe(_broadcast(job_id, msg), loop)

        try:
            from app.services.loader_service import carica_documento, DuplicatoError
            try:
                result = carica_documento(
                    json_path         = json_path,
                    id_tipo           = id_tipo,
                    id_livello        = id_livello,
                    data_validita     = data_validita,
                    data_scadenza     = data_scadenza,
                    ai_service        = ai,
                    chroma_collection = collection,
                    emit              = emit,
                    forza_sovrascrivi = forza_sovrascrivi,
                )
                emit(f"__LOAD_OK__{result['documento_id']}")
                _jobs[job_id]["status"] = "done"
                # Ricarica mappa stem→titolo così il prossimo fetchPdfs
                # troverà il documento come "completed"
                admin_svc.reload()

            except DuplicatoError as e:
                emit(f"__DUPLICATO__{e.dove}__{e.documento_id or ''}")
                _jobs[job_id]["status"] = "duplicato"

        except Exception as e:
            emit(f"❌ Errore loader: {e}")
            _jobs[job_id]["status"] = "error"

    background_tasks.add_task(loop.run_in_executor, None, _run_loader)
    return {"job_id": job_id, "filename": filename, "status": "processing"}


# ─────────────────────────────────────────────
# ENDPOINT: sync status (Idea 4)
# ─────────────────────────────────────────────

@router.get("/sync-status")
async def get_sync_status(request: Request):
    """
    Health check sincronizzazione tra PostgreSQL e ChromaDB.
    Restituisce lo stato di ogni documento trovato in almeno uno dei due DB.
    """
    from app.db.session import SessionLocal
    from app.services.sync_service import SyncService

    collection = _chroma_collection(request)
    sync_svc   = SyncService(collection)
    db = SessionLocal()
    try:
        stati = sync_svc.stato_tutti(db)
        return {"documenti": stati}
    finally:
        db.close()


# ─────────────────────────────────────────────
# ENDPOINT: elimina documento (cascata) — Idea 5
# ─────────────────────────────────────────────

@router.delete("/document/{filename}")
async def delete_document_full(filename: str, request: Request):
    """
    Elimina un documento da TUTTI i livelli in modo coordinato:
      1. File PDF fisico
      2. File locali (md, json)
      3. PostgreSQL (con Sync_Log in cascata)
      4. ChromaDB

    Se uno step fallisce, gli altri vengono comunque tentati e
    l'errore viene riportato nel risultato.
    """
    from app.db.session import SessionLocal
    from app.models.rag_models import Documento
    from app.services.loader_service import _elimina_chroma_per_titolo, _log_sync

    stem      = Path(filename).stem
    pdf_path  = PDF_DIR / filename
    removed   = []
    errors    = []

    # 1. File PDF
    if pdf_path.exists():
        pdf_path.unlink()
        removed.append("pdf")

    # 2. File locali
    for f in [
        OUTPUT_DIR / f"{stem}_raw.md",
        OUTPUT_DIR / f"{stem}.md",
        OUTPUT_DIR / f"{stem}_fixed.md",
        OUTPUT_DIR / f"{stem}_chunks.json",
        OUTPUT_DIR / f"{stem}_fixed_chunks.json",
        CHUNKS_DIR / f"{stem}_chunks.json",
        CHUNKS_DIR / f"{stem}_fixed_chunks.json",
    ]:
        if f.exists():
            f.unlink()
            removed.append(f.name)

    # Risolvi documento_id leggendo i metadata dei chunk in ChromaDB.
    # E' piu' robusto di ilike sul titolo: doc_id e' una PK intera e non
    # dipende dal nome del file (stem != titolo nel DB).
    admin_svc     = _admin_search(request)
    collection    = _chroma_collection(request)
    doc_id_chroma = _resolve_documento_id_from_chroma(stem, admin_svc)

    # 3. PostgreSQL
    db = SessionLocal()
    documento_id = None
    titolo_doc   = None
    try:
        if doc_id_chroma is not None:
            # Caso normale: documento gia' indicizzato -> match esatto per PK
            doc = db.query(Documento).filter(
                Documento.documento_id == doc_id_chroma
            ).first()
        else:
            # Fallback: documento non ancora in ChromaDB
            # Prova prima con la mappa stem->titolo, poi con ilike
            titolo_doc = admin_svc._resolve_title(stem)
            if titolo_doc:
                doc = db.query(Documento).filter(Documento.titolo == titolo_doc).first()
            else:
                doc = db.query(Documento).filter(
                    Documento.titolo.ilike(f"%{stem}%")
                ).first()

        if doc:
            documento_id = doc.documento_id
            titolo_doc   = doc.titolo
            db.delete(doc)
            db.commit()
            removed.append(f"postgres (documento_id={documento_id})")
        else:
            titolo_doc = titolo_doc or stem
            errors.append(f"PostgreSQL: nessun record trovato (doc_id_chroma={doc_id_chroma}, stem={stem})")
    except Exception as e:
        errors.append(f"PostgreSQL: {e}")
        titolo_doc = titolo_doc or stem
    finally:
        db.close()

    # 4. ChromaDB
    try:
        n = _elimina_chroma_per_titolo(collection, titolo_doc) if titolo_doc else 0
        if n:
            removed.append(f"chromadb ({n} chunks)")
        admin_svc.delete_document(stem)

    except Exception as e:
        errors.append(f"ChromaDB: {e}")

    return {
        "filename": filename,
        "removed":  removed,
        "errors":   errors,
        "ok":       len(errors) == 0,
    }


# ─────────────────────────────────────────────
# ENDPOINT: recupera metadati documento (per precompilare form modifica)
# ─────────────────────────────────────────────

@router.get("/document/{filename}/metadata")
async def get_document_metadata(filename: str, request: Request):
    """
    Recupera i metadati attuali di un documento da PostgreSQL.
    Usato dal frontend per precompilare il form di modifica.
    """
    from app.db.session import SessionLocal
    from app.models.rag_models import Documento

    stem          = Path(filename).stem
    admin_svc     = _admin_search(request)
    doc_id_chroma = _resolve_documento_id_from_chroma(stem, admin_svc)

    db = SessionLocal()
    try:
        if doc_id_chroma is not None:
            doc = db.query(Documento).filter(
                Documento.documento_id == doc_id_chroma
            ).first()
        else:
            titolo_doc = admin_svc._resolve_title(stem)
            if titolo_doc:
                doc = db.query(Documento).filter(Documento.titolo == titolo_doc).first()
            else:
                doc = db.query(Documento).filter(
                    Documento.titolo.ilike(f"%{stem}%")
                ).first()
        if not doc:
            raise HTTPException(status_code=404, detail=f"Documento non trovato in PostgreSQL. (stem: {stem})")
        return {
            "documento_id"    : doc.documento_id,
            "titolo"          : doc.titolo,
            "versione"        : doc.versione,
            "id_tipo"         : doc.id_tipo,
            "id_livello"      : doc.id_livello,
            "data_validita"   : str(doc.data_validita_inizio) if doc.data_validita_inizio else "",
            "data_scadenza"   : str(doc.data_scadenza) if doc.data_scadenza else "",
            "sync_status"     : doc.sync_status,
        }
    finally:
        db.close()


# ─────────────────────────────────────────────
# ENDPOINT: aggiorna documento (PostgreSQL + ChromaDB)
# ─────────────────────────────────────────────

@router.put("/document/{filename}")
async def update_document(filename: str, request: Request):
    """
    Aggiorna i metadati di un documento in PostgreSQL e ChromaDB.
    Body JSON: { documento_id, id_tipo, id_livello, versione, data_validita, data_scadenza }
    """
    body = await request.json()

    documento_id  = body.get("documento_id")
    id_tipo       = body.get("id_tipo")
    id_livello    = body.get("id_livello")
    versione      = body.get("versione", "").strip()
    data_validita = body.get("data_validita")
    data_scadenza = body.get("data_scadenza")

    if not documento_id:
        raise HTTPException(status_code=400, detail="documento_id è obbligatorio.")
    if not id_livello:
        raise HTTPException(status_code=400, detail="id_livello è obbligatorio.")
    if not versione:
        raise HTTPException(status_code=400, detail="versione è obbligatoria.")
    if not data_validita:
        raise HTTPException(status_code=400, detail="data_validita è obbligatoria.")

    collection = _chroma_collection(request)

    try:
        from app.services.loader_service import aggiorna_documento
        result = aggiorna_documento(
            documento_id  = documento_id,
            id_tipo       = id_tipo,
            id_livello    = id_livello,
            versione      = versione,
            data_validita = data_validita,
            data_scadenza = data_scadenza,
            chroma_collection = collection,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))