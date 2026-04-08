# app/api/v1/auth.py
"""
Router autenticazione — OAuth2 standard + Refresh Token
========================================================

ENDPOINT:
  POST /api/v1/auth/token          → login OAuth2 standard
  POST /api/v1/auth/refresh        → rinnova access token
  POST /api/v1/auth/logout         → logout (revoca refresh token)
  POST /api/v1/auth/logout-all     → logout da tutti i device
  GET  /api/v1/auth/me             → profilo utente corrente
  PUT  /api/v1/auth/me/password    → cambio password
  GET  /api/v1/auth/users          → lista utenti (Admin+)
  POST /api/v1/auth/users          → crea utente (Admin+)
  PUT  /api/v1/auth/users/{id}     → modifica utente (Admin+)
  DELETE /api/v1/auth/users/{id}   → elimina utente (Admin+)

NOTA SUL FORMATO LOGIN:
  OAuth2 standard usa application/x-www-form-urlencoded
  (non JSON) per il login. FastAPI lo gestisce con
  OAuth2PasswordRequestForm. Il campo si chiama "username"
  per standard — noi ci mettiamo l'email.
  Questo abilita il bottone Authorize in /docs.
"""

import logging
from fastapi import (
    APIRouter, Depends, HTTPException, Request,
    Response, status
)
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session
from typing import Optional

