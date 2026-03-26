from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Date, Boolean, CheckConstraint, text
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
import datetime
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


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
    data_caricamento     = Column(DateTime,    server_default=text('CURRENT_TIMESTAMP'))
    sync_status          = Column(String(20),  default='synced')

    tipo      = relationship("TipoDocumento",      foreign_keys=[id_tipo])
    livello   = relationship("LivelloRiservatezza", foreign_keys=[id_livello])
    sync_logs = relationship("SyncLog", back_populates="documento", cascade="all, delete-orphan")


class SyncLog(Base):
    __tablename__ = "sync_log"

    log_id       = Column(Integer, primary_key=True)
    documento_id = Column(Integer, ForeignKey("documento.documento_id", ondelete="CASCADE"))
    evento       = Column(String(50), nullable=False)
    dettaglio    = Column(Text)
    esito        = Column(String(20), nullable=False, default='ok')
    timestamp    = Column(DateTime,   server_default=text('CURRENT_TIMESTAMP'))

    documento = relationship("Documento", back_populates="sync_logs")