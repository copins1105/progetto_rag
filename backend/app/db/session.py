# from sqlalchemy import create_engine
# from sqlalchemy.orm import sessionmaker
# from dotenv import load_dotenv
# import os

# # Carica il file .env
# load_dotenv()

# # Prende l'URL contenuto nel file .env
# SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# # Configura SQLAlchemy
# engine = create_engine(SQLALCHEMY_DATABASE_URL)

# # Crea la sessione
# SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# # Questa funzione per connettersi
# def get_db():
#     db = SessionLocal()
#     try:
#         yield db
#     finally:
#         db.close()


# app/db/session.py
"""
Aggiornato per usare db_config.py.
La URL del database viene ora risolta in base a INGESTION_PIPELINE,
non più letta direttamente da DATABASE_URL.

Tutto il resto del progetto che importa get_db o SessionLocal
non cambia nulla — stessa interfaccia di prima.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

from app.core.db_config import ACTIVE_CONFIG

load_dotenv()

# Usa la URL della pipeline attiva (marker o mistral)
SQLALCHEMY_DATABASE_URL = ACTIVE_CONFIG.database_url

engine = create_engine(SQLALCHEMY_DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()