
# import re
# import time
# import logging
# from fastapi import APIRouter, HTTPException, Request, status, Depends
# from pydantic import BaseModel
# from langchain_core.messages import HumanMessage, AIMessage

# from app.services.auth_service import get_current_user, require_permission
# from app.services import chat_history_service as history

# logger = logging.getLogger(__name__)
# router = APIRouter(redirect_slashes=True)


# class ChatRequest(BaseModel):
#     question:   str
#     session_id: str
#     debug:      bool = False


# def _normalize_page(raw) -> str:
#     if raw is None:
#         return ""
#     s = str(raw).strip()
#     if s in ("", "None", "null", "N/D", "n/d"):
#         return ""
#     s = s.lstrip("p").strip()
#     return s if s.isdigit() else ""


# def _extract_sources(source_docs) -> list:
#     sources   = []
#     seen_keys = set()

#     for d in source_docs:
#         title      = d.metadata.get("titolo_documento", "N/D")
#         link       = d.metadata.get("anchor_link", "")
#         breadcrumb = d.metadata.get("breadcrumb", "Generale")

#         page = ""
#         if link:
#             m = re.search(r'#page=(\d+)', link)
#             if m:
#                 page = m.group(1)

#         if not page:
#             page = _normalize_page(d.metadata.get("pagina", ""))

#         key = (title, page) if page else (title, breadcrumb)
#         if key not in seen_keys:
#             seen_keys.add(key)
#             sources.append({
#                 "title":      title,
#                 "page":       page,
#                 "link":       link,
#                 "breadcrumb": breadcrumb,
#             })

#     return sources


# def _detect_tipo_risposta(response) -> str:
#     """Inferisce il tipo di risposta dal contenuto."""
#     content = str(response.content)
#     source_docs = getattr(response, "source_docs", [])

#     # Messaggi standard del chain
#     _NOT_FOUND = "Non ho trovato informazioni pertinenti"
#     _BLOCKED   = "non posso rispondere a questa richiesta"

#     if _BLOCKED.lower() in content.lower():
#         return "blocked"
#     if _NOT_FOUND in content:
#         return "not_found"
#     if not source_docs:
#         return "courtesy"
#     return "content"


# @router.post("/chat")
# async def chat_endpoint(
#     request: ChatRequest,
#     fastapi_req: Request,
#     current_user=Depends(get_current_user),
# ):
#     try:
#         chain = fastapi_req.app.state.rag_chain
#         store = fastapi_req.app.state.chat_store

#         if not request.question.strip():
#             raise HTTPException(
#                 status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
#                 detail="La domanda non può essere vuota."
#             )

#         session = store.get(request.session_id, {"history": [], "summary": ""})
#         history_msgs = session["history"]
#         summary = session["summary"]

#         # ── Invocazione chain con misurazione latenza ──────────
#         t0 = time.time()
#         response = chain.invoke({
#             "question":             request.question,
#             "history":              history_msgs,
#             "conversation_summary": summary,
#         })
#         elapsed_ms = int((time.time() - t0) * 1000)

#         if not hasattr(response, "content"):
#             logger.error(f"chain.invoke tipo inatteso: {type(response)}")
#             raise HTTPException(
#                 status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#                 detail="Errore interno: risposta malformata dal chain."
#             )

#         store[request.session_id] = {
#             "history": history_msgs + [
#                 HumanMessage(content=request.question),
#                 AIMessage(content=str(response.content)),
#             ],
#             "summary": getattr(response, "conversation_summary", summary),
#         }

#         sources = _extract_sources(response.source_docs)

#         # ── Salvataggio persistente (fire-and-forget) ──────────
#         tipo = _detect_tipo_risposta(response)
#         ip   = fastapi_req.client.host if fastapi_req.client else None
#         ua   = fastapi_req.headers.get("user-agent")

#         log_id=history.salva_messaggio(
#             session_uuid  = request.session_id,
#             utente_id     = current_user.utente_id,
#             domanda       = request.question,
#             risposta      = str(response.content),
#             source_docs   = response.source_docs,
#             tempo_ms      = elapsed_ms,
#             tipo_risposta = tipo,
#             bloccato      = (tipo == "blocked"),
#             ip_address    = ip,
#             user_agent    = ua,
#         )

