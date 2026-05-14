# # main.py
# import os
# import logging
# from dotenv import load_dotenv
# from fastapi import FastAPI
# from fastapi.middleware.cors import CORSMiddleware
# from fastapi.staticfiles import StaticFiles

# from app.api.v1.chat  import router as chat_router
# from app.api.v1.admin import router as admin_router
# from app.api.v1.auth  import router as auth_router          

# from app.services.AI_Services import AIService
# from app.services.Search_Service_langchain2 import SearchService
# from app.core.rag_chain_langgraph import create_rag_chain
# from langchain_mistralai import ChatMistralAI
# from app.services.admin_search_service import AdminSearchService

# load_dotenv()
# logging.basicConfig(level=logging.DEBUG)
# logging.getLogger("app.services.admin_search_service").setLevel(logging.DEBUG)
# logger = logging.getLogger(__name__)

# app = FastAPI(title="Exprivia AI Backend")

# # --- CARTELLE ---
# for folder in ["static", "data"]:
#     os.makedirs(folder, exist_ok=True)

# # --- STATIC ---
# STATIC_DIR = os.getenv("STATIC_DIR", "static")
# app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# origins = [
#     "http://localhost:5173",
#     "https://localhost:5173",      # ← AGGIUNGI
#     "http://127.0.0.1:5173",
#     "https://127.0.0.1:5173",
#     "https://mprlv9br-5173.euw.devtunnels.ms" ,#frontend in devtunnel
#     "https://mprlv9br-8080.euw.devtunnels.ms/", #backend in devtunnel
# ]
# # --- CORS ---
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=origins,
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
#     expose_headers=["Set-Cookie"],# necessario per far funzionare i cookie HttpOnly cross-origin
# )

# # --- SERVIZI BASE ---
# ai_base              = AIService()
# search_service       = SearchService(ai_base)
# admin_search_service = AdminSearchService()
# logger.info(f"SearchService pronto: {len(search_service.available_titles)} titoli")
# logger.info(f"AdminSearchService pronto: {len(admin_search_service.indexed_stems)} documenti indicizzati")

# # --- LLM ---
# llm = ChatMistralAI(
#     model="mistral-small-latest",
#     mistral_api_key=os.getenv("MISTRAL_API_KEY"),
#     temperature=0,
#     max_tokens=2048,
# )

# # --- CHAIN LANGGRAPH ---
# rag_chain = create_rag_chain(
#     llm,
#     search_service,
#     available_titles=search_service.available_titles,
# )
# logger.info("RAG chain LangGraph pronta")

# # --- STATO APP ---
# app.state.rag_chain           = rag_chain
# app.state.chat_store          = {}
# app.state.search_service      = search_service
# app.state.admin_search_service = admin_search_service

# # --- ROUTER ---
# # Auth deve stare prima degli altri così /api/v1/auth/* è raggiungibile
# app.include_router(auth_router)                        # ← NUOVO: /api/v1/auth/*
# app.include_router(chat_router,  prefix="/api/v1")     # /api/v1/chat
# app.include_router(admin_router)                       # /api/v1/admin/*


# @app.get("/")
# async def health_check():
#     return {
#         "status":   "online",
#         "model":    "mistral-small-latest",
#         "services": "active",
#     }


# if __name__ == "__main__":
#     import uvicorn
#     uvicorn.run(app, host="0.0.0.0", port=8080)





# main.py
import os
import logging
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.chat  import router as chat_router
from app.api.v1.admin import router as admin_router
from app.api.v1.auth  import router as auth_router

from app.core.db_config import ACTIVE_CONFIG          # ← NUOVO
from app.services.AI_Services import AIService
from app.services.Search_Service_langchain2 import SearchService
from app.core.rag_chain_langgraph import create_rag_chain
from langchain_mistralai import ChatMistralAI
from app.services.admin_search_service import AdminSearchService

load_dotenv()
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("app.services.admin_search_service").setLevel(logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI(title="Exprivia AI Backend")

# ── Log pipeline attiva ────────────────────────────────────────
logger.info(f"🔧 Pipeline attiva : {ACTIVE_CONFIG.pipeline.upper()}")
logger.info(f"🐘 PostgreSQL      : {ACTIVE_CONFIG.database_url}")
logger.info(f"🟣 ChromaDB        : {ACTIVE_CONFIG.chroma_host}:{ACTIVE_CONFIG.chroma_port}")
logger.info(f"📚 Collection      : {ACTIVE_CONFIG.chroma_collection_name}")

# ── Cartelle ──────────────────────────────────────────────────
for folder in ["static", "data"]:
    os.makedirs(folder, exist_ok=True)

STATIC_DIR = os.getenv("STATIC_DIR", "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

origins = [
    "http://localhost:5173",
    "https://localhost:5173",
    "http://127.0.0.1:5173",
    "https://127.0.0.1:5173",
    "https://mprlv9br-5173.euw.devtunnels.ms",
    "https://mprlv9br-8080.euw.devtunnels.ms/",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Set-Cookie"],
)

# ── Servizi — usano ACTIVE_CONFIG per connettersi al DB giusto ─
import chromadb as _chromadb

_chroma_client = _chromadb.HttpClient(
    host=ACTIVE_CONFIG.chroma_host,
    port=ACTIVE_CONFIG.chroma_port,
)

ai_base              = AIService()
search_service       = SearchService(ai_base)          # legge ACTIVE_CONFIG internamente
admin_search_service = AdminSearchService()            # legge ACTIVE_CONFIG internamente

logger.info(f"SearchService pronto: {len(search_service.available_titles)} titoli")
logger.info(f"AdminSearchService pronto: {len(admin_search_service.indexed_stems)} documenti")

# ── LLM ───────────────────────────────────────────────────────
llm = ChatMistralAI(
    model="mistral-small-latest",
    mistral_api_key=os.getenv("MISTRAL_API_KEY"),
    temperature=0,
    max_tokens=2048,
)

rag_chain = create_rag_chain(
    llm,
    search_service,
    available_titles=search_service.available_titles,
)
logger.info("RAG chain LangGraph pronta")

# ── Stato app ─────────────────────────────────────────────────
app.state.rag_chain            = rag_chain
app.state.chat_store           = {}
app.state.search_service       = search_service
app.state.admin_search_service = admin_search_service
app.state.active_pipeline      = ACTIVE_CONFIG.pipeline   # usato da admin.py

# ── Router ────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(chat_router,  prefix="/api/v1")
app.include_router(admin_router)


@app.get("/")
async def health_check():
    return {
        "status":   "online",
        "pipeline": ACTIVE_CONFIG.pipeline,
        "model":    "mistral-small-latest",
        "services": "active",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)