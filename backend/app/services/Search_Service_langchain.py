import os
import chromadb
from dotenv import load_dotenv
from langchain_chroma import Chroma

# Importiamo la classe AIService dal file AI_Services.py
# Ora SearchService sa esattamente con che tipo di oggetto sta parlando

from app.services.AI_Services import AIService

load_dotenv()

class SearchService:
    def __init__(self, ai_service: AIService):
    
        self.ai = ai_service
        
        # Connessione al container ChromaDB tramite HTTP
        self.chroma_client = chromadb.HttpClient(
            host=os.getenv("CHROMA_HOST", "localhost"), 
            port=int(os.getenv("CHROMA_PORT", 8000))
        )
        
        # Recupero o creazione della collezione
        coll_name = os.getenv("CHROMA_COLLECTION_NAME", "default_collection")
        self.collection = self.chroma_client.get_or_create_collection(name=coll_name)
        
        print(f"Connesso con successo alla collezione ChromaDB: {coll_name}")

    def as_langchain_retriever(self,k=15):
        
        #Trasforma la connessione Chroma in un retriever LangChain standard.
        #Utile per catene RAG, Reranking e integrazioni avanzate.
        
        vectorstore = Chroma(
            client=self.chroma_client,
            collection_name=self.collection.name,
            embedding_function=self.ai,
        )
        
        # Restituiamo il retriever configurato per recuperare 'k' documenti
        return vectorstore.as_retriever(search_kwargs={"k": k})
