# app/api/v1/chat.py
import logging
from fastapi import APIRouter, HTTPException, Request, status, Depends
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage

from app.services.auth_service import get_current_user   # ← NUOVO

logger = logging.getLogger(__name__)
router = APIRouter(redirect_slashes=True)


# ── Modelli ──────────────────────────────────────────────────
class ChatRequest(BaseModel):
    question:   str
    session_id: str
    debug:      bool = False


# ── Helper ───────────────────────────────────────────────────
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
        page_raw   = d.metadata.get("pagina", "")
        page       = _normalize_page(page_raw)
        link       = d.metadata.get("anchor_link", "")
        breadcrumb = d.metadata.get("breadcrumb", "Generale")

        if not page and link:
            import re
            m = re.search(r'#page=(\d+)', link)
            if m:
                page = m.group(1)

        key = (title, page)
        if key not in seen_keys:
            seen_keys.add(key)
            sources.append({
                "title":      title,
                "page":       page,
                "link":       link,
                "breadcrumb": breadcrumb,
            })

    return sources


# ── Chat ──────────────────────────────────────────────────────
@router.post("/chat")
async def chat_endpoint(
    request: ChatRequest,
    fastapi_req: Request,
    current_user=Depends(get_current_user),   # ← NUOVO: richiede token valido
):
    try:
        chain = fastapi_req.app.state.rag_chain
        store = fastapi_req.app.state.chat_store

        if not request.question.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La domanda non può essere vuota."
            )

        session = store.get(request.session_id, {"history": [], "summary": ""})
        history = session["history"]
        summary = session["summary"]

        response = chain.invoke({
            "question":             request.question,
            "history":              history,
            "conversation_summary": summary,
        })

        if not hasattr(response, "content"):
            logger.error(f"chain.invoke tipo inatteso: {type(response)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Errore interno: risposta malformata dal chain."
            )

        store[request.session_id] = {
            "history": history + [
                HumanMessage(content=request.question),
                AIMessage(content=str(response.content)),
            ],
            "summary": getattr(response, "conversation_summary", summary),
        }

        sources = _extract_sources(response.source_docs)

        resp = {
            "answer":     response.content,
            "sources":    sources,
            "session_id": request.session_id,
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


# ── Reset sessione ────────────────────────────────────────────
@router.post("/chat/reset")
async def reset_chat(
    request: ChatRequest,
    fastapi_req: Request,
    current_user=Depends(get_current_user),   # ← NUOVO
):
    store      = fastapi_req.app.state.chat_store
    session_id = request.session_id
    if session_id in store:
        del store[session_id]
        return {"status": "success", "message": f"Sessione {session_id} resettata."}
    return {"status": "info", "message": "Nessuna cronologia attiva."}


# ── Reload SearchService ──────────────────────────────────────
@router.post("/search/reload")
async def reload_search_service(
    fastapi_req: Request,
    current_user=Depends(get_current_user),   # ← NUOVO
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
