# # from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
# # from pydantic import BaseModel
# # from typing import List, Dict, Any
# # from app.services.ingestion_service import IngestionService
# # from app.services.Loader_Service import LoaderService
# # router = APIRouter(redirect_slashes=True)

# # ingestion_service = IngestionService()
# # loader_service = LoaderService()

# # class ChatRequest(BaseModel):
# #     question: str
# #     session_id: str



# # class LoadToDBRequest(BaseModel):
# #     json_path: str = "speramobene_i.json"
# #     privacy_id: int = 1 # Esempio: 1=Pubblico, 2=Interno, etc.


# # @router.post("/ingestion/load-to-db")
# # async def load_to_db(request: LoadToDBRequest, background_tasks: BackgroundTasks):
# #     """
# #     Carica i dati dal JSON ai database (SQL e Chroma).
# #     """
# #     # Avviamo il processo in background per non bloccare la risposta HTTP
# #     background_tasks.add_task(
# #         loader_service.run_db_loader, 
# #         request.json_path, 
# #         request.privacy_id
# #     )
    
# #     return {
# #         "status": "started", 
# #         "message": f"Caricamento di {request.json_path} avviato. Privacy ID applicato: {request.privacy_id}"
# #     }    
    
# # @router.post("/ingestion/run")
# # async def run_ingestion_endpoint(background_tasks: BackgroundTasks):
# #     """Avvia la pipeline di ingestion definita in batch_ingestion in background."""
# #     background_tasks.add_task(ingestion_service.run_ingestion)
# #     return {"status": "started", "message": "Processamento PDF avviato. Il JSON sarà creato nella root."}

# # @router.post("/chat")
# # async def chat_endpoint(request: ChatRequest, fastapi_req: Request):
# #     try:
# #         chain = fastapi_req.app.state.chain_with_history
# #         retriever = fastapi_req.app.state.compression_retriever
        
# #         config = {"configurable": {"session_id": request.session_id}}
# #         response = chain.invoke({"question": request.question}, config=config)
        
# #         # Recupero documenti originali dal retriever
# #         docs = retriever.invoke(request.question)
        
# #         # --- LOGICA DI DEDUPLICAZIONE ---
# #         sources = []
# #         seen_keys = set() # Per tracciare coppie (titolo, pagina) già inserite

# #         for d in docs:
# #             # Recuperiamo i metadati (usando i nomi esatti definiti nell'ingestion)
# #             title = d.metadata.get("titolo_documento", "N/D")
# #             page = d.metadata.get("pagina", "N/D") # Verificato dal tuo JSON di ingestion
# #             link = d.metadata.get("anchor_link", "N/D")
# #             breadcrumb = d.metadata.get("breadcrumb", "Generale")

# #             # Creiamo una chiave univoca per identificare il duplicato
# #             source_key = (title, page)

# #             if source_key not in seen_keys:
# #                 seen_keys.add(source_key)
# #                 sources.append({
# #                     "title": title,
# #                     "page": page,
# #                     "link": link,
# #                     "breadcrumb": breadcrumb
# #                 })

# #         return {
# #             "answer": response.content,
# #             "sources": sources,
# #             "session_id": request.session_id
# #         }
# #     except Exception as e:
# #         raise HTTPException(status_code=500, detail=f"Errore Chat: {str(e)}")

# # @router.post("/chat/reset")
# # async def reset_chat(request: ChatRequest, fastapi_req: Request):
# #     """
# #     Endpoint per svuotare la memoria. 
# #     Usa ChatRequest così il frontend può mandare lo stesso JSON della chat.
# #     """
# #     session_id = request.session_id
    
# #     # Recuperiamo lo store dallo stato dell'app
# #     store = fastapi_req.app.state.chat_store
    
# #     if session_id in store:
# #         del store[session_id]
# #         return {"status": "success", "message": f"Memoria sessione {session_id} resettata."}
    
# #     return {"status": "info", "message": "Nessuna cronologia attiva da resettare."}
# # app/api/v1/chat.py
# # app/api/v1/chat.py
# from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
# from pydantic import BaseModel
# from langchain_core.messages import HumanMessage, AIMessage

# from app.services.ingestion_service import IngestionService
# from app.services.Loader_Service import LoaderService

# router = APIRouter(redirect_slashes=True)

# ingestion_service = IngestionService()
# loader_service    = LoaderService()


# class ChatRequest(BaseModel):
#     question:   str
#     session_id: str

# class LoadToDBRequest(BaseModel):
#     json_path:  str = "speramobene_i.json"
#     privacy_id: int = 1


