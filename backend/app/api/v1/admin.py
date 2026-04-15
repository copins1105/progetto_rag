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

from app.services.auth_service import require_admin

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
# HELPER: log attività (condiviso con auth.py)
# ─────────────────────────────────────────────

def _log(
    utente_id,
    azione: str,
    dettaglio: dict = None,
    ip_address: str = None,
    esito: str = "ok",
):
    """
    Scrive un evento in Activity_Log.
    Apre una sessione autonoma per non interferire con la transazione
    principale dell'endpoint (specialmente nei background task).
    """
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        db.execute(_text(
            "INSERT INTO Activity_Log (utente_id, azione, dettaglio, ip_address, esito) "
            "VALUES (:uid, :azione, CAST(:det AS jsonb), :ip, :esito)"
        ), {
            "uid":    utente_id,
            "azione": azione,
            "det":    _json.dumps(dettaglio or {}),
            "ip":     ip_address,
            "esito":  esito,
        })
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
    """Estrae l'IP del client normalizzato (senza prefisso CIDR)."""
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


def _has_local_files(stem: str) -> bool:
    for d in [OUTPUT_DIR, CHUNKS_DIR]:
        for pattern in [f"{stem}_chunks.json", f"{stem}_fixed_chunks.json"]:
            if (d / pattern).exists():
                return True
    for suffix in [".md", "_fixed.md"]:
        if (OUTPUT_DIR / f"{stem}{suffix}").exists():
            return True
    return False


def _doc_status_batch(filenames: list, admin_svc) -> dict:
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
async def list_pdfs(request: Request, _=Depends(require_admin)):
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
# ENDPOINT: job attivi
# ─────────────────────────────────────────────

@router.get("/jobs")
async def list_jobs(_=Depends(require_admin)):
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
async def upload_pdf(
    request: Request,
    file: UploadFile = File(...),
    admin=Depends(require_admin),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Solo file PDF accettati.")
    dest    = PDF_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)
    size_kb = round(len(content) / 1024, 1)
    logger.info(f"Upload: {file.filename} ({size_kb} KB)")

    _log(
        utente_id  = admin.utente_id,
        azione     = "doc_upload",
        dettaglio  = {"filename": file.filename, "size_kb": size_kb},
        ip_address = _ip(request),
    )

    return {
        "filename": file.filename,
        "size_kb":  size_kb,
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


def _run_ingestion_sync(
    job_id: str,
    pdf_path: str,
    loop: asyncio.AbstractEventLoop,
    utente_id: int,
    ip_address: str,
):
    def emit(msg: str):
        asyncio.run_coroutine_threadsafe(_broadcast(job_id, msg), loop)

    filename = Path(pdf_path).name
    try:
        emit(f"▶ Avvio pipeline: {filename}")

        from app.services.marker_service import converti_pdf
        result = converti_pdf(pdf_path, str(OUTPUT_DIR), emit=emit)
        md_raw = result["md_raw"]

        from app.services.postprocessor_service import processa_markdown
        md_fixed = processa_markdown(
            md_raw_path=md_raw,
            output_dir=str(OUTPUT_DIR),
            pdf_path=pdf_path,
            emit=emit,
        )

        from app.services.chunker_service import chunking_e_indicizzazione
        chunks_data = chunking_e_indicizzazione(
            md_path=md_fixed,
            output_dir=str(OUTPUT_DIR),
            emit=emit,
        )

        n_rag = chunks_data["documento"]["n_frammenti_rag"]
        emit("🎉 Pipeline completata! Usa il loader per indicizzare in ChromaDB.")
        _jobs[job_id]["status"] = "done"

        _log(
            utente_id  = utente_id,
            azione     = "doc_ingestion",
            dettaglio  = {"filename": filename, "n_frammenti_rag": n_rag},
            ip_address = ip_address,
        )

    except Exception as e:
        emit(f"❌ Errore pipeline: {e}")
        _jobs[job_id]["status"] = "error"

        _log(
            utente_id  = utente_id,
            azione     = "doc_ingestion",
            dettaglio  = {"filename": filename, "errore": str(e)},
            ip_address = ip_address,
            esito      = "error",
        )


# ─────────────────────────────────────────────
# ENDPOINT: avvia ingestion
# ─────────────────────────────────────────────

@router.post("/ingest/{filename}")
async def ingest_pdf(
    filename: str,
    request: Request,
    background_tasks: BackgroundTasks,
    admin=Depends(require_admin),
):
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
        admin.utente_id,
        _ip(request),
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
async def get_chunks(
    filename: str,
    request: Request,
    page: int = 0,
    page_size: int = 15,
    _=Depends(require_admin),
):
    stem      = Path(filename).stem
    admin_svc = _admin_search(request)
    result    = admin_svc.get_chunks(stem, page=page, page_size=page_size)
    return {"filename": filename, **result}


# ─────────────────────────────────────────────
# ENDPOINT: tipi documento
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


# ─────────────────────────────────────────────
# ENDPOINT: livelli riservatezza
# ─────────────────────────────────────────────

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
# ENDPOINT: avvia loader
# ─────────────────────────────────────────────

@router.post("/load/{filename}")
async def load_document(
    filename: str,
    request: Request,
    background_tasks: BackgroundTasks,
    admin=Depends(require_admin),
):
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

    stem = Path(filename).stem
    json_candidates = list(OUTPUT_DIR.glob(f"{stem}*_chunks.json"))
    if not json_candidates:
        raise HTTPException(
            status_code=404,
            detail=f"JSON chunks non trovato per '{filename}'. Esegui prima l'ingestion."
        )
    json_path = str(json_candidates[0])

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"filename": filename, "status": "processing", "logs": []}
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
                admin_svc.reload()

                _log(
                    utente_id  = utente_id,
                    azione     = "doc_load",
                    dettaglio  = {
                        "filename":     filename,
                        "documento_id": result["documento_id"],
                        "n_frammenti":  result["n_frammenti"],
                        "id_livello":   id_livello,
                        "sovrascritto": forza_sovrascrivi,
                    },
                    ip_address = ip,
                )

            except DuplicatoError as e:
                emit(f"__DUPLICATO__{e.dove}__{e.documento_id or ''}")
                _jobs[job_id]["status"] = "duplicato"
                _log(
                    utente_id  = utente_id,
                    azione     = "doc_load",
                    dettaglio  = {"filename": filename, "motivo": f"duplicato in {e.dove}"},
                    ip_address = ip,
                    esito      = "warning",
                )

        except Exception as e:
            emit(f"❌ Errore loader: {e}")
            _jobs[job_id]["status"] = "error"
            _log(
                utente_id  = utente_id,
                azione     = "doc_load",
                dettaglio  = {"filename": filename, "errore": str(e)},
                ip_address = ip,
                esito      = "error",
            )

    background_tasks.add_task(loop.run_in_executor, None, _run_loader)
    return {"job_id": job_id, "filename": filename, "status": "processing"}


