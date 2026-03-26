# # main.py
# import os
# from fastapi import FastAPI
# from fastapi.middleware.cors import CORSMiddleware
# from app.api.v1.chat import router as chat_router
# from app.services.AI_Services import AIService
# from app.services.Search_Service_langchain2 import SearchService
# #from app.core.rag_chain import create_rag_chain
# from app.core.rag_chain_langgraph import create_rag_chain

# # LangChain imports
# from langchain_ollama import ChatOllama
# from langchain_community.document_compressors.flashrank_rerank import FlashrankRerank
# from langchain_core.runnables.history import RunnableWithMessageHistory
# from langchain_core.chat_history import InMemoryChatMessageHistory
# from langchain_classic.retrievers.contextual_compression import ContextualCompressionRetriever

# from fastapi.staticfiles import StaticFiles

# app = FastAPI(title="Exprivia AI Backend")

# # --- 0. CONFIGURAZIONE CARTELLE ---
# for folder in ["static", "data"]:
#     if not os.path.exists(folder):
#         os.makedirs(folder)

# app.mount("/static", StaticFiles(directory=r"C:\\Users\\PC_A26\\Desktop\\programmi\\TirocinioAI\\backend\\static"), name="static")

# # --- 1. CONFIGURAZIONE CORS ---
# # Permette al frontend (es. React su porta 5173) di comunicare con il backend
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"], # In produzione, specifica l'URL del frontend
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )
 
# # --- 2. INIZIALIZZAZIONE SERVIZI E MODELLI ---
# ai_base = AIService() # Inizializza embedding e connessioni base
# search_service = SearchService(ai_base) # Servizio di ricerca su ChromaDB

# # Modello LLM (Gemma 3)
# # llm = ChatOllama(
# #     model="gemma3:4b", 
# #     temperature=0.0, 
# #     num_ctx=8192 # Finestra di contesto ampia per gestire documenti lunghi
# # )

# llm = ChatOllama(
#     model="gemma3:4b",
#     temperature=0.0,       # Massima precisione
#     num_ctx=4096,          # Memoria sufficiente
#     repeat_penalty=1.05,   # Leggermente ridotto per non penalizzare i termini tecnici
#     num_predict=1024,      # Più spazio per i confronti dettagliati
#     top_k=20,              # Limita la scelta alle parole più probabili (aumenta coerenza)
#     top_p=0.9              # Filtra le parole meno probabili
# )
# # --- 3. SETUP DEL RETRIEVER PROFESSIONALE (Reranking) ---
# compressor = FlashrankRerank(model="ms-marco-MultiBERT-L-12", top_n=3)
# base_retriever = search_service.as_langchain_retriever(k=15)
# # Il Reranker riordina i 10 risultati di ChromaDB e prende i migliori 5

# compression_retriever = ContextualCompressionRetriever(
#     base_compressor=compressor, 
#     base_retriever=base_retriever
# )

# # --- 4. GESTIONE MEMORIA E STORIA CHAT ---
# store = {} # Dizionario globale che tiene in RAM le chat di tutti gli utenti

# def get_session_history(session_id: str):
#     if session_id not in store:
#         store[session_id] = InMemoryChatMessageHistory()
#     return store[session_id]

# # Creazione della catena RAG base (definita in app/core/rag_chain.py)
# base_chain = create_rag_chain(llm, compression_retriever)

# # Catena finale con "memoria" integrata
# chain_with_history = RunnableWithMessageHistory(
#     base_chain,
#     get_session_history,
#     input_messages_key="question",
#     history_messages_key="history",
# )

# # --- 5. REGISTRAZIONE NELLO STATO DELL'APP ---
# # Questi oggetti vengono "appesi" ad app per essere usati negli endpoint in app/api/
# app.state.chain_with_history = chain_with_history
# app.state.compression_retriever = compression_retriever
# app.state.chat_store = store 

# # --- 6. INCLUSIONE ROTTE E TEST ---
# app.include_router(chat_router, prefix="/api/v1")

# @app.get("/")
# async def health_check():
#     return {
#         "status": "online",
#         "model": "gemma3:4b",
#         "services": "active"
#     }

# if __name__ == "__main__":
#     import uvicorn
#     uvicorn.run(app, host="0.0.0.0", port=8080)



# main.py
# main.py
import os
import logging
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.chat import router as chat_router
from app.api.v1.admin import router as admin_router
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

# --- CARTELLE ---
for folder in ["static", "data"]:
    os.makedirs(folder, exist_ok=True)

# --- STATIC ---
STATIC_DIR = os.getenv("STATIC_DIR", "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# --- CORS ---
# In produzione sostituisci "*" con l'URL esatto del frontend,
# es: allow_origins=["https://app.exprivia.com"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SERVIZI BASE ---
# AIService usa OllamaEmbeddings: deve restare Ollama perché i documenti
# sono già indicizzati con quei vettori. Cambiarli = reindicizzare tutto.
ai_base        = AIService()
search_service = SearchService(ai_base)
admin_search_service = AdminSearchService()
logger.info(f"SearchService pronto: {len(search_service.available_titles)} titoli")
logger.info(f"AdminSearchService pronto: {len(admin_search_service.indexed_stems)} documenti indicizzati")

# --- LLM ---
# Ollama rimane attivo solo per gli embedding (AIService sopra).
# Mistral API gestisce tutta la generazione.
llm = ChatMistralAI(
    model="mistral-small-latest",
    mistral_api_key=os.getenv("MISTRAL_API_KEY"),
    temperature=0,
    max_tokens=2048,
)

# --- CHAIN LANGGRAPH ---
# search_service viene passato direttamente (non il retriever compilato):
# il routing_agent costruisce un retriever filtrato per documento a runtime.
rag_chain = create_rag_chain(
    llm,
    search_service,
    available_titles=search_service.available_titles,
)
logger.info("RAG chain LangGraph pronta")

# --- STATO APP ---
# chat_store: { session_id: [HumanMessage, AIMessage, ...] }
app.state.rag_chain      = rag_chain
app.state.chat_store     = {}
app.state.search_service = search_service  # necessario per /search/reload
app.state.admin_search_service  = admin_search_service

# --- ROUTER ---
app.include_router(chat_router, prefix="/api/v1")
app.include_router(admin_router)

@app.get("/")
async def health_check():
    return {
        "status":   "online",
        "model":    "mistral-small-latest",
        "services": "active",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)