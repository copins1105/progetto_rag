# app/api/v1/auth.py
"""
Router autenticazione — OAuth2 + JWT con permessi RBAC + Ownership

OWNERSHIP UTENTI:
  - SuperAdmin: vede e gestisce tutti gli utenti, può creare Admin e User.
  - Admin: può creare solo User, vede e gestisce solo gli User che ha creato lui.
  - User: nessun accesso a questa sezione.
"""

import logging
import json as _json
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import text as _text
from sqlalchemy.orm import Session
from typing import Optional, List

from app.db.session import get_db
from app.services.auth_service import (
    hash_password, verify_password,
    create_access_token, resolve_permissions,
    generate_refresh_token, save_refresh_token,
    verify_refresh_token, revoke_refresh_token,
    revoke_all_refresh_tokens,
    set_refresh_cookie, clear_refresh_cookie,
    get_refresh_token_from_cookie,
    get_current_user, require_admin, require_permission,
    get_admin_scope, require_user_owner, is_superadmin,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# ─────────────────────────────────────────────
# HELPER: log attività
# ─────────────────────────────────────────────

def _log(db, utente_id, azione: str, dettaglio: dict = None,
         ip_address: str = None, esito: str = "ok"):
    try:
        db.execute(_text(
            "INSERT INTO Activity_Log (utente_id, azione, dettaglio, ip_address, esito) "
            "VALUES (:uid, :azione, CAST(:det AS jsonb), :ip, :esito)"
        ), {
            "uid":    utente_id,
            "azione": azione,
            "det":    _json.dumps(dettaglio or {}),
            "ip":     ip_address,
            "esito":  esito,
        })
        db.commit()
    except Exception as e:
        logger.warning(f"_log fallito ({azione}): {e}")
        try:
            db.rollback()
        except Exception:
            pass


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


class PermessoOverrideRequest(BaseModel):
    codice_permesso: str
    concesso:        bool


class BulkPermessoRequest(BaseModel):
    overrides: List[dict]


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
        "creato_da":      user.creato_da,
        "is_admin":       any(r in nomi_ruoli for r in ["Admin", "SuperAdmin"]),
        "is_superadmin":  "SuperAdmin" in nomi_ruoli,
        "role":           nomi_ruoli[0] if nomi_ruoli else "User",
    }


# ─────────────────────────────────────────────
# LOGIN
# ─────────────────────────────────────────────