# ─────────────────────────────────────────────
# ENDPOINT: sync status
# ─────────────────────────────────────────────

@router.get("/sync-status")
async def get_sync_status(request: Request, _=Depends(require_admin)):
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
# ENDPOINT: elimina documento
# ─────────────────────────────────────────────

@router.delete("/document/{filename}")
async def delete_document_full(
    filename: str,
    request: Request,
    admin=Depends(require_admin),
):
    from app.db.session import SessionLocal
    from app.models.rag_models import Documento
    from app.services.loader_service import _elimina_chroma_per_titolo, _log_sync

    stem      = Path(filename).stem
    pdf_path  = PDF_DIR / filename
    removed   = []
    errors    = []

    if pdf_path.exists():
        pdf_path.unlink()
        removed.append("pdf")

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

    admin_svc     = _admin_search(request)
    collection    = _chroma_collection(request)
    doc_id_chroma = _resolve_documento_id_from_chroma(stem, admin_svc)

    db = SessionLocal()
    documento_id = None
    titolo_doc   = None
    try:
        if doc_id_chroma is not None:
            doc = db.query(Documento).filter(Documento.documento_id == doc_id_chroma).first()
        else:
            titolo_doc = admin_svc._resolve_title(stem)
            if titolo_doc:
                doc = db.query(Documento).filter(Documento.titolo == titolo_doc).first()
            else:
                doc = db.query(Documento).filter(Documento.titolo.ilike(f"%{stem}%")).first()

        if doc:
            documento_id = doc.documento_id
            titolo_doc   = doc.titolo
            db.delete(doc)
            db.commit()
            removed.append(f"postgres (documento_id={documento_id})")
        else:
            titolo_doc = titolo_doc or stem
            errors.append("PostgreSQL: nessun record trovato")
    except Exception as e:
        errors.append(f"PostgreSQL: {e}")
        titolo_doc = titolo_doc or stem
    finally:
        db.close()

    try:
        n = _elimina_chroma_per_titolo(collection, titolo_doc) if titolo_doc else 0
        if n:
            removed.append(f"chromadb ({n} chunks)")
        admin_svc.delete_document(stem)
    except Exception as e:
        errors.append(f"ChromaDB: {e}")

    _log(
        utente_id  = admin.utente_id,
        azione     = "doc_delete",
        dettaglio  = {
            "filename":     filename,
            "titolo":       titolo_doc,
            "documento_id": documento_id,
            "rimosso_da":   removed,
        },
        ip_address = _ip(request),
        esito      = "ok" if not errors else "warning",
    )

    return {"filename": filename, "removed": removed, "errors": errors, "ok": len(errors) == 0}


