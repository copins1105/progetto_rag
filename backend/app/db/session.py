from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
import os

# Carica il file .env
load_dotenv()

# Prende l'URL contenuto nel file .env
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# Configura SQLAlchemy
engine = create_engine(SQLALCHEMY_DATABASE_URL)

# Crea la sessione
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Questa funzione per connettersi
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()