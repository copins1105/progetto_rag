# app/services/auth_service.py
"""
AuthService — OAuth2 + JWT + Refresh Token
==========================================

ARCHITETTURA COMPLESSIVA:
─────────────────────────────────────────────────────────────
  Access Token  (JWT, stateless)
    - Formato:  JWT firmato HS256
    - Vita:     15 minuti
    - Payload:  { sub: email, is_admin: bool, role: str, exp: ... }
    - Storage:  memoria JavaScript (mai localStorage)
    - Verifica: firma matematica, zero query al DB
    - Scopo:    autorizzare ogni singola richiesta API

  Refresh Token (stringa opaca, stateful)
    - Formato:  32 byte casuali → hex string (64 caratteri)
    - Vita:     30 giorni
    - Storage:  httpOnly cookie (inaccessibile da JavaScript)
    - DB:       salviamo SHA-256(token) — mai il token grezzo
    - Scopo:    ottenere un nuovo access token quando scade
    - Revoca:   UPDATE refresh_token SET revocato=TRUE
                → logout reale immediato
─────────────────────────────────────────────────────────────

PERCHÉ httpOnly COOKIE per il refresh token:
  Un attacco XSS può rubare qualsiasi variabile JavaScript.
  Un cookie httpOnly non è accessibile da JS — il browser
  lo gestisce in modo opaco e lo invia automaticamente.
  Questo rompe la catena di attacco più comune contro i JWT.

PERCHÉ SHA-256 e non bcrypt per il token hash:
  bcrypt è lento per design (serve per le password).
  Il refresh token è già casuale e lungo 32 byte —
  non serve il costo computazionale di bcrypt.
  SHA-256 è sufficiente e molto più veloce.
"""

import os
import secrets
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.db.session import get_db

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# CONFIGURAZIONE
# ─────────────────────────────────────────────

SECRET_KEY            = os.getenv("JWT_SECRET_KEY", "CAMBIA_IN_PRODUZIONE_min32chars!")
ALGORITHM             = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_MINUTES  = int(os.getenv("JWT_ACCESS_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_DAYS    = int(os.getenv("JWT_REFRESH_EXPIRE_DAYS",   "30"))

REFRESH_COOKIE_NAME   = "refresh_token"
REFRESH_COOKIE_PATH   = "/api/v1/auth"   # cookie inviato SOLO su questi path
                                          # non su /chat o /admin → meno superficie

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2PasswordBearer:
#   - dice a FastAPI dove leggere il token (header Authorization: Bearer)
#   - abilita il bottone Authorize nella Swagger UI /docs
#   - NON fa verifiche — è solo un estrattore
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


# ─────────────────────────────────────────────
# PASSWORD — bcrypt
# ─────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """
    Hash bcrypt della password.
    bcrypt include salt automaticamente nell'hash risultante.
    Output fisso: '$2b$12$...' (60 caratteri)
    """
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """
    Confronto in tempo costante per prevenire timing attacks.
    passlib estrae il salt dall'hash e ricalcola internamente.
    """
    return _pwd_context.verify(plain, hashed)


# ─────────────────────────────────────────────
# ACCESS TOKEN — JWT
# ─────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    """
    Crea un JWT firmato HS256, vita 15 minuti.

    Campi standard JWT (RFC 7519):
      sub → Subject (email utente)
      exp → Expiration time
      iat → Issued At

    Campi custom (leggibili dal frontend senza query):
      is_admin → evita query DB per controllare il ruolo
      role     → stringa ruolo per il frontend

    IMPORTANTE: il JWT è Base64 — leggibile da chiunque.
    Non inserire password, token o dati sensibili.
    La firma garantisce integrità, non confidenzialità.
    """
    now     = datetime.now(timezone.utc)
    payload = {
        **data,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Decodifica e valida il JWT.
    python-jose verifica automaticamente firma e scadenza.
    Raises HTTPException 401 per qualsiasi anomalia.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise ValueError("sub mancante")
        return payload
    except JWTError as e:
        logger.warning(f"JWT non valido: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token non valido o scaduto.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ─────────────────────────────────────────────
# REFRESH TOKEN — stringa opaca + DB
# ─────────────────────────────────────────────

def generate_refresh_token() -> str:
    """
    32 byte casuali da os.urandom() → stringa hex 64 caratteri.
    secrets.token_hex è crittograficamente sicuro per design.
    """
    return secrets.token_hex(32)


def hash_refresh_token(token: str) -> str:
    """
    SHA-256 del token grezzo → 64 caratteri hex.
    Salviamo questo nel DB, mai il token originale.
    Perché SHA-256 e non bcrypt: il token è già
    32 byte random (entropia massima), bcrypt sarebbe
    overhead inutile usato per password umane corte.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def save_refresh_token(
    db: Session,
    utente_id: int,
    token: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """Salva il refresh token (come hash) nel DB."""
    from app.models.rag_models import RefreshToken

    rt = RefreshToken(
        utente_id  = utente_id,
        token_hash = hash_refresh_token(token),
        scadenza   = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
        ip_address = ip_address,
        user_agent = user_agent,
    )
    db.add(rt)
    db.commit()


def verify_refresh_token(db: Session, token: str):
    """
    Verifica che il token esista nel DB, non sia revocato
    e non sia scaduto. Restituisce l'oggetto RefreshToken.

    Raises HTTPException 401 se non valido.
    """
    from app.models.rag_models import RefreshToken

    token_hash = hash_refresh_token(token)
    rt = db.query(RefreshToken).filter_by(
        token_hash = token_hash,
        revocato   = False,
    ).first()

    if not rt:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token non valido o revocato.",
        )

    now = datetime.now(timezone.utc)
    exp = rt.scadenza
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)

    if now > exp:
        rt.revocato = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token scaduto. Effettua nuovamente il login.",
        )

    return rt


