# import logging
# from fastapi import APIRouter, HTTPException, Request, BackgroundTasks, status
# from pydantic import BaseModel
# from langchain_core.messages import HumanMessage, AIMessage

# logger = logging.getLogger(__name__)
# router = APIRouter(redirect_slashes=True)


# # ── Modelli ──────────────────────────────────────────────────
# class ChatRequest(BaseModel):
#     question:   str
#     session_id: str




# # ── Helper ───────────────────────────────────────────────────
# def _extract_sources(source_docs) -> list:
#     """
#     Deduplica i documenti fonte e li converte in dizionari serializzabili.
#     Spostato in funzione helper per riutilizzo e testabilità.
#     """
#     sources   = []
#     seen_keys = set()

#     for d in source_docs:
#         title      = d.metadata.get("titolo_documento", "N/D")
#         page       = d.metadata.get("pagina",           "N/D")
#         link       = d.metadata.get("anchor_link",      "")
#         breadcrumb = d.metadata.get("breadcrumb",       "Generale")
#         key        = (title, page)

#         if key not in seen_keys:
#             seen_keys.add(key)
#             sources.append({
#                 "title":      title,
#                 "page":       page,
#                 "link":       link,
#                 "breadcrumb": breadcrumb,
#             })

#     return sources





# # ── Chat ──────────────────────────────────────────────────────
# @router.post("/chat")
# async def chat_endpoint(request: ChatRequest, fastapi_req: Request):
#     try:
#         chain = fastapi_req.app.state.rag_chain
#         store = fastapi_req.app.state.chat_store

#         if not request.question.strip():
#             raise HTTPException(
#                 status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
#                 detail="La domanda non può essere vuota."
#             )

#         session      = store.get(request.session_id, {"history": [], "summary": ""})
#         history      = session["history"]
#         summary      = session["summary"]
#         response = chain.invoke({
#             "question":             request.question,
#             "history":              history,
#             "conversation_summary": summary,
#         })

#         # MIGLIORAMENTO: check esplicito per evitare AttributeError silenzioso
#         # se chain.invoke restituisce un tipo inatteso
#         if not hasattr(response, "content"):
#             logger.error(f"chain.invoke ha restituito un tipo inatteso: {type(response)}")
#             raise HTTPException(
#                 status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#                 detail="Errore interno: risposta malformata dal chain."
#             )

#         # Aggiorna history e summary nella sessione
#         store[request.session_id] = {
#             "history": history + [
#                 HumanMessage(content=request.question),
#                 AIMessage(content=str(response.content)),
#             ],
#             "summary": getattr(response, "conversation_summary", summary),
#         }

#         return {
#             "answer":     response.content,
#             "sources":    _extract_sources(response.source_docs),
#             "session_id": request.session_id,
#         }

#     except HTTPException:
#         raise  # re-raise HTTPException già formattate
#     except Exception as e:
#         logger.exception(f"Errore inatteso in chat_endpoint: {e}")
#         raise HTTPException(
#             status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#             detail="Si è verificato un errore interno. Riprova tra qualche istante."
#         )


# # ── Reset sessione ────────────────────────────────────────────
# @router.post("/chat/reset")
# async def reset_chat(request: ChatRequest, fastapi_req: Request):
#     store      = fastapi_req.app.state.chat_store
#     session_id = request.session_id
#     if session_id in store:
#         del store[session_id]
#         return {"status": "success", "message": f"Memoria sessione {session_id} resettata (history + summary)."}
#     return {"status": "info", "message": "Nessuna cronologia attiva da resettare."}


# # ── NUOVO: Reload SearchService a caldo ───────────────────────
# @router.post("/search/reload")
# async def reload_search_service(fastapi_req: Request):
#     """
#     MIGLIORAMENTO: ricarica i documenti nel SearchService senza riavviare
#     il server. Utile subito dopo una nuova ingestion.
#     """
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
#             detail="search_service non disponibile nello stato dell'applicazione."
#         )
#     except Exception as e:
#         logger.exception(f"Errore reload SearchService: {e}")
#         raise HTTPException(
#             status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#             detail=f"Errore durante il reload: {str(e)}"
#         )