from app.db.session import get_db
from app.services.auth_service import (
    hash_password, verify_password,
    create_access_token,
    generate_refresh_token, save_refresh_token,
    verify_refresh_token, revoke_refresh_token,
    revoke_all_refresh_tokens,
    set_refresh_cookie, clear_refresh_cookie,
    get_refresh_token_from_cookie,
    get_current_user, require_admin,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# ─────────────────────────────────────────────
# SCHEMI PYDANTIC
# ─────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("La nuova password deve essere di almeno 8 caratteri.")
        return v


class CreateUserRequest(BaseModel):
    email:    EmailStr
    password: str
    nome:     Optional[str] = None
    cognome:  Optional[str] = None
    ruolo:    str = "User"

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("La password deve essere di almeno 8 caratteri.")
        return v


class UpdateUserRequest(BaseModel):
    nome:    Optional[str] = None
    cognome: Optional[str] = None
    ruolo:   Optional[str] = None


# ─────────────────────────────────────────────
# HELPER: serializza utente con ruoli
# ─────────────────────────────────────────────

def _user_dict(user, db: Session) -> dict:
    from app.models.rag_models import Utente_Ruolo, Ruolo
    ruoli = (
        db.query(Ruolo.nome_ruolo)
        .join(Utente_Ruolo, Utente_Ruolo.ruolo_id == Ruolo.ruolo_id)
        .filter(Utente_Ruolo.utente_id == user.utente_id)
        .all()
    )
    nomi_ruoli = [r.nome_ruolo for r in ruoli]
    return {
        "utente_id":      user.utente_id,
        "email":          user.email,
        "nome":           user.nome,
        "cognome":        user.cognome,
        "data_creazione": str(user.data_creazione) if user.data_creazione else None,
        "ruoli":          nomi_ruoli,
        "is_admin":       any(r in nomi_ruoli for r in ["Admin", "SuperAdmin"]),
        "is_superadmin":  "SuperAdmin" in nomi_ruoli,
        "role":           nomi_ruoli[0] if nomi_ruoli else "User",
    }


# ─────────────────────────────────────────────
# LOGIN — OAuth2 standard
# ─────────────────────────────────────────────

@router.post("/token")
def login(
    response: Response,
    request:  Request,
    form:     OAuth2PasswordRequestForm = Depends(),
    db:       Session = Depends(get_db),
):
    """
    Login OAuth2 standard.

    FORMATO RICHIESTA (application/x-www-form-urlencoded):
      username=mario@azienda.it&password=Secret123

    Il campo si chiama "username" per standard OAuth2
    ma noi ci inseriamo l'email.

    RISPOSTA:
      Body JSON: { access_token, token_type, user }
      Cookie:    refresh_token (httpOnly, non visibile in JSON)

    Il frontend salva access_token in memoria JS.
    Il browser gestisce il cookie refresh automaticamente.
    """
    from app.models.rag_models import Utente

    # Messaggio generico — non rivela se l'email esiste
    error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Email o password non corretti.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = db.query(Utente).filter(Utente.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        logger.warning(f"Login fallito: {form.username}")
        raise error

    profile = _user_dict(user, db)

    # Access token JWT (15 min)
    access_token = create_access_token({
        "sub":         user.email,
        "is_admin":    profile["is_admin"],
        "is_superadmin": profile["is_superadmin"],
        "role":        profile["role"],
    })

    # Refresh token (30 giorni) → DB + cookie httpOnly
    refresh_token = generate_refresh_token()
    save_refresh_token(
        db         = db,
        utente_id  = user.utente_id,
        token      = refresh_token,
        ip_address = request.client.host if request.client else None,
        user_agent = request.headers.get("user-agent"),
    )
    set_refresh_cookie(response, refresh_token)

    logger.info(f"Login OK: {user.email} [{profile['role']}]")
    return {
        "access_token": access_token,
        "token_type":   "bearer",
        "user":         profile,
    }


# ─────────────────────────────────────────────
# REFRESH — rinnova access token
# ─────────────────────────────────────────────

@router.post("/refresh")
def refresh_token_endpoint(
    request:  Request,
    response: Response,
    db:       Session = Depends(get_db),
):
    """
    Rinnova l'access token usando il refresh token dal cookie.

    FLUSSO (TOKEN ROTATION):
      1. Legge refresh token dal cookie httpOnly
      2. Verifica nel DB (esiste? non revocato? non scaduto?)
      3. Revoca il vecchio refresh token (rotation)
      4. Crea un nuovo refresh token e lo salva
      5. Emette nuovo access token JWT
      6. Imposta nuovo cookie con nuovo refresh token

    TOKEN ROTATION = ogni refresh genera un nuovo refresh token.
    Se un refresh token viene rubato e usato una seconda volta,
    il sistema lo rileva (già revocato) e può allertare.
    """
    from app.models.rag_models import Utente

    token = get_refresh_token_from_cookie(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nessun refresh token. Effettua il login.",
        )

    # Verifica il vecchio token
    rt   = verify_refresh_token(db, token)
    user = db.query(Utente).filter(Utente.utente_id == rt.utente_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato.")

    # TOKEN ROTATION: revoca il vecchio
    rt.revocato = True
    db.commit()

    profile = _user_dict(user, db)

    # Nuovo access token
    new_access = create_access_token({
        "sub":           user.email,
        "is_admin":      profile["is_admin"],
        "is_superadmin": profile["is_superadmin"],
        "role":          profile["role"],
    })

    # Nuovo refresh token
    new_refresh = generate_refresh_token()
    save_refresh_token(
        db         = db,
        utente_id  = user.utente_id,
        token      = new_refresh,
        ip_address = request.client.host if request.client else None,
        user_agent = request.headers.get("user-agent"),
    )
    set_refresh_cookie(response, new_refresh)

    return {
        "access_token": new_access,
        "token_type":   "bearer",
    }


# ─────────────────────────────────────────────
# LOGOUT
# ─────────────────────────────────────────────

@router.post("/logout")
def logout(
    request:  Request,
    response: Response,
    db:       Session = Depends(get_db),
):
    """
    Logout da questo device.
    Revoca il refresh token dal DB e cancella il cookie.
    L'access token rimane valido per i suoi 15 minuti residui
    (accettabile — per revoca immediata usa logout-all).
    """
    token = get_refresh_token_from_cookie(request)
    if token:
        revoke_refresh_token(db, token)
    clear_refresh_cookie(response)
    return {"status": "ok", "message": "Logout effettuato."}


@router.post("/logout-all")
def logout_all(
    request:      Request,
    response:     Response,
    current_user  = Depends(get_current_user),
    db: Session   = Depends(get_db),
):
    """
    Logout da TUTTI i device.
    Revoca tutti i refresh token dell'utente.
    Utile dopo cambio password o sospetta compromissione.
    """
    count = revoke_all_refresh_tokens(db, current_user.utente_id)
    clear_refresh_cookie(response)
    logger.info(f"Logout-all: {current_user.email}, {count} token revocati")
    return {
        "status":  "ok",
        "message": f"Disconnesso da {count} device.",
    }


# ─────────────────────────────────────────────
# PROFILO UTENTE CORRENTE
# ─────────────────────────────────────────────

@router.get("/me")
def get_me(
    current_user = Depends(get_current_user),
    db: Session  = Depends(get_db),
):
    return _user_dict(current_user, db)


# ─────────────────────────────────────────────
# CAMBIO PASSWORD
# ─────────────────────────────────────────────

@router.put("/me/password")
def change_password(
    request:      Request,
    response:     Response,
    body:         ChangePasswordRequest,
    current_user  = Depends(get_current_user),
    db: Session   = Depends(get_db),
):
    """
    Cambia password e revoca tutti i refresh token.
    Forza il re-login su tutti i device — comportamento corretto
    per sicurezza: dopo cambio password, le sessioni precedenti
    non devono essere più valide.
    """
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(400, detail="La password attuale non è corretta.")
    if body.current_password == body.new_password:
        raise HTTPException(400, detail="La nuova password deve essere diversa.")

    current_user.password_hash = hash_password(body.new_password)
    db.commit()

    # Revoca tutti i token → logout forzato da tutti i device
    count = revoke_all_refresh_tokens(db, current_user.utente_id)
    clear_refresh_cookie(response)

    logger.info(f"Password cambiata: {current_user.email}, {count} sessioni terminate")
    return {
        "status":  "ok",
        "message": f"Password aggiornata. {count} sessioni terminate.",
    }


# ─────────────────────────────────────────────
# GESTIONE UTENTI (solo Admin+)
# ─────────────────────────────────────────────

@router.get("/users")
def list_users(
    admin    = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models.rag_models import Utente
    users = db.query(Utente).order_by(Utente.data_creazione.desc()).all()
    return {"users": [_user_dict(u, db) for u in users]}


@router.post("/users", status_code=201)
def create_user(
    body:    CreateUserRequest,
    admin    = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models.rag_models import Utente, Ruolo, Utente_Ruolo

    if db.query(Utente).filter(Utente.email == body.email).first():
        raise HTTPException(409, detail=f"Email '{body.email}' già registrata.")

    ruolo = db.query(Ruolo).filter(Ruolo.nome_ruolo == body.ruolo).first()
    if not ruolo:
        raise HTTPException(400, detail=f"Ruolo '{body.ruolo}' non trovato.")

    new_user = Utente(
        email         = body.email,
        password_hash = hash_password(body.password),
        nome          = body.nome,
        cognome       = body.cognome,
    )
    db.add(new_user)
    db.flush()
    db.add(Utente_Ruolo(utente_id=new_user.utente_id, ruolo_id=ruolo.ruolo_id))
    db.commit()

    logger.info(f"Utente creato da {admin.email}: {new_user.email} [{body.ruolo}]")
    return {"status": "created", "user": _user_dict(new_user, db)}


@router.put("/users/{utente_id}")
def update_user(
    utente_id: int,
    body:      UpdateUserRequest,
    admin      = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models.rag_models import Utente, Ruolo, Utente_Ruolo

    user = db.query(Utente).filter(Utente.utente_id == utente_id).first()
    if not user:
        raise HTTPException(404, detail="Utente non trovato.")

    if body.nome    is not None: user.nome    = body.nome
    if body.cognome is not None: user.cognome = body.cognome

    if body.ruolo is not None:
        ruolo = db.query(Ruolo).filter(Ruolo.nome_ruolo == body.ruolo).first()
        if not ruolo:
            raise HTTPException(400, detail=f"Ruolo '{body.ruolo}' non trovato.")
        db.query(Utente_Ruolo).filter(Utente_Ruolo.utente_id == utente_id).delete()
        db.add(Utente_Ruolo(utente_id=utente_id, ruolo_id=ruolo.ruolo_id))

    db.commit()
    return {"status": "ok", "user": _user_dict(user, db)}


@router.delete("/users/{utente_id}")
def delete_user(
    utente_id: int,
    admin      = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models.rag_models import Utente

    if utente_id == admin.utente_id:
        raise HTTPException(400, detail="Non puoi eliminare il tuo account.")

    user = db.query(Utente).filter(Utente.utente_id == utente_id).first()
    if not user:
        raise HTTPException(404, detail="Utente non trovato.")

    db.delete(user)
    db.commit()
    logger.info(f"Utente eliminato da {admin.email}: {user.email}")
    return {"status": "deleted", "email": user.email}