def revoke_refresh_token(db: Session, token: str) -> bool:
    """Revoca un singolo token (logout da un device)."""
    from app.models.rag_models import RefreshToken

    rt = db.query(RefreshToken).filter_by(
        token_hash = hash_refresh_token(token),
        revocato   = False,
    ).first()

    if rt:
        rt.revocato = True
        db.commit()
        return True
    return False


def revoke_all_refresh_tokens(db: Session, utente_id: int) -> int:
    """
    Revoca TUTTI i token di un utente.
    Usato al cambio password o su sospetta compromissione.
    """
    from app.models.rag_models import RefreshToken

    count = db.query(RefreshToken).filter_by(
        utente_id = utente_id,
        revocato  = False,
    ).update({"revocato": True})
    db.commit()
    return count


# ─────────────────────────────────────────────
# COOKIE HELPERS
# ─────────────────────────────────────────────

def set_refresh_cookie(response, token: str) -> None:
    """
    Imposta il cookie httpOnly per il refresh token.

    Attributi di sicurezza spiegati:
      httponly=True     → JS non può leggere il cookie
                          document.cookie non lo mostra
                          blocca furto via XSS

      secure=True       → inviato SOLO su HTTPS
                          in produzione obbligatorio
                          in sviluppo locale: False

      samesite="strict" → inviato solo se la richiesta
                          origina dallo stesso sito
                          blocca attacchi CSRF

      path=COOKIE_PATH  → inviato SOLO agli endpoint /auth
                          non allegato a ogni chiamata API
                          minimizza la superficie di attacco

      max_age           → durata cookie nel browser
                          = durata refresh token in secondi
    """
    is_prod = os.getenv("ENVIRONMENT", "development") == "production"
    response.set_cookie(
        key      = REFRESH_COOKIE_NAME,
        value    = token,
        httponly = True,
        secure   = is_prod,
        samesite = "strict",
        path     = REFRESH_COOKIE_PATH,
        max_age  = REFRESH_TOKEN_DAYS * 24 * 60 * 60,
    )


def clear_refresh_cookie(response) -> None:
    """Rimuove il cookie dal browser impostando max_age=0."""
    is_prod = os.getenv("ENVIRONMENT", "development") == "production"
    response.delete_cookie(
        key      = REFRESH_COOKIE_NAME,
        path     = REFRESH_COOKIE_PATH,
        httponly = True,
        secure   = is_prod,
        samesite = "strict",
    )


def get_refresh_token_from_cookie(request: Request) -> Optional[str]:
    """Legge il refresh token dal cookie della richiesta."""
    return request.cookies.get(REFRESH_COOKIE_NAME)


# ─────────────────────────────────────────────
# DEPENDENCIES FastAPI
# ─────────────────────────────────────────────

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """
    Dependency iniettabile in ogni endpoint protetto.

    Flusso per ogni richiesta:
      1. FastAPI estrae Bearer token dall'header (oauth2_scheme)
      2. decode_access_token: verifica firma JWT (no DB)
      3. Una sola SELECT per email tramite indice
      4. Restituisce oggetto Utente

    Costo: ~1 query DB per richiesta. Leggero.
    """
    from app.models.rag_models import Utente

    payload = decode_access_token(token)
    email   = payload.get("sub")

    user = db.query(Utente).filter(Utente.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utente non trovato.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_admin(
    current_user = Depends(get_current_user),
    db: Session  = Depends(get_db),
):
    """Richiede ruolo Admin o SuperAdmin."""
    from app.models.rag_models import Utente_Ruolo, Ruolo

    ruolo = (
        db.query(Ruolo.nome_ruolo)
        .join(Utente_Ruolo, Utente_Ruolo.ruolo_id == Ruolo.ruolo_id)
        .filter(
            Utente_Ruolo.utente_id == current_user.utente_id,
            Ruolo.nome_ruolo.in_(["Admin", "SuperAdmin"]),
        )
        .first()
    )
    if not ruolo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso negato: richiesto ruolo Admin.",
        )
    return current_user


def require_superadmin(
    current_user = Depends(get_current_user),
    db: Session  = Depends(get_db),
):
    """
    Richiede ruolo SuperAdmin.
    Dashboard globale, log di tutti, gestione Admin.
    """
    from app.models.rag_models import Utente_Ruolo, Ruolo

    is_super = (
        db.query(Utente_Ruolo)
        .join(Ruolo, Ruolo.ruolo_id == Utente_Ruolo.ruolo_id)
        .filter(
            Utente_Ruolo.utente_id == current_user.utente_id,
            Ruolo.nome_ruolo == "SuperAdmin",
        )
        .first()
    )
    if not is_super:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso negato: richiesto ruolo SuperAdmin.",
        )
    return current_user