#         resp = {
#             "answer":     response.content,
#             "sources":    sources,
#             "session_id": request.session_id,
#             "log_id":     log_id,
#         }

#         if request.debug and hasattr(response, "build_retrieval_debug"):
#             resp["retrieval_debug"] = response.build_retrieval_debug()
#         elif request.debug:
#             resp["retrieval_debug"] = [
#                 {
#                     "chunk_idx":   i + 1,
#                     "titolo":      d.metadata.get("titolo_documento", "N/D"),
#                     "pagina":      _normalize_page(d.metadata.get("pagina", "")),
#                     "anchor_link": d.metadata.get("anchor_link", ""),
#                     "breadcrumb":  d.metadata.get("breadcrumb", ""),
#                     "preview":     d.page_content[:200],
#                 }
#                 for i, d in enumerate(response.source_docs)
#             ]

#         return resp

#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.exception(f"Errore in chat_endpoint: {e}")
#         raise HTTPException(
#             status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#             detail="Si è verificato un errore interno. Riprova tra qualche istante."
#         )


# @router.post("/chat/reset")
# async def reset_chat(
#     request: ChatRequest,
#     fastapi_req: Request,
#     current_user=Depends(get_current_user),
# ):
#     store      = fastapi_req.app.state.chat_store
#     session_id = request.session_id
#     if session_id in store:
#         del store[session_id]
#         return {"status": "success", "message": f"Sessione {session_id} resettata."}
#     return {"status": "info", "message": "Nessuna cronologia attiva."}


# # ─────────────────────────────────────────────
# # ENDPOINT: storico sessioni utente (per sidebar)
# # ─────────────────────────────────────────────

# @router.get("/chat/sessions")
# async def get_my_sessions(
#     limit: int = 20,
#     include_archived: bool = False,
#     current_user=Depends(require_permission("chat_history_view")),
# ):
#     """
#     Restituisce le ultime N sessioni dell'utente autenticato.
#     Usato dalla sidebar per mostrare la cronologia delle conversazioni.
#     """
#     sessioni = history.get_sessioni_utente(
#         utente_id         = current_user.utente_id,
#         limit             = min(limit, 50),  # cap a 50 per evitare payload enormi
#         include_archiviate = include_archived,
#     )
#     return {"sessions": sessioni}


# @router.get("/chat/sessions/{session_uuid}")
# async def get_session_detail(
#     session_uuid: str,
#     current_user=Depends(require_permission("chat_history_view")),
# ):
#     """
#     Restituisce i messaggi di una sessione specifica dell'utente.
#     Un utente normale può accedere solo alle proprie sessioni.
#     """
#     detail = history.get_messaggi_sessione(
#         session_uuid          = session_uuid,
#         utente_id_richiedente = current_user.utente_id,
#         is_admin              = False,
#     )
#     if detail is None:
#         raise HTTPException(status_code=404, detail="Sessione non trovata.")
#     return detail


# @router.delete("/chat/sessions/{session_uuid}")
# async def archive_session(
#     session_uuid: str,
#     current_user=Depends(require_permission("chat_history_view")),
# ):
#     """
#     Archivia (soft delete) una sessione dell'utente.
#     La sessione non compare più nella sidebar ma rimane per l'audit admin.
#     """
#     ok = history.archivia_sessione(session_uuid, current_user.utente_id)
#     if not ok:
#         raise HTTPException(status_code=404, detail="Sessione non trovata.")
#     return {"status": "archived"}


# @router.post("/chat/sessions/{log_id}/feedback")
# async def submit_feedback(
#     log_id: int,
#     fastapi_req: Request,
#     current_user=Depends(require_permission("chat_history_view")),
# ):
#     """
#     Salva il feedback CSAT (1-5 stelle) su un singolo messaggio.
#     """
#     body = await fastapi_req.json()
#     csat = body.get("csat")
#     if not isinstance(csat, int) or not 1 <= csat <= 5:
#         raise HTTPException(status_code=400, detail="csat deve essere un intero tra 1 e 5.")

#     ok = history.salva_feedback(log_id, current_user.utente_id, csat)
#     if not ok:
#         raise HTTPException(status_code=404, detail="Messaggio non trovato.")
#     return {"status": "ok", "csat": csat}


