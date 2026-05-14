import chromadb
from chromadb.config import Settings

# Connetti al client ChromaDB (assicurati che sia in esecuzione)
client = chromadb.HttpClient(host='localhost', port=8000)

# Ottieni la tua collezione
collection = client.get_collection("documenti_semantici")

# Conta i documenti
numero_documenti = collection.count()
print(f"Numero di documenti nella collezione: {numero_documenti}")