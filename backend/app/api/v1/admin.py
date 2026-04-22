# app/api/v1/admin.py
import os
import uuid
import asyncio
import json as _json
import logging
from pathlib import Path

from fastapi import (
    APIRouter, BackgroundTasks, UploadFile, File,
    HTTPException, WebSocket, WebSocketDisconnect,
    Request, Depends
)
from fastapi.responses import FileResponse
from sqlalchemy import text as _text

from app.services.auth_service import require_admin, get_admin_scope

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
# STATO IN-MEMORY
# ─────────────────────────────────────────────

_jobs: dict[str, dict] = {}
_ws_connections: dict[str, list[WebSocket]] = {}

# Cache upload: filename -> utente_id
# Permette agli Admin di vedere i propri PDF prima che vengano salvati in DB
_upload_owner: dict[str, int] = {}


# ─────────────────────────────────────────────
# HELPER: log attività
# ─────────────────────────────────────────────

def _log(utente_id, azione: str, dettaglio: dict = None, ip_address: str = None, esito: str = "ok"):
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        db.execute(_text(
            "INSERT INTO Activity_Log (utente_id, azione, dettaglio, ip_address, esito) "
            "VALUES (:uid, :azione, CAST(:det AS jsonb), :ip, :esito)"
        ), {"uid": utente_id, "azione": azione, "det": _json.dumps(dettaglio or {}), "ip": ip_address, "esito": esito})
        db.commit()
    except Exception as e:
        logger.warning(f"_log fallito ({azione}): {e}")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def _ip(request: Request) -> str:
    raw = request.client.host if request.client else None
    if raw and "/" in raw:
        raw = raw.split("/")[0]
    return raw


# ─────────────────────────────────────────────
# HELPER: servizi dallo stato app
# ─────────────────────────────────────────────

def _admin_search(request: Request):
    return request.app.state.admin_search_service

def _ai_service(request: Request):
    return request.app.state.search_service.ai

def _chroma_collection(request: Request):
    return request.app.state.search_service.vectorstore._collection


# ─────────────────────────────────────────────
# HELPER: ricerca file locali post-ingestion
# ─────────────────────────────────────────────