# ─────────────────────────────────────────────
# ENDPOINT: metadati documento
# ─────────────────────────────────────────────

@router.get("/document/{filename}/metadata")
async def get_document_metadata(filename: str, request: Request, _=Depends(require_admin)):
    from app.db.session import SessionLocal
    from app.models.rag_models import Documento

    stem          = Path(filename).stem
    admin_svc     = _admin_search(request)
    doc_id_chroma = _resolve_documento_id_from_chroma(stem, admin_svc)

    db = SessionLocal()
    try:
        if doc_id_chroma is not None:
            doc = db.query(Documento).filter(Documento.documento_id == doc_id_chroma).first()
        else:
            titolo_doc = admin_svc._resolve_title(stem)
            if titolo_doc:
                doc = db.query(Documento).filter(Documento.titolo == titolo_doc).first()
            else:
                doc = db.query(Documento).filter(Documento.titolo.ilike(f"%{stem}%")).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Documento non trovato in PostgreSQL.")
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
async def update_document(
    filename: str,
    request: Request,
    admin=Depends(require_admin),
):
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
            documento_id      = documento_id,
            id_tipo           = id_tipo,
            id_livello        = id_livello,
            versione          = versione,
            data_validita     = data_validita,
            data_scadenza     = data_scadenza,
            chroma_collection = collection,
        )

        _log(
            utente_id  = admin.utente_id,
            azione     = "doc_update",
            dettaglio  = {
                "filename":     filename,
                "documento_id": documento_id,
                "versione":     versione,
                "id_livello":   id_livello,
            },
            ip_address = _ip(request),
        )

        return result
    except Exception as e:
        _log(
            utente_id  = admin.utente_id,
            azione     = "doc_update",
            dettaglio  = {"filename": filename, "documento_id": documento_id, "errore": str(e)},
            ip_address = _ip(request),
            esito      = "error",
        )
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# ENDPOINT: activity log
# ─────────────────────────────────────────────

@router.get("/activity-log")
async def get_activity_log(
    request: Request,
    page: int = 0,
    page_size: int = 50,
    azione: str = "",
    esito: str = "",
    utente: str = "",
    _=Depends(require_admin),
):
    from app.db.session import SessionLocal
    from sqlalchemy import text as _text2

    db = SessionLocal()
    try:
        conditions = []
        params: dict = {"limit": page_size, "offset": page * page_size}

        if azione:
            conditions.append("al.azione = :azione")
            params["azione"] = azione
        if esito:
            conditions.append("al.esito = :esito")
            params["esito"] = esito
        if utente:
            conditions.append(
                "(LOWER(u.email) LIKE :utente "
                "OR LOWER(u.nome) LIKE :utente "
                "OR LOWER(u.cognome) LIKE :utente)"
            )
            params["utente"] = f"%{utente.lower()}%"

        where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        count_val = db.execute(
            _text2(f"""
                SELECT COUNT(*)
                FROM Activity_Log al
                LEFT JOIN Utente u ON u.utente_id = al.utente_id
                {where_clause}
            """),
            params
        ).scalar() or 0

        rows = db.execute(_text2(f"""
            SELECT
                al.log_id,
                al.timestamp,
                al.azione,
                al.dettaglio,
                al.ip_address::text AS ip_address,
                al.esito,
                al.utente_id,
                u.email   AS utente_email,
                u.nome    AS utente_nome,
                u.cognome AS utente_cognome
            FROM Activity_Log al
            LEFT JOIN Utente u ON u.utente_id = al.utente_id
            {where_clause}
            ORDER BY al.timestamp DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        logs = [
            {
                "log_id":         r.log_id,
                "timestamp":      str(r.timestamp),
                "azione":         r.azione,
                "dettaglio":      dict(r.dettaglio) if r.dettaglio else {},
                "ip_address":     (r.ip_address or "").split("/")[0],  # normalizza CIDR
                "esito":          r.esito,
                "utente_id":      r.utente_id,
                "utente_email":   r.utente_email,
                "utente_nome":    r.utente_nome,
                "utente_cognome": r.utente_cognome,
            }
            for r in rows
        ]
        return {
            "logs":      logs,
            "total":     count_val,
            "page":      page,
            "page_size": page_size,
        }
    finally:
        db.close()


@router.get("/activity-log/azioni")
async def get_activity_log_azioni(_=Depends(require_admin)):
    from app.db.session import SessionLocal
    from sqlalchemy import text as _text2
    db = SessionLocal()
    try:
        rows = db.execute(_text2(
            "SELECT DISTINCT azione FROM Activity_Log ORDER BY azione"
        )).fetchall()
        return {"azioni": [r.azione for r in rows]}
    finally:
        db.close()