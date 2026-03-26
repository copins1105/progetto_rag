import chromadb
# Rimosse le importazioni SQL non più necessarie per la ricerca semantica

import os
import chromadb
from dotenv import load_dotenv

# Carichiamo le variabili d'ambiente come in session.py
load_dotenv()

class SearchService:
    def __init__(self, ai_service):
        self.ai = ai_service
        
        # Connessione al container
        self.chroma_client = chromadb.HttpClient(host='localhost', port=8000)
        
        # LEGGIAMO IL NOME DINAMICAMENTE
        # Se la variabile non esiste nel .env, usa 'default_collection' come backup
        coll_name = os.getenv("CHROMA_COLLECTION_NAME", "default_collection")
        
        # Crea o recupera la collezione con il nome scelto
        self.collection = self.chroma_client.get_or_create_collection(name=coll_name)
        print(f"Connesso alla collezione ChromaDB: {coll_name}")

    def search_vector_db(self, query_text, limit=5):
        # La logica di ricerca rimane la stessa, ma ora usa la collezione dinamica
        query_vector = self.ai.embed_text(query_text)
        
        results = self.collection.query(
            query_embeddings=[query_vector],
            n_results=limit
        )
        
        # Trasformiamo l'output per renderlo simile a quello che avevi prima
        formatted_results = []
        for i in range(len(results['documents'][0])):
            metadata = results['metadatas'][0][i]
            formatted_results.append({
                "testo_clean": results['documents'][0][i],
                "titolo": metadata.get('titolo'),
                "pagina_sezione": metadata.get('pagina_sezione'),
                "score": results['distances'][0][i],
                # Aggiunte consigliate basate sul tuo modello:
                "breadcrumb": metadata.get('breadcrumb'),
                "id_livello": metadata.get('id_livello'),
                "documento_id": metadata.get('documento_id'),
                "anchor_link": metadata.get('anchor_link') # Se vuoi mandare l'utente al punto esatto del PDF
    })
        return formatted_results