def _find_chunks_json(stem: str) -> Path | None:
    """
    Cerca il file JSON chunks generato dal chunker.
    Il nome del file può differire dallo stem del PDF se il postprocessor
    ha rinominato il markdown (es: da documento_raw.md → documento.md
    → il chunks si chiama documento_chunks.json, non documento_raw_chunks.json).

    FIX: il PDF ha stem "documento", il markdown pulito ha stem "documento"
    (il _raw viene rimosso dal postprocessor), quindi i pattern qui sotto
    coprono tutti i casi reali.
    """
    candidates = [
        OUTPUT_DIR / f"{stem}_chunks.json",
        OUTPUT_DIR / f"{stem}_fixed_chunks.json",
        CHUNKS_DIR / f"{stem}_chunks.json",
        CHUNKS_DIR / f"{stem}_fixed_chunks.json",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def _has_local_files(stem: str) -> bool:
    """
    True se esistono file locali prodotti dalla pipeline (chunks JSON o markdown).
    Indica stato "ready" per il loader.
    """
    if _find_chunks_json(stem) is not None:
        return True
    md_candidates = [
        OUTPUT_DIR / f"{stem}.md",
        OUTPUT_DIR / f"{stem}_fixed.md",
    ]
    return any(p.exists() for p in md_candidates)


def _doc_status_batch(filenames: list, admin_svc) -> dict:
    """
    Calcola lo stato di ogni PDF in modo efficiente.
    Ordine di priorità: processing > completed > ready > not_ingested
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
    """Recupera il documento_id PostgreSQL dal metadata ChromaDB."""
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
# HELPER: ownership
# ─────────────────────────────────────────────

def _get_titoli_owner(owner_filter: int | None, db) -> set:
    from app.models.rag_models import Documento
    query = db.query(Documento.titolo).filter(Documento.is_archiviato == False)
    if owner_filter is not None:
        query = query.filter(Documento.id_utente_caricamento == owner_filter)
    return {row.titolo for row in query.all()}


def _pdf_belongs_to_admin(pdf_path: Path, admin_utente_id: int, titoli_admin: set, admin_svc) -> bool:
    """
    Un PDF appartiene a un Admin se:
      - il suo titolo (risolto da ChromaDB) è nella lista dei documenti dell'Admin, OPPURE
      - è ancora in fase pre-DB (not_ingested/ready/processing) ed è stato
        caricato da quell'Admin (tracciato in _upload_owner)
    """
    stem  = pdf_path.stem
    title = admin_svc._resolve_title(stem)
    if title and title in titoli_admin:
        return True
    status = _doc_status(pdf_path.name, admin_svc)
    if status in ("not_ingested", "ready", "processing"):
        return _upload_owner.get(pdf_path.name) == admin_utente_id
    return False


# ─────────────────────────────────────────────
# ENDPOINT: lista PDF
# ─────────────────────────────────────────────

@router.get("/pdfs")
async def list_pdfs(request: Request, admin=Depends(require_admin)):
    from app.db.session import SessionLocal
    admin_svc = _admin_search(request)

    db    = SessionLocal()
    scope = get_admin_scope(admin, db)
    try:
        all_pdf_files = sorted(PDF_DIR.glob("*.pdf"))
        if scope["owner_filter"] is not None:
            titoli_admin = _get_titoli_owner(scope["owner_filter"], db)
            pdf_files = [
                f for f in all_pdf_files
                if _pdf_belongs_to_admin(f, admin.utente_id, titoli_admin, admin_svc)
            ]
        else:
            pdf_files = all_pdf_files
    finally:
        db.close()

    filenames = [p.name for p in pdf_files]
    statuses  = _doc_status_batch(filenames, admin_svc)
    return {"pdfs": [
        {"filename": p.name, "size_kb": round(p.stat().st_size / 1024, 1), "status": statuses[p.name]}
        for p in pdf_files
    ]}


# ─────────────────────────────────────────────
# ENDPOINT: job attivi
# ─────────────────────────────────────────────

@router.get("/jobs")
async def list_jobs(_=Depends(require_admin)):
    return {"jobs": [
        {"job_id": jid, "filename": j["filename"], "status": j["status"], "logs": j["logs"]}
        for jid, j in _jobs.items()
    ]}


# ─────────────────────────────────────────────
# ENDPOINT: upload PDF
# ─────────────────────────────────────────────

@router.post("/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...), admin=Depends(require_admin)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Solo file PDF accettati.")
    dest    = PDF_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)
    size_kb = round(len(content) / 1024, 1)

    # Registra proprietario upload per filtro ownership pre-DB
    _upload_owner[file.filename] = admin.utente_id

    _log(admin.utente_id, "doc_upload", {"filename": file.filename, "size_kb": size_kb}, _ip(request))
    return {"filename": file.filename, "size_kb": size_kb, "status": "not_ingested"}


# ─────────────────────────────────────────────
# ENDPOINT: serve PDF al viewer
# ─────────────────────────────────────────────

@router.get("/pdf/{filename}")
async def serve_pdf(filename: str):
    path = PDF_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File non trovato.")
    return FileResponse(path, media_type="application/pdf",
                        headers={"Access-Control-Allow-Origin": "*", "Content-Disposition": "inline"})


# ─────────────────────────────────────────────
# BROADCAST WebSocket
# ─────────────────────────────────────────────

async def _broadcast(job_id: str, message: str):
    if job_id not in _jobs:
        return
    _jobs[job_id]["logs"].append(message)
    dead = []
    for ws in _ws_connections.get(job_id, []):
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            _ws_connections[job_id].remove(ws)
        except ValueError:
            pass


# ─────────────────────────────────────────────
# PIPELINE INGESTION (background thread)
# ─────────────────────────────────────────────

def _run_ingestion_sync(job_id: str, pdf_path: str, loop: asyncio.AbstractEventLoop,
                         utente_id: int, ip_address: str):
    def emit(msg: str):
        asyncio.run_coroutine_threadsafe(_broadcast(job_id, msg), loop)

    filename = Path(pdf_path).name
    try:
        emit(f"▶ Avvio pipeline: {filename}")

        from app.services.marker_service import converti_pdf
        result  = converti_pdf(pdf_path, str(OUTPUT_DIR), emit=emit)
        md_raw  = result["md_raw"]

        from app.services.postprocessor_service import processa_markdown
        md_fixed = processa_markdown(md_raw_path=md_raw, output_dir=str(OUTPUT_DIR),
                                     pdf_path=pdf_path, emit=emit)

        from app.services.chunker_service import chunking_e_indicizzazione
        chunks_data = chunking_e_indicizzazione(md_path=md_fixed, output_dir=str(OUTPUT_DIR), emit=emit)

        n_rag = chunks_data["documento"]["n_frammenti_rag"]
        emit("🎉 Pipeline completata! Usa il loader per indicizzare in ChromaDB.")
        _jobs[job_id]["status"] = "done"
        _log(utente_id, "doc_ingestion", {"filename": filename, "n_frammenti_rag": n_rag}, ip_address)

    except Exception as e:
        logger.exception(f"Ingestion fallita per {filename}")
        emit(f"❌ Errore pipeline: {e}")
        _jobs[job_id]["status"] = "error"
        _log(utente_id, "doc_ingestion", {"filename": filename, "errore": str(e)}, ip_address, esito="error")


# ─────────────────────────────────────────────
# ENDPOINT: avvia ingestion
# ─────────────────────────────────────────────

@router.post("/ingest/{filename}")
async def ingest_pdf(filename: str, request: Request, background_tasks: BackgroundTasks,
                     admin=Depends(require_admin)):
    path = PDF_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File non trovato.")
    if _doc_status(filename, _admin_search(request)) == "processing":
        raise HTTPException(status_code=409, detail="Ingestion già in corso.")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"filename": filename, "status": "processing", "logs": [], "uploader_id": admin.utente_id}
    _ws_connections[job_id] = []
    _upload_owner[filename] = admin.utente_id   # mantieni l'owner anche durante ingestion

    loop = asyncio.get_event_loop()
    background_tasks.add_task(loop.run_in_executor, None,
                               _run_ingestion_sync, job_id, str(path), loop, admin.utente_id, _ip(request))
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

    # Replay dei log già accumulati
    for log in list(_jobs[job_id]["logs"]):
        await websocket.send_text(log)

    # Job già terminato: invia status e chiudi
    if _jobs[job_id]["status"] in ("done", "error"):
        await websocket.send_text(f"__STATUS__{_jobs[job_id]['status']}")
        await websocket.close()
        return

    _ws_connections.setdefault(job_id, []).append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        conns = _ws_connections.get(job_id, [])
        if websocket in conns:
            conns.remove(websocket)


# ─────────────────────────────────────────────
# ENDPOINT: chunks explorer
# ─────────────────────────────────────────────

@router.get("/chunks/{filename}")
async def get_chunks(filename: str, request: Request, page: int = 0,
                     page_size: int = 15, admin=Depends(require_admin)):
    from app.db.session import SessionLocal
    stem      = Path(filename).stem
    admin_svc = _admin_search(request)
    db        = SessionLocal()
    scope     = get_admin_scope(admin, db)
    try:
        if scope["owner_filter"] is not None:
            titoli_miei = _get_titoli_owner(scope["owner_filter"], db)
            titolo_doc  = admin_svc._resolve_title(stem)
            if titolo_doc and titolo_doc not in titoli_miei:
                raise HTTPException(status_code=403, detail="Accesso negato.")
    finally:
        db.close()

    result = admin_svc.get_chunks(stem, page=page, page_size=page_size)
    return {"filename": filename, **result}


# ─────────────────────────────────────────────
# ENDPOINT: tipi e livelli
# ─────────────────────────────────────────────

@router.get("/tipi-documento")
async def get_tipi_documento(_=Depends(require_admin)):
    from app.db.session import SessionLocal
    from app.models.rag_models import TipoDocumento
    db = SessionLocal()
    try:
        tipi = db.query(TipoDocumento).order_by(TipoDocumento.id_tipo).all()
        return {"tipi": [{"id": t.id_tipo, "nome": t.nome_tipo} for t in tipi]}
    finally:
        db.close()


@router.get("/livelli-riservatezza")
async def get_livelli_riservatezza(_=Depends(require_admin)):
    from app.db.session import SessionLocal
    from app.models.rag_models import LivelloRiservatezza
    db = SessionLocal()
    try:
        livelli = db.query(LivelloRiservatezza).order_by(LivelloRiservatezza.id_livello).all()
        return {"livelli": [{"id": l.id_livello, "nome": l.nome_livello} for l in livelli]}
    finally:
        db.close()


# ─────────────────────────────────────────────
# ENDPOINT: loader
# ─────────────────────────────────────────────

@router.post("/load/{filename}")
async def load_document(filename: str, request: Request, background_tasks: BackgroundTasks,
                        admin=Depends(require_admin)):
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

    # FIX: usa _find_chunks_json per trovare il file in modo robusto
    stem = Path(filename).stem
    json_path_obj = _find_chunks_json(stem)
    if json_path_obj is None:
        raise HTTPException(
            status_code=404,
            detail=f"JSON chunks non trovato per '{filename}'. Esegui prima l'ingestion."
        )
    json_path = str(json_path_obj)

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"filename": filename, "status": "processing", "logs": [], "uploader_id": admin.utente_id}
    _ws_connections[job_id] = []

    loop       = asyncio.get_event_loop()
    ai         = _ai_service(request)
    collection = _chroma_collection(request)
    admin_svc  = _admin_search(request)
    utente_id  = admin.utente_id
    ip         = _ip(request)

    def _run_loader():
        def emit(msg: str):
            asyncio.run_coroutine_threadsafe(_broadcast(job_id, msg), loop)

        try:
            from app.services.loader_service import carica_documento, DuplicatoError
            try:
                result = carica_documento(
                    json_path             = json_path,
                    id_tipo               = id_tipo,
                    id_livello            = id_livello,
                    data_validita         = data_validita,
                    data_scadenza         = data_scadenza,
                    ai_service            = ai,
                    chroma_collection     = collection,
                    emit                  = emit,
                    forza_sovrascrivi     = forza_sovrascrivi,
                    id_utente_caricamento = utente_id,
                )
                emit(f"__LOAD_OK__{result['documento_id']}")
                _jobs[job_id]["status"] = "done"

                # Ricarica mappa stem→titolo in AdminSearchService
                try:
                    admin_svc.reload()
                except Exception as re_err:
                    logger.warning(f"AdminSearchService.reload() fallito: {re_err}")

                # Il PDF ora è in DB: rimuovi dalla cache upload
                # (la ownership ora è tracciata da id_utente_caricamento)
                _upload_owner.pop(filename, None)

                _log(utente_id, "doc_load", {
                    "filename": filename, "documento_id": result["documento_id"],
                    "n_frammenti": result["n_frammenti"], "id_livello": id_livello,
                    "sovrascritto": forza_sovrascrivi,
                }, ip)

            except DuplicatoError as e:
                emit(f"__DUPLICATO__{e.dove}__{e.documento_id or ''}")
                _jobs[job_id]["status"] = "duplicato"
                _log(utente_id, "doc_load",
                     {"filename": filename, "motivo": f"duplicato in {e.dove}"}, ip, esito="warning")

        except Exception as e:
            logger.exception(f"Loader fallito per {filename}")
            emit(f"❌ Errore loader: {e}")
            _jobs[job_id]["status"] = "error"
            _log(utente_id, "doc_load", {"filename": filename, "errore": str(e)}, ip, esito="error")

    background_tasks.add_task(loop.run_in_executor, None, _run_loader)
    return {"job_id": job_id, "filename": filename, "status": "processing"}


# ─────────────────────────────────────────────
# ENDPOINT: sync status
# ─────────────────────────────────────────────

@router.get("/sync-status")
async def get_sync_status(request: Request, admin=Depends(require_admin)):
    from app.db.session import SessionLocal
    from app.services.sync_service import SyncService

    collection = _chroma_collection(request)
    sync_svc   = SyncService(collection)
    db         = SessionLocal()
    scope      = get_admin_scope(admin, db)
    try:
        tutti = sync_svc.stato_tutti(db)
        if scope["owner_filter"] is not None:
            titoli_miei = _get_titoli_owner(scope["owner_filter"], db)
            tutti = [s for s in tutti if s["titolo"] in titoli_miei]
        return {"documenti": tutti}
    finally:
        db.close()


# ─────────────────────────────────────────────
# ENDPOINT: elimina documento (FIX completo)
# ─────────────────────────────────────────────

@router.delete("/document/{filename}")
async def delete_document_full(filename: str, request: Request, admin=Depends(require_admin)):
    """
    Elimina un documento da tutti i livelli in modo robusto.

    FIX rispetto alla versione precedente:
    - La sessione DB viene chiusa PRIMA di procedere con ChromaDB e file
      (evita "Session closed" errors da rollback impliciti)
    - Ogni fase è indipendente: un errore in una non blocca le altre
    - Gestisce tutti i casi: solo PG, solo Chroma, solo file, nessuno
    - Fallback a ricerca ILIKE se stem→titolo non risolve
    - Log dettagliato per ogni fase
    """
    from app.services.loader_service import _elimina_chroma_per_titolo
    from app.services.auth_service import require_doc_owner
    from app.models.rag_models import Documento
    from app.db.session import SessionLocal

    stem       = Path(filename).stem
    pdf_path   = PDF_DIR / filename
    removed    = []
    errors     = []
    admin_svc  = _admin_search(request)
    collection = _chroma_collection(request)

    # ────────────────────────────────────────
    # FASE 1: Trova e rimuovi da PostgreSQL
    # Usiamo un blocco try/finally dedicato per garantire
    # che la sessione venga sempre chiusa prima delle fasi successive.
    # ────────────────────────────────────────
    documento_id = None
    titolo_doc   = None

    db = SessionLocal()
    try:
        # Strategia di ricerca a cascata (dalla più affidabile alla meno)
        doc = None

        # 1a. Tramite documento_id recuperato da ChromaDB metadata
        doc_id_chroma = _resolve_documento_id_from_chroma(stem, admin_svc)
        if doc_id_chroma is not None:
            doc = db.query(Documento).filter(Documento.documento_id == doc_id_chroma).first()

        # 1b. Tramite titolo risolto da AdminSearchService
        if doc is None:
            titolo_candidato = admin_svc._resolve_title(stem)
            if titolo_candidato:
                doc = db.query(Documento).filter(Documento.titolo == titolo_candidato).first()

        # 1c. Ricerca ILIKE sullo stem (fallback finale)
        if doc is None:
            doc = db.query(Documento).filter(Documento.titolo.ilike(f"%{stem}%")).first()

        if doc is not None:
            documento_id = doc.documento_id
            titolo_doc   = doc.titolo

            # Ownership check — SuperAdmin bypassa automaticamente
            require_doc_owner(documento_id, admin, db)

            db.delete(doc)
            db.commit()
            removed.append(f"postgres:id={documento_id}")
        else:
            # Documento non in PostgreSQL: ricava il titolo da altre fonti
            titolo_doc = admin_svc._resolve_title(stem) or stem
            errors.append("postgres:not_found")

    except HTTPException:
        # Ownership check fallito o 404: rilancia subito senza toccare altro
        db.rollback()
        db.close()
        raise
    except Exception as e:
        logger.exception(f"Delete fase PostgreSQL fallita per '{stem}'")
        errors.append(f"postgres:error:{type(e).__name__}")
        titolo_doc = admin_svc._resolve_title(stem) or stem
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        # La sessione viene SEMPRE chiusa qui, prima di ChromaDB e file
        db.close()

    # ────────────────────────────────────────
    # FASE 2: Rimuovi da ChromaDB
    # Eseguita sempre, anche se PG ha fallito, per garantire consistenza.
    # ────────────────────────────────────────
    if titolo_doc:
        try:
            n = _elimina_chroma_per_titolo(collection, titolo_doc)
            if n > 0:
                removed.append(f"chromadb:{n}_chunks")
            else:
                # Prova con lo stem come titolo alternativo
                n2 = _elimina_chroma_per_titolo(collection, stem)
                if n2 > 0:
                    removed.append(f"chromadb:{n2}_chunks(via_stem)")
                else:
                    errors.append("chromadb:no_chunks")
        except Exception as e:
            logger.exception(f"Delete fase ChromaDB fallita per '{titolo_doc}'")
            errors.append(f"chromadb:error:{type(e).__name__}")

    # ────────────────────────────────────────
    # FASE 3: Rimuovi file fisici locali
    # ────────────────────────────────────────
    files_to_delete = [
        pdf_path,
        OUTPUT_DIR / f"{stem}_raw.md",
        OUTPUT_DIR / f"{stem}.md",
        OUTPUT_DIR / f"{stem}_fixed.md",
        OUTPUT_DIR / f"{stem}_chunks.json",
        OUTPUT_DIR / f"{stem}_fixed_chunks.json",
        OUTPUT_DIR / f"{stem}_pages.json",
        CHUNKS_DIR / f"{stem}_chunks.json",
        CHUNKS_DIR / f"{stem}_fixed_chunks.json",
    ]
    for f in files_to_delete:
        if f.exists():
            try:
                f.unlink()
                removed.append(f"file:{f.name}")
            except Exception as e:
                errors.append(f"file:{f.name}:error:{type(e).__name__}")

    # ────────────────────────────────────────
    # FASE 4: Aggiorna cache in-memory
    # ────────────────────────────────────────
    try:
        admin_svc.delete_document(stem)
    except Exception as e:
        logger.warning(f"AdminSearchService.delete_document fallito: {e}")

    _upload_owner.pop(filename, None)

    # ────────────────────────────────────────
    # Log e risposta
    # ────────────────────────────────────────
    # Consideriamo "warning" solo gli errori reali (non i "not_found")
    hard_errors = [e for e in errors if ":error:" in e]
    esito = "error" if hard_errors else ("warning" if errors else "ok")

    _log(admin.utente_id, "doc_delete", {
        "filename": filename, "titolo": titolo_doc,
        "documento_id": documento_id, "rimosso_da": removed, "errori": errors,
    }, _ip(request), esito=esito)

    return {
        "filename": filename,
        "removed":  removed,
        "errors":   errors,
        "ok":       len(hard_errors) == 0,
    }


# ─────────────────────────────────────────────
# ENDPOINT: metadati documento
# ─────────────────────────────────────────────

@router.get("/document/{filename}/metadata")
async def get_document_metadata(filename: str, request: Request, admin=Depends(require_admin)):
    from app.db.session import SessionLocal
    from app.models.rag_models import Documento
    from app.services.auth_service import require_doc_owner

    stem      = Path(filename).stem
    admin_svc = _admin_search(request)
    db        = SessionLocal()
    try:
        doc_id_chroma = _resolve_documento_id_from_chroma(stem, admin_svc)
        doc = None
        if doc_id_chroma is not None:
            doc = db.query(Documento).filter(Documento.documento_id == doc_id_chroma).first()
        if doc is None:
            titolo_doc = admin_svc._resolve_title(stem)
            if titolo_doc:
                doc = db.query(Documento).filter(Documento.titolo == titolo_doc).first()
        if doc is None:
            doc = db.query(Documento).filter(Documento.titolo.ilike(f"%{stem}%")).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Documento non trovato in PostgreSQL.")

        require_doc_owner(doc.documento_id, admin, db)

        return {
            "documento_id":  doc.documento_id,
            "titolo":        doc.titolo,
            "versione":      doc.versione,
            "id_tipo":       doc.id_tipo,
            "id_livello":    doc.id_livello,
            "data_validita": str(doc.data_validita_inizio) if doc.data_validita_inizio else "",
            "data_scadenza": str(doc.data_scadenza) if doc.data_scadenza else "",
            "sync_status":   doc.sync_status,
        }
    finally:
        db.close()


# ─────────────────────────────────────────────
# ENDPOINT: aggiorna documento
# ─────────────────────────────────────────────

@router.put("/document/{filename}")
async def update_document(filename: str, request: Request, admin=Depends(require_admin)):
    from app.services.auth_service import require_doc_owner
    from app.db.session import SessionLocal

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

    db = SessionLocal()
    try:
        require_doc_owner(documento_id, admin, db)
    finally:
        db.close()

    collection = _chroma_collection(request)
    try:
        from app.services.loader_service import aggiorna_documento
        result = aggiorna_documento(
            documento_id=documento_id, id_tipo=id_tipo, id_livello=id_livello,
            versione=versione, data_validita=data_validita, data_scadenza=data_scadenza,
            chroma_collection=collection,
        )
        _log(admin.utente_id, "doc_update", {
            "filename": filename, "documento_id": documento_id,
            "versione": versione, "id_livello": id_livello,
        }, _ip(request))
        return result
    except Exception as e:
        logger.exception(f"Update fallito per {filename}")
        _log(admin.utente_id, "doc_update",
             {"filename": filename, "documento_id": documento_id, "errore": str(e)},
             _ip(request), esito="error")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# ENDPOINT: activity log
# ─────────────────────────────────────────────

@router.get("/activity-log")
async def get_activity_log(request: Request, page: int = 0, page_size: int = 50,
                            azione: str = "", esito: str = "", utente: str = "",
                            admin=Depends(require_admin)):
    from app.db.session import SessionLocal
    from sqlalchemy import text as _text2

    db    = SessionLocal()
    scope = get_admin_scope(admin, db)
    db.close()

    db = SessionLocal()
    try:
        conditions = []
        params: dict = {"limit": page_size, "offset": page * page_size}

        if scope["owner_filter"] is not None:
            conditions.append("al.utente_id = :owner_uid")
            params["owner_uid"] = scope["owner_filter"]
        if azione:
            conditions.append("al.azione = :azione")
            params["azione"] = azione
        if esito:
            conditions.append("al.esito = :esito")
            params["esito"] = esito
        if utente and scope["owner_filter"] is None:
            conditions.append("(LOWER(u.email) LIKE :utente OR LOWER(u.nome) LIKE :utente OR LOWER(u.cognome) LIKE :utente)")
            params["utente"] = f"%{utente.lower()}%"

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        count_val = db.execute(_text2(
            f"SELECT COUNT(*) FROM Activity_Log al LEFT JOIN Utente u ON u.utente_id = al.utente_id {where}"
        ), params).scalar() or 0

        rows = db.execute(_text2(f"""
            SELECT al.log_id, al.timestamp, al.azione, al.dettaglio,
                   al.ip_address::text AS ip_address, al.esito, al.utente_id,
                   u.email AS utente_email, u.nome AS utente_nome, u.cognome AS utente_cognome
            FROM Activity_Log al
            LEFT JOIN Utente u ON u.utente_id = al.utente_id
            {where}
            ORDER BY al.timestamp DESC LIMIT :limit OFFSET :offset
        """), params).fetchall()

        logs = [{
            "log_id": r.log_id, "timestamp": str(r.timestamp), "azione": r.azione,
            "dettaglio": dict(r.dettaglio) if r.dettaglio else {},
            "ip_address": (r.ip_address or "").split("/")[0],
            "esito": r.esito, "utente_id": r.utente_id,
            "utente_email": r.utente_email, "utente_nome": r.utente_nome,
            "utente_cognome": r.utente_cognome,
        } for r in rows]

        return {"logs": logs, "total": count_val, "page": page, "page_size": page_size}
    finally:
        db.close()


@router.get("/activity-log/azioni")
async def get_activity_log_azioni(_=Depends(require_admin)):
    from app.db.session import SessionLocal
    from sqlalchemy import text as _text2
    db = SessionLocal()
    try:
        rows = db.execute(_text2("SELECT DISTINCT azione FROM Activity_Log ORDER BY azione")).fetchall()
        return {"azioni": [r.azione for r in rows]}
    finally:
        db.close()