# app/api/v1/chat.py — v2 (stable-page-refs + retrieval debug)
#
# MODIFICHE:
#   1. _extract_sources() usa i metadati dei Document originali
#      → la pagina viene dai metadata ChromaDB, non dall'output LLM.
#      Questo è il fix principale per l'incoerenza del numero di pagina.
#   2. La risposta /chat include ora `retrieval_debug`: lista dei chunk
#      recuperati con titolo, pagina, breadcrumb e preview del testo.
#      Il frontend può usarla per il pannello di debug.
#   3. Aggiunta query param `?debug=true` per attivare/disattivare il debug.

import logging
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks, status
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage

logger = logging.getLogger(__name__)
router = APIRouter(redirect_slashes=True)


# ── Modelli ──────────────────────────────────────────────────
class ChatRequest(BaseModel):
    question:   str
    session_id: str
    debug:      bool = False  # se True, include retrieval_debug nella risposta


# ── Helper ───────────────────────────────────────────────────
def _normalize_page(raw) -> str:
    """
    Normalizza il numero di pagina da qualsiasi formato presente nei metadata.
    Restituisce stringa vuota se non trovato o non valido.
    """
    if raw is None:
        return ""
    s = str(raw).strip()
    if s in ("", "None", "null", "N/D", "n/d"):
        return ""
    # Accetta solo valori numerici (rimuove eventuale "p." prefix)
    s = s.lstrip("p").strip()
    return s if s.isdigit() else ""


def _extract_sources(source_docs) -> list:
    """
    Costruisce le fonti dai metadati originali dei Document recuperati dal retriever.
    La pagina viene SEMPRE dai metadata ChromaDB, mai dall'output LLM.
    Deduplica per (titolo, pagina).
    """
    sources   = []
    seen_keys = set()

    for d in source_docs:
        title      = d.metadata.get("titolo_documento", "N/D")
        page_raw   = d.metadata.get("pagina", "")
        page       = _normalize_page(page_raw)
        link       = d.metadata.get("anchor_link", "")
        breadcrumb = d.metadata.get("breadcrumb", "Generale")

        # Se anchor_link contiene già un numero di pagina e la pagina metadata è vuota,
        # prova ad estrarlo dal link (es. "/static/DOC.pdf#page=5")
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
async def chat_endpoint(request: ChatRequest, fastapi_req: Request):
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
            logger.error(f"chain.invoke ha restituito un tipo inatteso: {type(response)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Errore interno: risposta malformata dal chain."
            )

        # Aggiorna history e summary nella sessione
        store[request.session_id] = {
            "history": history + [
                HumanMessage(content=request.question),
                AIMessage(content=str(response.content)),
            ],
            "summary": getattr(response, "conversation_summary", summary),
        }

        # Fonti stabili dai metadata originali
        sources = _extract_sources(response.source_docs)

        resp = {
            "answer":     response.content,
            "sources":    sources,
            "session_id": request.session_id,
        }

        # Debug: chunk recuperati con pagina dai metadati originali
        if request.debug and hasattr(response, "build_retrieval_debug"):
            resp["retrieval_debug"] = response.build_retrieval_debug()
        elif request.debug:
            # Fallback se FakeAIMessage non ha il metodo (versione vecchia)
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
        logger.exception(f"Errore inatteso in chat_endpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Si è verificato un errore interno. Riprova tra qualche istante."
        )


# ── Reset sessione ────────────────────────────────────────────
@router.post("/chat/reset")
async def reset_chat(request: ChatRequest, fastapi_req: Request):
    store      = fastapi_req.app.state.chat_store
    session_id = request.session_id
    if session_id in store:
        del store[session_id]
        return {"status": "success", "message": f"Memoria sessione {session_id} resettata (history + summary)."}
    return {"status": "info", "message": "Nessuna cronologia attiva da resettare."}


# ── Reload SearchService a caldo ───────────────────────────────
@router.post("/search/reload")
async def reload_search_service(fastapi_req: Request):
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
            detail="search_service non disponibile nello stato dell'applicazione."
        )
    except Exception as e:
        logger.exception(f"Errore reload SearchService: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Errore durante il reload: {str(e)}"
        )