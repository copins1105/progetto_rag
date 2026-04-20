# app/services/auth_service.py
"""
AuthService — OAuth2 + JWT + Refresh Token + RBAC + Ownership
==============================================================

OWNERSHIP:
  - SuperAdmin: vede e gestisce tutto.
  - Admin: vede/gestisce solo i documenti che ha caricato lui
           e solo gli utenti che ha creato lui (ruolo User).
  - User: nessun accesso al pannello admin.

HELPERS NUOVI:
  get_current_admin_scope(token, db) → restituisce (utente, is_superadmin)
    usato negli endpoint per applicare il filtro ownership.

  require_doc_owner(documento_id, admin, db) → raise 403 se l'Admin
    non è il proprietario del documento (ignorato per SuperAdmin).

  require_user_owner(target_utente_id, admin, db) → raise 403 se l'Admin
    non ha creato quell'utente (ignorato per SuperAdmin).
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
# HELPER RUOLI
# ─────────────────────────────────────────────

def get_ruoli(utente_id: int, db: Session) -> List[str]:
    """Restituisce la lista dei ruoli di un utente."""
    from app.models.rag_models import Utente_Ruolo, Ruolo
    rows = (
        db.query(Ruolo.nome_ruolo)
        .join(Utente_Ruolo, Utente_Ruolo.ruolo_id == Ruolo.ruolo_id)
        .filter(Utente_Ruolo.utente_id == utente_id)
        .all()
    )
    return [r.nome_ruolo for r in rows]


def is_superadmin(utente_id: int, db: Session) -> bool:
    return "SuperAdmin" in get_ruoli(utente_id, db)


def is_admin_or_super(utente_id: int, db: Session) -> bool:
    ruoli = get_ruoli(utente_id, db)
    return any(r in ruoli for r in ["Admin", "SuperAdmin"])


# ─────────────────────────────────────────────
# RISOLUZIONE PERMESSI
# ─────────────────────────────────────────────

def resolve_permissions(utente_id: int, db: Session) -> List[str]:
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
                SELECT codice_permesso, concesso FROM override
                UNION ALL
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
        secure   = True,
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
    from app.models.rag_models import Utente
    payload = decode_access_token(token)
    email   = payload.get("sub")
    user    = db.query(Utente).filter(Utente.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato.",
                            headers={"WWW-Authenticate": "Bearer"})
    user._permissions = payload.get("permissions", [])
    return user


def require_permission(codice: str):
    """Verifica che l'utente abbia un permesso specifico (dal JWT)."""
    def _check(
        token: str  = Depends(oauth2_scheme),
        db: Session = Depends(get_db),
    ):
        from app.models.rag_models import Utente
        payload = decode_access_token(token)
        permissions: list = payload.get("permissions", [])

        if codice not in permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permesso '{codice}' non disponibile.",
            )

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
    """Verifica ruolo Admin o SuperAdmin."""
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


# ─────────────────────────────────────────────
# OWNERSHIP HELPERS — NUOVI
# ─────────────────────────────────────────────

def get_admin_scope(utente: "Utente", db: Session) -> dict:
    """
    Restituisce un dict con le informazioni di scope dell'Admin:
      {
        "is_superadmin": bool,
        "utente_id": int,
        # Se SuperAdmin → owner_filter=None (nessun filtro)
        # Se Admin → owner_filter=utente_id (filtra per proprietario)
        "owner_filter": int | None,
      }

    Usato negli endpoint per applicare il filtro ownership in modo uniforme.
    """
    _is_super = is_superadmin(utente.utente_id, db)
    return {
        "is_superadmin": _is_super,
        "utente_id":     utente.utente_id,
        "owner_filter":  None if _is_super else utente.utente_id,
    }


def require_doc_owner(documento_id: int, admin, db: Session) -> None:
    """
    Raise HTTP 403 se l'Admin non è il proprietario del documento.
    SuperAdmin: bypass totale.
    """
    if is_superadmin(admin.utente_id, db):
        return  # SuperAdmin può tutto

    from app.models.rag_models import Documento
    doc = db.query(Documento).filter(Documento.documento_id == documento_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato.")
    if doc.id_utente_caricamento != admin.utente_id:
        raise HTTPException(
            status_code=403,
            detail="Non hai i permessi per modificare questo documento."
        )


def require_user_owner(target_utente_id: int, admin, db: Session) -> None:
    """
    Raise HTTP 403 se l'Admin non ha creato quell'utente.
    SuperAdmin: bypass totale.
    Protezione extra: non si può operare su altri Admin o SuperAdmin.
    """
    if is_superadmin(admin.utente_id, db):
        return  # SuperAdmin può tutto

    from app.models.rag_models import Utente
    target = db.query(Utente).filter(Utente.utente_id == target_utente_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato.")

    # Un Admin non può operare su altri Admin o SuperAdmin
    target_ruoli = get_ruoli(target_utente_id, db)
    if any(r in target_ruoli for r in ["Admin", "SuperAdmin"]):
        raise HTTPException(
            status_code=403,
            detail="Non puoi modificare utenti con ruolo Admin o SuperAdmin."
        )

    # L'utente deve essere stato creato da questo Admin
    if target.creato_da != admin.utente_id:
        raise HTTPException(
            status_code=403,
            detail="Non hai i permessi per modificare questo utente."
        )