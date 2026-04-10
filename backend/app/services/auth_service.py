# app/services/auth_service.py
"""
AuthService — OAuth2 + JWT + Refresh Token + RBAC
==================================================

PERMESSI:
  La funzione resolve_permissions(utente_id, db) calcola
  i permessi effettivi di un utente applicando:
    1. Permessi ereditati dal ruolo
    2. Override individuali (Utente_Permesso)
  Il risultato è una lista di codici_permesso (solo quelli TRUE).

  I permessi vengono inseriti nel JWT al login/refresh.
  Vita JWT = 15 minuti → i permessi scadono automaticamente.
  Se vuoi effetto immediato: revoca il refresh token dell'utente.

DEPENDENCY require_permission("codice"):
  Sostituisce require_admin() sugli endpoint.
  Verifica che il permesso sia nel JWT dell'utente.
  Se non presente → 403 Forbidden.
"""

import os
import secrets
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import text

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
REFRESH_COOKIE_PATH   = "/api/v1/auth"

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


# ─────────────────────────────────────────────
# PASSWORD
# ─────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


# ─────────────────────────────────────────────
# RISOLUZIONE PERMESSI
# ─────────────────────────────────────────────

def resolve_permissions(utente_id: int, db: Session) -> List[str]:
    """
    Calcola i permessi effettivi di un utente.

    Logica (in ordine di priorità):
      1. Override individuale (Utente_Permesso):
         - concesso=TRUE  → permesso garantito
         - concesso=FALSE → permesso negato anche se il ruolo ce l'ha
      2. Permesso da ruolo (Ruolo_Permesso) → TRUE se presente
      3. Default → FALSE (non incluso nella lista)

    Ritorna una lista di codici_permesso (solo quelli effettivamente TRUE).
    """
    try:
        rows = db.execute(text("""
            WITH permessi_ruolo AS (
                SELECT p.codice_permesso, TRUE AS concesso
                FROM Utente_Ruolo ur
                JOIN Ruolo_Permesso rp ON rp.ruolo_id   = ur.ruolo_id
                JOIN Permesso       p  ON p.permesso_id = rp.permesso_id
                WHERE ur.utente_id = :uid
            ),
            override AS (
                SELECT p.codice_permesso, up.concesso
                FROM Utente_Permesso up
                JOIN Permesso p ON p.permesso_id = up.permesso_id
                WHERE up.utente_id = :uid
            ),
            effettivi AS (
                -- Override ha priorità assoluta
                SELECT codice_permesso, concesso FROM override
                UNION ALL
                -- Ruolo solo se non c'è override
                SELECT pr.codice_permesso, pr.concesso
                FROM permessi_ruolo pr
                WHERE NOT EXISTS (
                    SELECT 1 FROM override o
                    WHERE o.codice_permesso = pr.codice_permesso
                )
            )
            SELECT codice_permesso FROM effettivi WHERE concesso = TRUE
        """), {"uid": utente_id}).fetchall()

        return [r.codice_permesso for r in rows]

    except Exception as e:
        logger.error(f"resolve_permissions error (utente_id={utente_id}): {e}")
        return []


def user_has_permission(utente_id: int, codice: str, db: Session) -> bool:
    """Controllo rapido per un singolo permesso (senza caricare tutti)."""
    try:
        row = db.execute(text("""
            WITH override AS (
                SELECT up.concesso
                FROM Utente_Permesso up
                JOIN Permesso p ON p.permesso_id = up.permesso_id
                WHERE up.utente_id = :uid AND p.codice_permesso = :cod
            ),
            da_ruolo AS (
                SELECT TRUE AS concesso
                FROM Utente_Ruolo ur
                JOIN Ruolo_Permesso rp ON rp.ruolo_id   = ur.ruolo_id
                JOIN Permesso       p  ON p.permesso_id = rp.permesso_id
                WHERE ur.utente_id = :uid AND p.codice_permesso = :cod
                LIMIT 1
            )
            SELECT COALESCE(
                (SELECT concesso FROM override LIMIT 1),
                (SELECT concesso FROM da_ruolo LIMIT 1),
                FALSE
            ) AS risultato
        """), {"uid": utente_id, "cod": codice}).fetchone()

        return bool(row.risultato) if row else False

    except Exception as e:
        logger.error(f"user_has_permission error: {e}")
        return False


