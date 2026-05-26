# from langchain_ollama import OllamaEmbeddings
# from langchain_core.embeddings import Embeddings

# # Facendo ereditare AIService da Embeddings, 
# # la classe "diventa"un componente LangChain
# class AIService(Embeddings):
#     def __init__(self):
#         # Inizializza il modello interno
#         self.model = OllamaEmbeddings(model="embeddinggemma:latest")
    
#     def embed_query(self, text: str):
#         return self.model.embed_query(text)

#     def embed_documents(self, texts: list):
#         return self.model.embed_documents(texts)



from langchain_ollama import OllamaEmbeddings
from langchain_core.embeddings import Embeddings

_QUERY_INSTRUCTION = (
    "Instruct: Recupera i passaggi più rilevanti per rispondere alla domanda\n"
    "Query: {query}"
)


class AIService(Embeddings):
    def __init__(self):
        self.model = OllamaEmbeddings(model="qwen3-embedding:0.6b")

    def embed_query(self, text: str) -> list[float]:
        """
        Embedding di una query utente.
        Qwen3 migliora il retrieval con il prefisso Instruct sulla query.
        NON usare questo metodo per testi HyDE (sono documenti, non query).
        """
        prefixed = _QUERY_INSTRUCTION.format(query=text)
        return self.model.embed_query(prefixed)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """
        Embedding di documenti/chunk.
        Qwen3 non vuole prefissi sui documenti — solo testo pulito.
        """
        return self.model.embed_documents(texts)

    def embed_hyde(self, text: str) -> list[float]:
        """
        Embedding di un testo HyDE (paragrafo documento simulato).
        Usa embed_documents internamente perché HyDE è un documento,
        non una query — NON deve avere il prefisso Instruct.
        """
        results = self.model.embed_documents([text])
        return results[0]