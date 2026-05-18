# # app/core/db_config.py
# """
# db_config.py
# ============
# Risolve a runtime le variabili di connessione (PostgreSQL + ChromaDB)
# in base alla pipeline scelta nel .env (INGESTION_PIPELINE).

# Uso:
#     from app.core.db_config import get_db_config
#     cfg = get_db_config()
#     # cfg.database_url
#     # cfg.chroma_host
#     # cfg.chroma_port
#     # cfg.chroma_collection_name
#     # cfg.pipeline  ("marker" | "mistral")

# Questo modulo è l'UNICO posto dove si legge INGESTION_PIPELINE.
# Tutti gli altri moduli importano da qui invece di leggere os.getenv
# direttamente, così cambiare pipeline richiede solo modificare .env.

# Perché un modulo separato e non variabili globali in session.py?
#   - session.py è già importato pesantemente ovunque, aggiungere
#     logica condizionale lì crea dipendenze circolari
#   - Questo modulo è leggero e importabile ovunque senza side effects
#   - Rende il routing della pipeline esplicito e tracciabile
# """

# import os
# from dataclasses import dataclass
# from dotenv import load_dotenv

# load_dotenv()


# @dataclass(frozen=True)
# class DBConfig:
#     pipeline:               str
#     database_url:           str
#     chroma_host:            str
#     chroma_port:            int
#     chroma_collection_name: str
#     chroma_path:            str  # URL completo per ChromaDB (es. http://localhost:8000)


# def get_db_config() -> DBConfig:
#     """
#     Legge INGESTION_PIPELINE e restituisce la configurazione
#     del database corrispondente.

#     Pipeline "marker"  → porta 5432 PostgreSQL, porta 8000 ChromaDB
#     Pipeline "mistral" → porta 5433 PostgreSQL, porta 8001 ChromaDB

#     Raises:
#         ValueError se INGESTION_PIPELINE ha un valore non riconosciuto
#     """
#     pipeline = os.getenv("INGESTION_PIPELINE", "marker").lower().strip()

#     if pipeline == "marker":
#         return DBConfig(
#             pipeline               = "marker",
#             database_url           = os.getenv(
#                 "MARKER_DATABASE_URL",
#                 "postgresql://admin:POLICYNAVIGATOR@localhost:5432/policy_db",
#             ),
#             chroma_host            = os.getenv("MARKER_CHROMA_HOST", "localhost"),
#             chroma_port            = int(os.getenv("MARKER_CHROMA_PORT", "8000")),
#             chroma_collection_name = os.getenv(
#                 "MARKER_CHROMA_COLLECTION_NAME", "documenti_semantici"
#             ),
#             chroma_path            = os.getenv("MARKER_CHROMA_PATH", "http://localhost:8000"),
#         )

#     elif pipeline == "mistral":
#         return DBConfig(
#             pipeline               = "mistral",
#             database_url           = os.getenv(
#                 "MISTRAL_DATABASE_URL",
#                 "postgresql://admin:POLICYNAVIGATOR@localhost:5433/policy_db",
#             ),
#             chroma_host            = os.getenv("MISTRAL_CHROMA_HOST", "localhost"),
#             chroma_port            = int(os.getenv("MISTRAL_CHROMA_PORT", "8001")),
#             chroma_collection_name = os.getenv(
#                 "MISTRAL_CHROMA_COLLECTION_NAME", "documenti_semantici_mistral"
#             ),
#             chroma_path            = os.getenv("MISTRAL_CHROMA_PATH", "http://localhost:8001"),
#         )

#     else:
#         raise ValueError(
#             f"INGESTION_PIPELINE='{pipeline}' non riconosciuto. "
#             "Valori validi: 'marker' | 'mistral'"
#         )


# # Singleton — calcolato una volta sola all'avvio del backend
# # Importa questo invece di chiamare get_db_config() ogni volta
# ACTIVE_CONFIG: DBConfig = get_db_config()