# @router.post("/search/reload")
# async def reload_search_service(
#     fastapi_req: Request,
#     current_user=Depends(get_current_user),
# ):
#     try:
#         search_service = fastapi_req.app.state.search_service
#         search_service.reload()
#         return {
#             "status":  "success",
#             "message": f"SearchService ricaricato: {len(search_service.available_titles)} titoli.",
#         }
#     except AttributeError:
#         raise HTTPException(
#             status_code=status.HTTP_501_NOT_IMPLEMENTED,
#             detail="search_service non disponibile."
#         )
#     except Exception as e:
#         logger.exception(f"Errore reload: {e}")
#         raise HTTPException(
#             status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#             detail=f"Errore durante il reload: {str(e)}"
#         )



# app/api/v1/chat.py
# FIX: link pagina canonico da anchor_link, dedup migliorato
# NEW:  salvataggio automatico sessioni su PostgreSQL tramite chat_history_service
# NEW:  ripristino contesto sessioni precedenti (lazy load dal DB nel chat_store)
import re
import time
import logging
from fastapi import APIRouter, HTTPException, Request, status, Depends
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage

from app.services.auth_service import get_current_user, require_permission
from app.services import chat_history_service as history

logger = logging.getLogger(__name__)
router = APIRouter(redirect_slashes=True)


class ChatRequest(BaseModel):
    question:   str
    session_id: str
    debug:      bool = False


def _normalize_page(raw) -> str:
    if raw is None:
        return ""
    s = str(raw).strip()
    if s in ("", "None", "null", "N/D", "n/d"):
        return ""
    s = s.lstrip("p").strip()
    return s if s.isdigit() else ""


def _extract_sources(source_docs) -> list:
    sources   = []
    seen_keys = set()

    for d in source_docs:
        title      = d.metadata.get("titolo_documento", "N/D")
        link       = d.metadata.get("anchor_link", "")
        breadcrumb = d.metadata.get("breadcrumb", "Generale")

        page = ""
        if link:
            m = re.search(r'#page=(\d+)', link)
            if m:
                page = m.group(1)

        if not page:
            page = _normalize_page(d.metadata.get("pagina", ""))

        key = (title, page) if page else (title, breadcrumb)
        if key not in seen_keys:
            seen_keys.add(key)
            sources.append({
                "title":      title,
                "page":       page,
                "link":       link,
                "breadcrumb": breadcrumb,
            })

    return sources


def _detect_tipo_risposta(response) -> str:
    """Inferisce il tipo di risposta dal contenuto."""
    content = str(response.content)
    source_docs = getattr(response, "source_docs", [])

    _NOT_FOUND = "Non ho trovato informazioni pertinenti"
    _BLOCKED   = "non posso rispondere a questa richiesta"

    if _BLOCKED.lower() in content.lower():
        return "blocked"
    if _NOT_FOUND in content:
        return "not_found"
    if not source_docs:
        return "courtesy"
    return "content"


# ─────────────────────────────────────────────
# HELPER: ripristino sessione dal DB (lazy)
# ─────────────────────────────────────────────

def _ensure_session_loaded(
    store: dict,
    session_id: str,
    utente_id: int,
) -> dict:
    """
    Garantisce che la sessione sia presente nel chat_store in-memory.

    Logica:
      1. Se la sessione è già in memoria → restituisce direttamente
         (zero accessi DB, zero latenza aggiuntiva per le sessioni attive)
      2. Se NON è in memoria → tenta il ripristino dal DB tramite
         load_session_context() e popola il chat_store
      3. Se il DB non la trova (sessione nuova) → restituisce stato vuoto

    Il risultato è sempre un dict con le chiavi "history" e "summary"
    pronto per essere passato al chain.

    Questo approccio è "lazy": non richiede nessun endpoint separato di
    "restore session" dal frontend. Il backend capisce da solo se è una
    sessione nuova o una da ripristinare.
    """
    # Caso 1: già in memoria, ritorno immediato
    if session_id in store:
        return store[session_id]

    # Caso 2: non in memoria → prova a caricare dal DB
    logger.info(f"[chat] sessione '{session_id}' non in memoria, caricamento dal DB...")
    ctx = history.load_session_context(session_uuid=session_id, utente_id=utente_id)

    if ctx["found"]:
        session_state = {
            "history": ctx["history"],
            "summary": ctx["summary"],
        }
        store[session_id] = session_state
        logger.info(
            f"[chat] sessione '{session_id}' ripristinata: "
            f"{len(ctx['history'])//2} messaggi recenti + summary "
            f"({'sì' if ctx['summary'] else 'no'})"
        )
        return session_state

    # Caso 3: sessione nuova o non trovata → stato vuoto
    empty_state = {"history": [], "summary": ""}
    store[session_id] = empty_state
    return empty_state