# ─────────────────────────────────────────────
# ACCESS TOKEN — JWT
# ─────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    """
    Crea JWT firmato HS256, vita 15 minuti.
    Il campo 'permissions' trasporta la lista dei permessi effettivi.
    """
    now     = datetime.now(timezone.utc)
    payload = {
        **data,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
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
# REFRESH TOKEN
# ─────────────────────────────────────────────

def generate_refresh_token() -> str:
    return secrets.token_hex(32)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def save_refresh_token(
    db: Session,
    utente_id: int,
    token: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
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
    from app.models.rag_models import RefreshToken
    token_hash = hash_refresh_token(token)
    rt = db.query(RefreshToken).filter_by(token_hash=token_hash, revocato=False).first()

    if not rt:
        raise HTTPException(status_code=401, detail="Refresh token non valido o revocato.")

    now = datetime.now(timezone.utc)
    exp = rt.scadenza
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)

    if now > exp:
        rt.revocato = True
        db.commit()
        raise HTTPException(status_code=401, detail="Refresh token scaduto. Effettua nuovamente il login.")

    return rt


def revoke_refresh_token(db: Session, token: str) -> bool:
    from app.models.rag_models import RefreshToken
    rt = db.query(RefreshToken).filter_by(
        token_hash=hash_refresh_token(token), revocato=False
    ).first()
    if rt:
        rt.revocato = True
        db.commit()
        return True
    return False


def revoke_all_refresh_tokens(db: Session, utente_id: int) -> int:
    from app.models.rag_models import RefreshToken
    count = db.query(RefreshToken).filter_by(
        utente_id=utente_id, revocato=False
    ).update({"revocato": True})
    db.commit()
    return count


# ─────────────────────────────────────────────
# COOKIE HELPERS
# ─────────────────────────────────────────────

def set_refresh_cookie(response, token: str) -> None:
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
    is_prod = os.getenv("ENVIRONMENT", "development") == "production"
    response.delete_cookie(
        key      = REFRESH_COOKIE_NAME,
        path     = REFRESH_COOKIE_PATH,
        httponly = True,
        secure   = is_prod,
        samesite = "strict",
    )


def get_refresh_token_from_cookie(request: Request) -> Optional[str]:
    return request.cookies.get(REFRESH_COOKIE_NAME)


# ─────────────────────────────────────────────
# DEPENDENCIES FASTAPI
# ─────────────────────────────────────────────

def get_current_user(
    token: str       = Depends(oauth2_scheme),
    db: Session      = Depends(get_db),
):
    """Verifica JWT e restituisce l'oggetto Utente."""
    from app.models.rag_models import Utente
    payload = decode_access_token(token)
    email   = payload.get("sub")
    user    = db.query(Utente).filter(Utente.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato.",
                            headers={"WWW-Authenticate": "Bearer"})
    return user


def get_current_user_with_permissions(
    token: str  = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """
    Come get_current_user ma restituisce anche i permessi dal JWT.
    Usato quando serve accesso veloce ai permessi senza query DB.
    """
    from app.models.rag_models import Utente
    payload = decode_access_token(token)
    email   = payload.get("sub")
    user    = db.query(Utente).filter(Utente.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato.",
                            headers={"WWW-Authenticate": "Bearer"})
    # Permessi dal JWT (lista di codici)
    user._permissions = payload.get("permissions", [])
    return user


def require_permission(codice: str):
    """
    Dependency factory: verifica che l'utente abbia un permesso specifico.

    Uso:
        @router.get("/admin/something")
        async def endpoint(_=Depends(require_permission("doc_upload"))):
            ...

    Legge i permessi dal JWT (nessuna query DB).
    Se il permesso non è nel token → 403 Forbidden.
    """
    def _check(
        token: str  = Depends(oauth2_scheme),
        db: Session = Depends(get_db),
    ):
        from app.models.rag_models import Utente
        payload = decode_access_token(token)

        # Permessi dal JWT
        permissions: list = payload.get("permissions", [])

        if codice not in permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permesso '{codice}' non disponibile.",
            )

        # Restituisce l'utente per endpoint che ne hanno bisogno
        email = payload.get("sub")
        user  = db.query(Utente).filter(Utente.email == email).first()
        if not user:
            raise HTTPException(status_code=401, detail="Utente non trovato.")
        return user

    return _check


def require_admin(
    current_user = Depends(get_current_user),
    db: Session  = Depends(get_db),
):
    """
    Retrocompatibilità: verifica ruolo Admin o SuperAdmin.
    Per i nuovi endpoint usare require_permission() invece.
    """
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
        raise HTTPException(status_code=403, detail="Accesso negato: richiesto ruolo Admin.")
    return current_user


def require_superadmin(
    current_user = Depends(get_current_user),
    db: Session  = Depends(get_db),
):
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
        raise HTTPException(status_code=403, detail="Accesso negato: richiesto ruolo SuperAdmin.")
    return current_user