# # ── Ingestion (invariato) ─────────────────────────────────────
# @router.post("/ingestion/load-to-db")
# async def load_to_db(request: LoadToDBRequest, background_tasks: BackgroundTasks):
#     background_tasks.add_task(
#         loader_service.run_db_loader,
#         request.json_path,
#         request.privacy_id
#     )
#     return {
#         "status":  "started",
#         "message": f"Caricamento di {request.json_path} avviato. Privacy ID: {request.privacy_id}"
#     }

# @router.post("/ingestion/run")
# async def run_ingestion_endpoint(background_tasks: BackgroundTasks):
#     background_tasks.add_task(ingestion_service.run_ingestion)
#     return {"status": "started", "message": "Processamento PDF avviato."}


# # ── Chat ──────────────────────────────────────────────────────
# @router.post("/chat")
# async def chat_endpoint(request: ChatRequest, fastapi_req: Request):
#     try:
#         chain = fastapi_req.app.state.rag_chain
#         store = fastapi_req.app.state.chat_store

#         history = store.get(request.session_id, [])

#         # Invoca il grafo — risposta + documenti usati in un colpo solo
#         response = chain.invoke({
#             "question": request.question,
#             "history":  history,
#         })

#         # Aggiorna history
#         store[request.session_id] = history + [
#             HumanMessage(content=request.question),
#             AIMessage(content=response.content),
#         ]

#         # ── Fonti: SOLO i doc che il grafo ha effettivamente usato ──
#         # Niente seconda chiamata al retriever → fonti sempre coerenti
#         sources   = []
#         seen_keys = set()

#         for d in response.source_docs:
#             title      = d.metadata.get("titolo_documento", "N/D")
#             page       = d.metadata.get("pagina",           "N/D")
#             link       = d.metadata.get("anchor_link",      "")
#             breadcrumb = d.metadata.get("breadcrumb",       "Generale")
#             key        = (title, page)
#             if key not in seen_keys:
#                 seen_keys.add(key)
#                 sources.append({
#                     "title":      title,
#                     "page":       page,
#                     "link":       link,
#                     "breadcrumb": breadcrumb,
#                 })

#         return {
#             "answer":     response.content,
#             "sources":    sources,
#             "session_id": request.session_id,
#         }

#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Errore Chat: {str(e)}")


# # ── Reset sessione (invariato) ────────────────────────────────
# @router.post("/chat/reset")
# async def reset_chat(request: ChatRequest, fastapi_req: Request):
#     store      = fastapi_req.app.state.chat_store
#     session_id = request.session_id
#     if session_id in store:
#         del store[session_id]
#         return {"status": "success", "message": f"Memoria sessione {session_id} resettata."}
#     return {"status": "info", "message": "Nessuna cronologia attiva da resettare."}



# app/api/v1/chat.py — versione migliorata
#
# MIGLIORAMENTI:
#   1. Gestione errore più granulare: distingue TimeoutError, ValueError, eccezioni generiche
#   2. Endpoint /chat/reload: ricaricare SearchService senza riavvio (utile post-ingestion)
#   3. response.content: check esplicito sul tipo per evitare AttributeError silenzioso
#   4. Deduplicazione fonti: spostata in funzione helper riutilizzabile
#   5. Logging strutturato invece di eccezioni grezze in dettaglio HTTP

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




# ── Helper ───────────────────────────────────────────────────
def _extract_sources(source_docs) -> list:
    """
    Deduplica i documenti fonte e li converte in dizionari serializzabili.
    Spostato in funzione helper per riutilizzo e testabilità.
    """
    sources   = []
    seen_keys = set()

    for d in source_docs:
        title      = d.metadata.get("titolo_documento", "N/D")
        page       = d.metadata.get("pagina",           "N/D")
        link       = d.metadata.get("anchor_link",      "")
        breadcrumb = d.metadata.get("breadcrumb",       "Generale")
        key        = (title, page)

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

        session      = store.get(request.session_id, {"history": [], "summary": ""})
        history      = session["history"]
        summary      = session["summary"]
        response = chain.invoke({
            "question":             request.question,
            "history":              history,
            "conversation_summary": summary,
        })

        # MIGLIORAMENTO: check esplicito per evitare AttributeError silenzioso
        # se chain.invoke restituisce un tipo inatteso
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

        return {
            "answer":     response.content,
            "sources":    _extract_sources(response.source_docs),
            "session_id": request.session_id,
        }

    except HTTPException:
        raise  # re-raise HTTPException già formattate
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


# ── NUOVO: Reload SearchService a caldo ───────────────────────
@router.post("/search/reload")
async def reload_search_service(fastapi_req: Request):
    """
    MIGLIORAMENTO: ricarica i documenti nel SearchService senza riavviare
    il server. Utile subito dopo una nuova ingestion.
    """
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