# app/core/db_config.py
"""
db_config.py
============
Risolve a runtime le variabili di connessione (PostgreSQL + ChromaDB)
in base alla pipeline scelta nel .env (INGESTION_PIPELINE).

Uso:
    from app.core.db_config import get_db_config
    cfg = get_db_config()
    # cfg.database_url
    # cfg.chroma_host
    # cfg.chroma_port
    # cfg.chroma_collection_name
    # cfg.pipeline  ("marker" | "mistral")

Questo modulo è l'UNICO posto dove si legge INGESTION_PIPELINE.
Tutti gli altri moduli importano da qui invece di leggere os.getenv
direttamente, così cambiare pipeline richiede solo modificare .env.

Perché un modulo separato e non variabili globali in session.py?
  - session.py è già importato pesantemente ovunque, aggiungere
    logica condizionale lì crea dipendenze circolari
  - Questo modulo è leggero e importabile ovunque senza side effects
  - Rende il routing della pipeline esplicito e tracciabile
"""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class DBConfig:
    pipeline:               str
    database_url:           str
    chroma_host:            str
    chroma_port:            int
    chroma_collection_name: str
    output_dir:             str   # cartella markdown + chunks JSON
    chunks_dir:             str   # cartella chunks JSON finale


def get_db_config() -> DBConfig:
    """
    Legge INGESTION_PIPELINE e restituisce la configurazione
    del database e delle cartelle corrispondenti.

    Pipeline "marker"  → porta 5432/8000, cartelle output_json / chunks
    Pipeline "mistral" → porta 5433/8001, cartelle output_json_mistral / chunks_mistral

    Raises:
        ValueError se INGESTION_PIPELINE ha un valore non riconosciuto
    """
    pipeline = os.getenv("INGESTION_PIPELINE", "marker").lower().strip()

    # Base path comune — usato come fallback se le variabili specifiche
    # non sono nel .env (compatibilità con installazioni esistenti)
    base = r"C:\Users\PC_A26\Desktop\programmi\TirocinioAI\backend"

    if pipeline == "marker":
        return DBConfig(
            pipeline               = "marker",
            database_url           = os.getenv(
                "MARKER_DATABASE_URL",
                "postgresql://admin:POLICYNAVIGATOR@localhost:5432/policy_db",
            ),
            chroma_host            = os.getenv("MARKER_CHROMA_HOST", "localhost"),
            chroma_port            = int(os.getenv("MARKER_CHROMA_PORT", "8000")),
            chroma_collection_name = os.getenv(
                "MARKER_CHROMA_COLLECTION_NAME", "documenti_semantici"
            ),
            output_dir             = os.getenv(
                "MARKER_OUTPUT_DIR", os.path.join(base, "output_json")
            ),
            chunks_dir             = os.getenv(
                "MARKER_CHUNKS_DIR", os.path.join(base, "chunks")
            ),
        )

    elif pipeline == "mistral":
        return DBConfig(
            pipeline               = "mistral",
            database_url           = os.getenv(
                "MISTRAL_DATABASE_URL",
                "postgresql://admin:POLICYNAVIGATOR@localhost:5433/policy_db",
            ),
            chroma_host            = os.getenv("MISTRAL_CHROMA_HOST", "localhost"),
            chroma_port            = int(os.getenv("MISTRAL_CHROMA_PORT", "8001")),
            chroma_collection_name = os.getenv(
                "MISTRAL_CHROMA_COLLECTION_NAME", "documenti_semantici_mistral"
            ),
            output_dir             = os.getenv(
                "MISTRAL_OUTPUT_DIR", os.path.join(base, "output_json_mistral")
            ),
            chunks_dir             = os.getenv(
                "MISTRAL_CHUNKS_DIR", os.path.join(base, "chunks_mistral")
            ),
        )

    else:
        raise ValueError(
            f"INGESTION_PIPELINE='{pipeline}' non riconosciuto. "
            "Valori validi: 'marker' | 'mistral'"
        )


# Singleton — calcolato una volta sola all'avvio del backend
# Importa questo invece di chiamare get_db_config() ogni volta
ACTIVE_CONFIG: DBConfig = get_db_config()