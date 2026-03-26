from langchain_ollama import OllamaEmbeddings
from langchain_core.embeddings import Embeddings

# Facendo ereditare AIService da Embeddings, 
# la classe "diventa"un componente LangChain
class AIService(Embeddings):
    def __init__(self):
        # Inizializza il modello interno
        self.model = OllamaEmbeddings(model="embeddinggemma:latest")
    
    def embed_query(self, text: str):
        return self.model.embed_query(text)

    def embed_documents(self, texts: list):
        return self.model.embed_documents(texts)