@router.post("/chat")
async def chat_endpoint(
    request: ChatRequest,
    fastapi_req: Request,
    current_user=Depends(get_current_user),
):
    try:
        chain = fastapi_req.app.state.rag_chain
        store = fastapi_req.app.state.chat_store

        if not request.question.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La domanda non può essere vuota."
            )

        # ── Ripristino sessione (lazy, zero-cost se già in memoria) ──
        session = _ensure_session_loaded(
            store      = store,
            session_id = request.session_id,
            utente_id  = current_user.utente_id,
        )
        history_msgs = session["history"]
        summary      = session["summary"]

        # ── Invocazione chain con misurazione latenza ──────────
        t0 = time.time()
        response = chain.invoke({
            "question":             request.question,
            "history":              history_msgs,
            "conversation_summary": summary,
        })
        elapsed_ms = int((time.time() - t0) * 1000)

        if not hasattr(response, "content"):
            logger.error(f"chain.invoke tipo inatteso: {type(response)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Errore interno: risposta malformata dal chain."
            )

        # ── Aggiorna lo stato in-memory ────────────────────────
        new_summary = getattr(response, "conversation_summary", summary)
        store[request.session_id] = {
            "history": history_msgs + [
                HumanMessage(content=request.question),
                AIMessage(content=str(response.content)),
            ],
            "summary": new_summary,
        }

        sources = _extract_sources(response.source_docs)

        # ── Salvataggio persistente (fire-and-forget) ──────────
        tipo = _detect_tipo_risposta(response)
        ip   = fastapi_req.client.host if fastapi_req.client else None
        ua   = fastapi_req.headers.get("user-agent")

        log_id = history.salva_messaggio(
            session_uuid  = request.session_id,
            utente_id     = current_user.utente_id,
            domanda       = request.question,
            risposta      = str(response.content),
            source_docs   = response.source_docs,
            tempo_ms      = elapsed_ms,
            tipo_risposta = tipo,
            bloccato      = (tipo == "blocked"),
            ip_address    = ip,
            user_agent    = ua,
        )

        resp = {
            "answer":     response.content,
            "sources":    sources,
            "session_id": request.session_id,
            "log_id":     log_id,
        }

        if request.debug and hasattr(response, "build_retrieval_debug"):
            resp["retrieval_debug"] = response.build_retrieval_debug()
        elif request.debug:
            resp["retrieval_debug"] = [
                {
                    "chunk_idx":   i + 1,
                    "titolo":      d.metadata.get("titolo_documento", "N/D"),
                    "pagina":      _normalize_page(d.metadata.get("pagina", "")),
                    "anchor_link": d.metadata.get("anchor_link", ""),
                    "breadcrumb":  d.metadata.get("breadcrumb", ""),
                    "preview":     d.page_content[:200],
                }
                for i, d in enumerate(response.source_docs)
            ]

        return resp

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Errore in chat_endpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Si è verificato un errore interno. Riprova tra qualche istante."
        )


@router.post("/chat/reset")
async def reset_chat(
    request: ChatRequest,
    fastapi_req: Request,
    current_user=Depends(get_current_user),
):
    store      = fastapi_req.app.state.chat_store
    session_id = request.session_id
    if session_id in store:
        del store[session_id]
        return {"status": "success", "message": f"Sessione {session_id} resettata."}
    return {"status": "info", "message": "Nessuna cronologia attiva."}


# ─────────────────────────────────────────────
# ENDPOINT: pre-carica una sessione (opzionale)
# ─────────────────────────────────────────────