@router.post("/token")
def login(
    response: Response,
    request:  Request,
    form:     OAuth2PasswordRequestForm = Depends(),
    db:       Session = Depends(get_db),
):
    from app.models.rag_models import Utente

    ip = request.client.host if request.client else None

    user = db.query(Utente).filter(Utente.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        logger.warning(f"Login fallito: {form.username}")
        _log(db, None, "login",
             {"email": form.username, "motivo": "credenziali errate"}, ip, esito="error")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o password non corretti.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    profile     = _user_dict(user, db)
    permissions = resolve_permissions(user.utente_id, db)

    access_token = create_access_token({
        "sub":           user.email,
        "is_admin":      profile["is_admin"],
        "is_superadmin": profile["is_superadmin"],
        "role":          profile["role"],
        "permissions":   permissions,
    })

    refresh_token = generate_refresh_token()
    save_refresh_token(db=db, utente_id=user.utente_id, token=refresh_token,
                       ip_address=ip, user_agent=request.headers.get("user-agent"))
    set_refresh_cookie(response, refresh_token)

    _log(db, user.utente_id, "login",
         {"email": user.email, "ruolo": profile["role"],
          "n_permessi": len(permissions)}, ip)

    logger.info(f"Login OK: {user.email} [{profile['role']}] ({len(permissions)} permessi)")
    return {
        "access_token": access_token,
        "token_type":   "bearer",
        "user":         profile,
        "permissions":  permissions,
    }


# ─────────────────────────────────────────────
# REFRESH
# ─────────────────────────────────────────────

@router.post("/refresh")
def refresh_token_endpoint(
    request:  Request,
    response: Response,
    db:       Session = Depends(get_db),
):
    from app.models.rag_models import Utente

    token = get_refresh_token_from_cookie(request)
    if not token:
        raise HTTPException(status_code=401, detail="Nessun refresh token. Effettua il login.")

    rt   = verify_refresh_token(db, token)
    user = db.query(Utente).filter(Utente.utente_id == rt.utente_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato.")

    rt.revocato = True
    db.commit()

    profile     = _user_dict(user, db)
    permissions = resolve_permissions(user.utente_id, db)

    new_access = create_access_token({
        "sub":           user.email,
        "is_admin":      profile["is_admin"],
        "is_superadmin": profile["is_superadmin"],
        "role":          profile["role"],
        "permissions":   permissions,
    })

    new_refresh = generate_refresh_token()
    save_refresh_token(db=db, utente_id=user.utente_id, token=new_refresh,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent"))
    set_refresh_cookie(response, new_refresh)

    return {
        "access_token": new_access,
        "token_type":   "bearer",
        "permissions":  permissions,
    }


# ─────────────────────────────────────────────
# LOGOUT
# ─────────────────────────────────────────────

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    ip    = request.client.host if request.client else None
    token = get_refresh_token_from_cookie(request)

    utente_id = None
    if token:
        try:
            from app.models.rag_models import RefreshToken
            from app.services.auth_service import hash_refresh_token
            rt = db.query(RefreshToken).filter_by(
                token_hash=hash_refresh_token(token), revocato=False).first()
            if rt:
                utente_id = rt.utente_id
        except Exception:
            pass
        revoke_refresh_token(db, token)

    clear_refresh_cookie(response)
    _log(db, utente_id, "logout", {}, ip)
    return {"status": "ok", "message": "Logout effettuato."}


@router.post("/logout-all")
def logout_all(request: Request, response: Response,
               current_user=Depends(get_current_user), db: Session=Depends(get_db)):
    count = revoke_all_refresh_tokens(db, current_user.utente_id)
    clear_refresh_cookie(response)
    ip = request.client.host if request.client else None
    _log(db, current_user.utente_id, "logout",
         {"tipo": "logout_all", "sessioni_terminate": count}, ip)
    return {"status": "ok", "message": f"Disconnesso da {count} device."}


# ─────────────────────────────────────────────
# PROFILO E CAMBIO PASSWORD
# ─────────────────────────────────────────────

@router.get("/me")
def get_me(current_user=Depends(get_current_user), db: Session=Depends(get_db)):
    return _user_dict(current_user, db)


@router.put("/me/password")
def change_password(request: Request, response: Response,
                    body: ChangePasswordRequest,
                    current_user=Depends(get_current_user),
                    db: Session=Depends(get_db)):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(400, detail="La password attuale non è corretta.")
    if body.current_password == body.new_password:
        raise HTTPException(400, detail="La nuova password deve essere diversa.")

    current_user.password_hash = hash_password(body.new_password)
    db.commit()
    count = revoke_all_refresh_tokens(db, current_user.utente_id)
    clear_refresh_cookie(response)

    ip = request.client.host if request.client else None
    _log(db, current_user.utente_id, "password_changed",
         {"sessioni_terminate": count}, ip)
    return {"status": "ok", "message": f"Password aggiornata. {count} sessioni terminate."}


# ─────────────────────────────────────────────
# GESTIONE UTENTI (Admin+) — con OWNERSHIP
# ─────────────────────────────────────────────

@router.get("/users")
def list_users(
    admin=Depends(require_permission("user_view")),
    db: Session=Depends(get_db),
):
    """
    SuperAdmin → vede tutti gli utenti.
    Admin → vede solo gli User che ha creato lui.
    """
    from app.models.rag_models import Utente
    scope = get_admin_scope(admin, db)

    if scope["owner_filter"] is not None:
        # Admin: solo i suoi User (creato_da = admin.utente_id)
        users = (
            db.query(Utente)
            .filter(Utente.creato_da == scope["owner_filter"])
            .order_by(Utente.data_creazione.desc())
            .all()
        )
    else:
        # SuperAdmin: tutti
        users = db.query(Utente).order_by(Utente.data_creazione.desc()).all()

    return {"users": [_user_dict(u, db) for u in users]}


@router.post("/users", status_code=201)
def create_user(
    request: Request,
    body: CreateUserRequest,
    admin=Depends(require_permission("user_create")),
    db: Session=Depends(get_db),
):
    """
    SuperAdmin → può creare Admin e User.
    Admin → può creare solo User (ruolo forzato a 'User').
    Il nuovo utente viene registrato con creato_da = admin.utente_id.
    """
    from app.models.rag_models import Utente, Ruolo, Utente_Ruolo

    scope = get_admin_scope(admin, db)

    # Admin non-Super può creare solo User
    ruolo_richiesto = body.ruolo
    if scope["owner_filter"] is not None:
        if ruolo_richiesto in ["Admin", "SuperAdmin"]:
            raise HTTPException(
                status_code=403,
                detail="Un Admin può creare solo utenti con ruolo User."
            )
        ruolo_richiesto = "User"  # forza

    if db.query(Utente).filter(Utente.email == body.email).first():
        raise HTTPException(409, detail=f"Email '{body.email}' già registrata.")

    ruolo = db.query(Ruolo).filter(Ruolo.nome_ruolo == ruolo_richiesto).first()
    if not ruolo:
        raise HTTPException(400, detail=f"Ruolo '{ruolo_richiesto}' non trovato.")

    new_user = Utente(
        email         = body.email,
        password_hash = hash_password(body.password),
        nome          = body.nome,
        cognome       = body.cognome,
        # Traccia chi ha creato l'utente
        creato_da     = admin.utente_id,
    )
    db.add(new_user)
    db.flush()
    db.add(Utente_Ruolo(utente_id=new_user.utente_id, ruolo_id=ruolo.ruolo_id))
    db.commit()

    ip = request.client.host if request.client else None
    _log(db, admin.utente_id, "user_created",
         {"target_email": body.email, "ruolo": ruolo_richiesto, "creato_da": admin.utente_id}, ip)

    return {"status": "created", "user": _user_dict(new_user, db)}


@router.put("/users/{utente_id}")
def update_user(
    utente_id: int,
    request: Request,
    body: UpdateUserRequest,
    admin=Depends(require_permission("user_update")),
    db: Session=Depends(get_db),
):
    """
    SuperAdmin → può modificare chiunque e cambiare qualsiasi ruolo.
    Admin → può modificare solo gli User creati da lui; non può cambiare il ruolo in Admin/SuperAdmin.
    """
    from app.models.rag_models import Utente, Ruolo, Utente_Ruolo

    # ── OWNERSHIP CHECK ──────────────────────────
    require_user_owner(utente_id, admin, db)
    # ─────────────────────────────────────────────

    user = db.query(Utente).filter(Utente.utente_id == utente_id).first()
    if not user:
        raise HTTPException(404, detail="Utente non trovato.")

    if body.nome    is not None: user.nome    = body.nome
    if body.cognome is not None: user.cognome = body.cognome

    if body.ruolo is not None:
        # Admin non-Super non può promuovere a ruoli elevati
        scope = get_admin_scope(admin, db)
        if scope["owner_filter"] is not None and body.ruolo in ["Admin", "SuperAdmin"]:
            raise HTTPException(
                status_code=403,
                detail="Non puoi assegnare ruoli Admin o SuperAdmin."
            )

        ruolo = db.query(Ruolo).filter(Ruolo.nome_ruolo == body.ruolo).first()
        if not ruolo:
            raise HTTPException(400, detail=f"Ruolo '{body.ruolo}' non trovato.")
        db.query(Utente_Ruolo).filter(Utente_Ruolo.utente_id == utente_id).delete()
        db.add(Utente_Ruolo(utente_id=utente_id, ruolo_id=ruolo.ruolo_id))

    db.commit()

    ip = request.client.host if request.client else None
    _log(db, admin.utente_id, "user_updated",
         {"target_email": user.email, "nuovo_ruolo": body.ruolo}, ip)
    return {"status": "ok", "user": _user_dict(user, db)}


@router.delete("/users/{utente_id}")
def delete_user(
    utente_id: int,
    request: Request,
    admin=Depends(require_permission("user_delete")),
    db: Session=Depends(get_db),
):
    """
    SuperAdmin → può eliminare chiunque (eccetto se stesso).
    Admin → può eliminare solo gli User creati da lui.
    """
    from app.models.rag_models import Utente

    if utente_id == admin.utente_id:
        raise HTTPException(400, detail="Non puoi eliminare il tuo account.")

    # ── OWNERSHIP CHECK ──────────────────────────
    require_user_owner(utente_id, admin, db)
    # ─────────────────────────────────────────────

    user = db.query(Utente).filter(Utente.utente_id == utente_id).first()
    if not user:
        raise HTTPException(404, detail="Utente non trovato.")

    email = user.email
    db.delete(user)
    db.commit()

    ip = request.client.host if request.client else None
    _log(db, admin.utente_id, "user_deleted",
         {"target_email": email, "target_id": utente_id}, ip)
    return {"status": "deleted", "email": email}


# ─────────────────────────────────────────────
# MATRICE PERMESSI — lettura (solo SuperAdmin)
# ─────────────────────────────────────────────

@router.get("/permissions")
def get_permission_matrix(
    admin=Depends(require_permission("user_permissions")),
    db: Session=Depends(get_db),
):
    tutti_permessi = db.execute(_text(
        "SELECT codice_permesso, descrizione FROM Permesso ORDER BY codice_permesso"
    )).fetchall()

    righe = db.execute(_text("""
        SELECT
            utente_id, email, nome, cognome, ruolo,
            codice_permesso, effettivo, fonte
        FROM v_matrice_permessi
        ORDER BY email, codice_permesso
    """)).fetchall()

    utenti_map: dict = {}
    for r in righe:
        uid = r.utente_id
        if uid not in utenti_map:
            utenti_map[uid] = {
                "utente_id": uid,
                "email":     r.email,
                "nome":      r.nome or "",
                "cognome":   r.cognome or "",
                "ruolo":     r.ruolo or "—",
                "permessi":  {},
            }
        utenti_map[uid]["permessi"][r.codice_permesso] = {
            "effettivo": bool(r.effettivo),
            "fonte":     r.fonte,
        }

    return {
        "permessi": [
            {"codice": p.codice_permesso, "descrizione": p.descrizione}
            for p in tutti_permessi
        ],
        "utenti": list(utenti_map.values()),
    }


@router.get("/permissions/codici")
def get_all_permission_codes(
    _=Depends(require_permission("user_permissions")),
    db: Session=Depends(get_db),
):
    rows = db.execute(_text(
        "SELECT codice_permesso, descrizione FROM Permesso ORDER BY codice_permesso"
    )).fetchall()
    return {"permessi": [{"codice": r.codice_permesso, "descrizione": r.descrizione} for r in rows]}


# ─────────────────────────────────────────────
# MATRICE PERMESSI — scrittura override (solo SuperAdmin)
# ─────────────────────────────────────────────

@router.put("/permissions/{utente_id}")
def set_user_permission_override(
    utente_id: int,
    request:   Request,
    body:      PermessoOverrideRequest,
    admin      = Depends(require_permission("user_permissions")),
    db: Session = Depends(get_db),
):
    from app.models.rag_models import Utente

    user = db.query(Utente).filter(Utente.utente_id == utente_id).first()
    if not user:
        raise HTTPException(404, detail="Utente non trovato.")

    perm = db.execute(_text(
        "SELECT permesso_id FROM Permesso WHERE codice_permesso = :cod"
    ), {"cod": body.codice_permesso}).fetchone()

    if not perm:
        raise HTTPException(404, detail=f"Permesso '{body.codice_permesso}' non trovato.")

    db.execute(_text("""
        INSERT INTO Utente_Permesso (utente_id, permesso_id, concesso, aggiornato_da, aggiornato_il)
        VALUES (:uid, :pid, :concesso, :admin_id, NOW())
        ON CONFLICT (utente_id, permesso_id)
        DO UPDATE SET
            concesso      = EXCLUDED.concesso,
            aggiornato_da = EXCLUDED.aggiornato_da,
            aggiornato_il = NOW()
    """), {
        "uid":      utente_id,
        "pid":      perm.permesso_id,
        "concesso": body.concesso,
        "admin_id": admin.utente_id,
    })
    db.commit()

    revoke_all_refresh_tokens(db, utente_id)

    ip = request.client.host if request.client else None
    _log(db, admin.utente_id, "permission_changed", {
        "target_id":        utente_id,
        "target_email":     user.email,
        "codice_permesso":  body.codice_permesso,
        "concesso":         body.concesso,
        "tipo":             "override",
    }, ip)

    return {
        "status":           "ok",
        "utente_id":        utente_id,
        "codice_permesso":  body.codice_permesso,
        "concesso":         body.concesso,
        "note":             "Sessioni utente revocate. Il nuovo JWT verrà emesso al prossimo refresh.",
    }


@router.put("/permissions/{utente_id}/bulk")
def set_user_permissions_bulk(
    utente_id: int,
    request:   Request,
    body:      BulkPermessoRequest,
    admin      = Depends(require_permission("user_permissions")),
    db: Session = Depends(get_db),
):
    from app.models.rag_models import Utente

    user = db.query(Utente).filter(Utente.utente_id == utente_id).first()
    if not user:
        raise HTTPException(404, detail="Utente non trovato.")

    modificati = 0
    for item in body.overrides:
        codice   = item.get("codice_permesso")
        concesso = item.get("concesso")

        perm = db.execute(_text(
            "SELECT permesso_id FROM Permesso WHERE codice_permesso = :cod"
        ), {"cod": codice}).fetchone()
        if not perm:
            continue

        if concesso is None:
            db.execute(_text(
                "DELETE FROM Utente_Permesso WHERE utente_id=:uid AND permesso_id=:pid"
            ), {"uid": utente_id, "pid": perm.permesso_id})
        else:
            db.execute(_text("""
                INSERT INTO Utente_Permesso
                    (utente_id, permesso_id, concesso, aggiornato_da, aggiornato_il)
                VALUES (:uid, :pid, :concesso, :admin_id, NOW())
                ON CONFLICT (utente_id, permesso_id)
                DO UPDATE SET
                    concesso      = EXCLUDED.concesso,
                    aggiornato_da = EXCLUDED.aggiornato_da,
                    aggiornato_il = NOW()
            """), {"uid": utente_id, "pid": perm.permesso_id,
                   "concesso": concesso, "admin_id": admin.utente_id})
        modificati += 1

    db.commit()
    revoke_all_refresh_tokens(db, utente_id)

    ip = request.client.host if request.client else None
    _log(db, admin.utente_id, "permission_changed", {
        "target_id":    utente_id,
        "target_email": user.email,
        "modificati":   modificati,
        "tipo":         "bulk",
    }, ip)

    return {
        "status":    "ok",
        "utente_id": utente_id,
        "modificati": modificati,
        "note":      "Sessioni utente revocate. Il nuovo JWT verrà emesso al prossimo refresh.",
    }


@router.delete("/permissions/{utente_id}/{codice_permesso}")
def remove_user_permission_override(
    utente_id:       int,
    codice_permesso: str,
    request:         Request,
    admin            = Depends(require_permission("user_permissions")),
    db: Session      = Depends(get_db),
):
    perm = db.execute(_text(
        "SELECT permesso_id FROM Permesso WHERE codice_permesso = :cod"
    ), {"cod": codice_permesso}).fetchone()

    if not perm:
        raise HTTPException(404, detail=f"Permesso '{codice_permesso}' non trovato.")

    db.execute(_text(
        "DELETE FROM Utente_Permesso WHERE utente_id=:uid AND permesso_id=:pid"
    ), {"uid": utente_id, "pid": perm.permesso_id})
    db.commit()

    revoke_all_refresh_tokens(db, utente_id)

    ip = request.client.host if request.client else None
    _log(db, admin.utente_id, "permission_changed", {
        "target_id":       utente_id,
        "codice_permesso": codice_permesso,
        "tipo":            "remove_override",
    }, ip)

    return {"status": "ok", "rimosso": codice_permesso}