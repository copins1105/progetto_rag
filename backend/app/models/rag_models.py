# app/models/rag_models.py
from sqlalchemy import (
    Column, Integer, String, Text, ForeignKey,
    DateTime, Date, Boolean, CheckConstraint, text
)
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
import datetime
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


# ─────────────────────────────────────────────
# GOVERNANCE DOCUMENTI
# ─────────────────────────────────────────────

class TipoDocumento(Base):
    __tablename__ = "tipo_documento"
    id_tipo         = Column(Integer, primary_key=True)
    nome_tipo       = Column(String(50))
    estensione_file = Column(String(10))


class LivelloRiservatezza(Base):
    __tablename__ = "livello_riservatezza"
    id_livello   = Column(Integer, primary_key=True)
    nome_livello = Column(String(50))


class Documento(Base):
    __tablename__ = "documento"

    documento_id         = Column(Integer, primary_key=True, index=True)
    id_tipo              = Column(Integer, ForeignKey("tipo_documento.id_tipo"))
    id_livello           = Column(Integer, ForeignKey("livello_riservatezza.id_livello"))
    titolo               = Column(String(255), nullable=False)
    versione             = Column(String(50),  nullable=False)
    data_validita_inizio = Column(Date,        nullable=False)
    data_scadenza        = Column(Date)
    is_archiviato        = Column(Boolean,     default=False)
    # Chi ha caricato il documento (Admin owner)
    id_utente_caricamento = Column(Integer, ForeignKey("utente.utente_id"), nullable=True)
    data_caricamento     = Column(DateTime,    server_default=text('CURRENT_TIMESTAMP'))
    sync_status          = Column(String(20),  default='synced')

    tipo      = relationship("TipoDocumento",       foreign_keys=[id_tipo])
    livello   = relationship("LivelloRiservatezza",  foreign_keys=[id_livello])
    sync_logs = relationship("SyncLog", back_populates="documento", cascade="all, delete-orphan")
    caricato_da = relationship("Utente", foreign_keys=[id_utente_caricamento])


class SyncLog(Base):
    __tablename__ = "sync_log"

    log_id       = Column(Integer, primary_key=True)
    documento_id = Column(Integer, ForeignKey("documento.documento_id", ondelete="CASCADE"))
    evento       = Column(String(50), nullable=False)
    dettaglio    = Column(Text)
    esito        = Column(String(20), nullable=False, default='ok')
    timestamp    = Column(DateTime,   server_default=text('CURRENT_TIMESTAMP'))

    documento = relationship("Documento", back_populates="sync_logs")


# ─────────────────────────────────────────────
# AUTH — Utenti, Ruoli, Permessi
# ─────────────────────────────────────────────

class Utente(Base):
    __tablename__ = "utente"

    utente_id      = Column(Integer, primary_key=True, index=True)
    email          = Column(String(255), unique=True, nullable=False, index=True)
    password_hash  = Column(String(255), nullable=False)
    nome           = Column(String(100))
    cognome        = Column(String(100))
    data_creazione = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))
    # Admin che ha creato questo utente (NULL = sistema/SuperAdmin)
    creato_da      = Column(Integer, ForeignKey("utente.utente_id", ondelete="SET NULL"), nullable=True)

    utente_ruoli    = relationship("Utente_Ruolo",  back_populates="utente", cascade="all, delete-orphan")
    refresh_tokens  = relationship("RefreshToken",  back_populates="utente", cascade="all, delete-orphan")
    # Utenti creati da questo Admin
    # DOPO (corretto)
    utenti_creati   = relationship(
        "Utente",
        foreign_keys=[creato_da],
        back_populates="creatore",
        lazy="dynamic",
    )
    creatore = relationship(
        "Utente",
        foreign_keys=[creato_da],
        back_populates="utenti_creati",
        remote_side="Utente.utente_id",
        uselist=False,
    )


class Ruolo(Base):
    __tablename__ = "ruolo"

    ruolo_id    = Column(Integer, primary_key=True)
    nome_ruolo  = Column(String(50), unique=True, nullable=False)
    descrizione = Column(String(255))

    utente_ruoli   = relationship("Utente_Ruolo",   back_populates="ruolo")
    ruolo_permessi = relationship("Ruolo_Permesso", back_populates="ruolo", cascade="all, delete-orphan")


class Permesso(Base):
    __tablename__ = "permesso"

    permesso_id     = Column(Integer, primary_key=True)
    codice_permesso = Column(String(50), unique=True, nullable=False)
    descrizione     = Column(String(255))

    ruolo_permessi = relationship("Ruolo_Permesso", back_populates="permesso")


class Utente_Ruolo(Base):
    __tablename__ = "utente_ruolo"

    utente_id = Column(Integer, ForeignKey("utente.utente_id", ondelete="CASCADE"), primary_key=True)
    ruolo_id  = Column(Integer, ForeignKey("ruolo.ruolo_id",   ondelete="CASCADE"), primary_key=True)

    utente = relationship("Utente", back_populates="utente_ruoli")
    ruolo  = relationship("Ruolo",  back_populates="utente_ruoli")


class Ruolo_Permesso(Base):
    __tablename__ = "ruolo_permesso"

    ruolo_id    = Column(Integer, ForeignKey("ruolo.ruolo_id",      ondelete="CASCADE"), primary_key=True)
    permesso_id = Column(Integer, ForeignKey("permesso.permesso_id", ondelete="CASCADE"), primary_key=True)

    ruolo    = relationship("Ruolo",    back_populates="ruolo_permessi")
    permesso = relationship("Permesso", back_populates="ruolo_permessi")


# ─────────────────────────────────────────────
# AUTH — Refresh Token
# ─────────────────────────────────────────────

class RefreshToken(Base):
    __tablename__ = "refresh_token"

    token_id   = Column(Integer, primary_key=True)
    utente_id  = Column(Integer, ForeignKey("utente.utente_id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    scadenza   = Column(DateTime(timezone=True), nullable=False)
    revocato   = Column(Boolean, nullable=False, default=False)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

    utente = relationship("Utente", back_populates="refresh_tokens")


# ─────────────────────────────────────────────
# RBAC — Override permessi individuali
# ─────────────────────────────────────────────

class UtentePermesso(Base):
    """Override individuali sui permessi (migration 06)."""
    __tablename__ = "utente_permesso"

    utente_id     = Column(Integer,
                           ForeignKey("utente.utente_id", ondelete="CASCADE"),
                           primary_key=True)
    permesso_id   = Column(Integer,
                           ForeignKey("permesso.permesso_id", ondelete="CASCADE"),
                           primary_key=True)
    concesso      = Column(Boolean, nullable=False, default=True)
    aggiornato_da = Column(Integer,
                           ForeignKey("utente.utente_id", ondelete="SET NULL"),
                           nullable=True)
    aggiornato_il = Column(DateTime(timezone=True), server_default=text('NOW()'))

    utente        = relationship("Utente", foreign_keys=[utente_id])
    permesso      = relationship("Permesso")
    modificato_da = relationship("Utente", foreign_keys=[aggiornato_da])