@router.post("/chat/restore/{session_uuid}")
async def restore_session(
    session_uuid: str,
    fastapi_req: Request,
    current_user=Depends(get_current_user),
):
    """
    Pre-carica una sessione precedente nel chat_store in-memory.

    Questo endpoint è OPZIONALE: il backend ripristina le sessioni
    automaticamente (lazy) al primo messaggio. Usalo dal frontend se
    vuoi pre-riscaldare la sessione prima che l'utente scriva
    (es. al click sulla sessione nella sidebar), per eliminare la
    latenza del caricamento DB alla prima domanda.

    Returns:
        {
            "restored":   bool,   # True se la sessione era nel DB
            "n_messages": int,    # numero totale di messaggi caricati
            "has_summary": bool,  # True se c'è un summary per i messaggi vecchi
        }
    """
    store = fastapi_req.app.state.chat_store

    # Forza il reload anche se già in memoria (utile dopo restart server)
    ctx = history.load_session_context(
        session_uuid = session_uuid,
        utente_id    = current_user.utente_id,
    )

    if ctx["found"]:
        store[session_uuid] = {
            "history": ctx["history"],
            "summary": ctx["summary"],
        }

    return {
        "restored":    ctx["found"],
        "n_messages":  ctx["n_total"],
        "has_summary": bool(ctx["summary"]),
    }


# ─────────────────────────────────────────────
# ENDPOINT: storico sessioni utente (per sidebar)
# ─────────────────────────────────────────────

@router.get("/chat/sessions")
async def get_my_sessions(
    limit: int = 20,
    include_archived: bool = False,
    current_user=Depends(require_permission("chat_history_view")),
):
    """
    Restituisce le ultime N sessioni dell'utente autenticato.
    Usato dalla sidebar per mostrare la cronologia delle conversazioni.
    """
    sessioni = history.get_sessioni_utente(
        utente_id         = current_user.utente_id,
        limit             = min(limit, 50),
        include_archiviate = include_archived,
    )
    return {"sessions": sessioni}


@router.get("/chat/sessions/{session_uuid}")
async def get_session_detail(
    session_uuid: str,
    current_user=Depends(require_permission("chat_history_view")),
):
    """
    Restituisce i messaggi di una sessione specifica dell'utente.
    Un utente normale può accedere solo alle proprie sessioni.
    """
    detail = history.get_messaggi_sessione(
        session_uuid          = session_uuid,
        utente_id_richiedente = current_user.utente_id,
        is_admin              = False,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Sessione non trovata.")
    return detail


@router.delete("/chat/sessions/{session_uuid}")
async def archive_session(
    session_uuid: str,
    fastapi_req: Request,
    current_user=Depends(require_permission("chat_history_view")),
):
    """
    Archivia (soft delete) una sessione dell'utente.
    La sessione non compare più nella sidebar ma rimane per l'audit admin.
    Rimuove anche la sessione dal chat_store in-memory.
    """
    store = fastapi_req.app.state.chat_store

    ok = history.archivia_sessione(session_uuid, current_user.utente_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Sessione non trovata.")

    # Rimuovi dalla memoria in-memory così non viene più servita
    store.pop(session_uuid, None)

    return {"status": "archived"}


@router.post("/chat/sessions/{log_id}/feedback")
async def submit_feedback(
    log_id: int,
    fastapi_req: Request,
    current_user=Depends(require_permission("chat_history_view")),
):
    """
    Salva il feedback CSAT (1-5 stelle) su un singolo messaggio.
    """
    body = await fastapi_req.json()
    csat = body.get("csat")
    if not isinstance(csat, int) or not 1 <= csat <= 5:
        raise HTTPException(status_code=400, detail="csat deve essere un intero tra 1 e 5.")

    ok = history.salva_feedback(log_id, current_user.utente_id, csat)
    if not ok:
        raise HTTPException(status_code=404, detail="Messaggio non trovato.")
    return {"status": "ok", "csat": csat}


@router.post("/search/reload")
async def reload_search_service(
    fastapi_req: Request,
    current_user=Depends(get_current_user),
):
    try:
        search_service = fastapi_req.app.state.search_service
        search_service.reload()
        return {
            "status":  "success",
            "message": f"SearchService ricaricato: {len(search_service.available_titles)} titoli.",
        }
    except AttributeError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="search_service non disponibile."
        )
    except Exception as e:
        logger.exception(f"Errore reload: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Errore durante il reload: {str(e)}"
        )
