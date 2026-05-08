# # app/services/chat_history_service.py
# """
# ChatHistoryService
# ==================
# Gestisce la persistenza delle sessioni chat su PostgreSQL.

# RESPONSABILITÀ:
#   - Creare/aggiornare Chat_Sessione ad ogni messaggio
#   - Salvare ogni coppia (domanda, risposta) in Log_Risposta
#   - Esporre metodi per il recupero (storico utente, audit admin)

# DESIGN:
#   - Ogni operazione usa una propria sessione DB (non quella della request)
#     per evitare che un errore di salvataggio blocchi la risposta all'utente.
#   - I fallimenti sono loggati ma NON rilanciati: la chat funziona anche
#     se il DB è temporaneamente irraggiungibile.
#   - session_uuid è il session_id stringa generato dal frontend React
#     (es: "session_abc123"). È l'unica chiave di correlazione tra frontend e DB.
# """

# import logging
# import datetime
# from typing import Optional

# logger = logging.getLogger(__name__)


# # ─────────────────────────────────────────────
# # HELPER: sessione DB isolata
# # ─────────────────────────────────────────────

# def _get_db():
#     from app.db.session import SessionLocal
#     return SessionLocal()


# # ─────────────────────────────────────────────
# # UPSERT Chat_Sessione
# # ─────────────────────────────────────────────

# def _upsert_sessione(
#     db,
#     session_uuid: str,
#     utente_id: Optional[int],
#     prima_domanda: Optional[str],
#     ip_address: Optional[str] = None,
#     user_agent: Optional[str] = None,
# ) -> Optional[int]:
#     """
#     Crea la sessione se non esiste, altrimenti aggiorna aggiornata_il e n_messaggi.
#     Restituisce il sessione_id (integer PK) o None in caso di errore.
#     """
#     from sqlalchemy import text

#     titolo = None
#     if prima_domanda:
#         titolo = prima_domanda[:120].strip()

#     try:
#         result = db.execute(text("""
#             INSERT INTO Chat_Sessione
#                 (session_uuid, utente_id, titolo, ip_address, user_agent,
#                  creata_il, aggiornata_il, n_messaggi)
#             VALUES
#                 (:uuid, :uid, :titolo, CAST(:ip AS inet), :ua,
#                  NOW(), NOW(), 1)
#             ON CONFLICT (session_uuid) DO UPDATE SET
#                 aggiornata_il = NOW(),
#                 n_messaggi    = Chat_Sessione.n_messaggi + 1,
#                 -- Aggiorna titolo solo se era NULL (prima domanda)
#                 titolo        = COALESCE(Chat_Sessione.titolo, EXCLUDED.titolo),
#                 utente_id     = COALESCE(Chat_Sessione.utente_id, EXCLUDED.utente_id)
#             RETURNING sessione_id
#         """), {
#             "uuid":   session_uuid,
#             "uid":    utente_id,
#             "titolo": titolo,
#             "ip":     ip_address,
#             "ua":     user_agent,
#         })
#         db.commit()
#         row = result.fetchone()
#         return row.sessione_id if row else None

#     except Exception as e:
#         logger.error(f"[chat_history] upsert sessione fallito: {e}")
#         try:
#             db.rollback()
#         except Exception:
#             pass
#         return None


# # ─────────────────────────────────────────────
# # SALVATAGGIO MESSAGGIO
# # ─────────────────────────────────────────────

# def salva_messaggio(
#     session_uuid: str,
#     utente_id: Optional[int],
#     domanda: str,
#     risposta: str,
#     source_docs: list,
#     tempo_ms: Optional[int] = None,
#     tipo_risposta: str = "content",
#     bloccato: bool = False,
#     ip_address: Optional[str] = None,
#     user_agent: Optional[str] = None,
# ) -> Optional[int]:
#     """
#     Salva una coppia domanda/risposta.

#     - Crea o aggiorna Chat_Sessione
#     - Inserisce in Log_Risposta con metadati RAG

#     Questa funzione è fire-and-forget: gli errori vengono loggati
#     ma non propagati al chiamante (la risposta chat non deve fallire
#     per un problema di persistenza).

#     Args:
#         session_uuid:   ID sessione dal frontend (es. "session_abc123")
#         utente_id:      PK dell'utente autenticato
#         domanda:        testo della domanda originale
#         risposta:       testo della risposta generata dall'LLM
#         source_docs:    lista di Document LangChain usati come contesto
#         tempo_ms:       latenza end-to-end in millisecondi
#         tipo_risposta:  'content' | 'courtesy' | 'not_found' | 'blocked'
#         bloccato:       True se la risposta è stata bloccata dal guard
#         ip_address:     IP del client (da Request)
#         user_agent:     User-Agent del client
#     """
#     from sqlalchemy import text
#     import json

#     db = _get_db()
#     try:
#         # 1. Upsert sessione
#         sessione_id = _upsert_sessione(
#             db            = db,
#             session_uuid  = session_uuid,
#             utente_id     = utente_id,
#             prima_domanda = domanda,
#             ip_address    = ip_address,
#             user_agent    = user_agent,
#         )

#         # 2. Estrai documento_ids dai metadati dei chunk
#         documento_ids: list[int] = []
#         seen: set[int] = set()
#         for doc in (source_docs or []):
#             raw = doc.metadata.get("documento_id", None)
#             if raw:
#                 try:
#                     did = int(raw)
#                     if did not in seen:
#                         seen.add(did)
#                         documento_ids.append(did)
#                 except (ValueError, TypeError):
#                     pass

#         n_chunk = len(source_docs) if source_docs else 0

#         # 3. Inserisci in Log_Risposta
#         result = db.execute(text("""
#             INSERT INTO Log_Risposta (
#                 utente_id, sessione_id, session_id,
#                 testo_domanda, testo_risposta,
#                 tempo_risposta_ms, tipo_risposta, bloccato,
#                 n_chunk_recuperati, documento_ids,
#                 timestamp_query
#             ) VALUES (
#                 :uid, :sid, :suuid,
#                 :domanda, :risposta,
#                 :ms, :tipo, :bloccato,
#                 :n_chunk, :doc_ids,
#                 NOW()
#             )
#             RETURNING log_id
#         """), {
#             "uid":      utente_id,
#             "sid":      sessione_id,
#             "suuid":    session_uuid,
#             "domanda":  domanda,
#             "risposta": risposta,
#             "ms":       tempo_ms,
#             "tipo":     tipo_risposta,
#             "bloccato": bloccato,
#             "n_chunk":  n_chunk,
#             "doc_ids":  documento_ids if documento_ids else [],
#         })
#         db.commit()

#         row = result.fetchone()
#         log_id = row.log_id if row else None

#         logger.debug(
#             f"[chat_history] salvato: sessione={session_uuid} "
#             f"tipo={tipo_risposta} docs={documento_ids}"
#         )

#         return log_id       

#     except Exception as e:
#         logger.error(f"[chat_history] salva_messaggio fallito: {e}")
#         try:
#             db.rollback()
#         except Exception:
#             pass
#         return None
#     finally:
#         db.close()


# # ─────────────────────────────────────────────
# # RECUPERO: sessioni utente (per la sidebar)
# # ─────────────────────────────────────────────

# def get_sessioni_utente(
#     utente_id: int,
#     limit: int = 20,
#     include_archiviate: bool = False,
# ) -> list[dict]:
#     """
#     Restituisce le ultime N sessioni dell'utente per popolare la sidebar.
#     Ordinate dalla più recente alla più vecchia.
#     """
#     from sqlalchemy import text

#     db = _get_db()
#     try:
#         where_arch = "" if include_archiviate else "AND is_archiviata = FALSE"
#         rows = db.execute(text(f"""
#             SELECT
#                 sessione_id, session_uuid, titolo,
#                 creata_il, aggiornata_il, n_messaggi,
#                 is_archiviata
#             FROM Chat_Sessione
#             WHERE utente_id = :uid
#               {where_arch}
#             ORDER BY aggiornata_il DESC
#             LIMIT :lim
#         """), {"uid": utente_id, "lim": limit}).fetchall()

#         return [
#             {
#                 "sessione_id":   r.sessione_id,
#                 "session_uuid":  r.session_uuid,
#                 "titolo":        r.titolo or "Conversazione",
#                 "creata_il":     r.creata_il.isoformat() if r.creata_il else None,
#                 "aggiornata_il": r.aggiornata_il.isoformat() if r.aggiornata_il else None,
#                 "n_messaggi":    r.n_messaggi,
#                 "is_archiviata": r.is_archiviata,
#             }
#             for r in rows
#         ]

#     except Exception as e:
#         logger.error(f"[chat_history] get_sessioni_utente fallito: {e}")
#         return []
#     finally:
#         db.close()


# # ─────────────────────────────────────────────
# # RECUPERO: dettaglio singola sessione (messaggi)
# # ─────────────────────────────────────────────

# def get_messaggi_sessione(
#     session_uuid: str,
#     utente_id_richiedente: Optional[int] = None,
#     is_admin: bool = False,
# ) -> Optional[dict]:
#     """
#     Restituisce i messaggi di una sessione.

#     Controllo accesso:
#       - Admin/SuperAdmin: accesso a qualsiasi sessione
#       - User: accesso solo alle proprie sessioni (utente_id_richiedente == sessione.utente_id)

#     Restituisce None se la sessione non esiste o l'utente non ha accesso.
#     """
#     from sqlalchemy import text

#     db = _get_db()
#     try:
#         # Verifica esistenza + ownership
#         sess = db.execute(text("""
#             SELECT sessione_id, utente_id, titolo, creata_il, aggiornata_il,
#                    n_messaggi, durata_secondi
#             FROM Chat_Sessione
#             WHERE session_uuid = :uuid
#         """), {"uuid": session_uuid}).fetchone()

#         if not sess:
#             return None

#         # Controllo accesso
#         if not is_admin and sess.utente_id != utente_id_richiedente:
#             return None

#         # Recupera messaggi dalla view
#         messaggi = db.execute(text("""
#             SELECT
#                 log_id, testo_domanda, testo_risposta,
#                 tempo_risposta_ms, timestamp_query,
#                 feedback_csat, bloccato, tipo_risposta,
#                 n_chunk_recuperati, documento_ids,
#                 documenti_dettaglio
#             FROM v_chat_messaggi
#             WHERE sessione_id = :sid
#             ORDER BY timestamp_query ASC
#         """), {"sid": sess.sessione_id}).fetchall()

#         return {
#             "sessione_id":    sess.sessione_id,
#             "session_uuid":   session_uuid,
#             "titolo":         sess.titolo or "Conversazione",
#             "creata_il":      sess.creata_il.isoformat() if sess.creata_il else None,
#             "aggiornata_il":  sess.aggiornata_il.isoformat() if sess.aggiornata_il else None,
#             "n_messaggi":     sess.n_messaggi,
#             "durata_secondi": sess.durata_secondi,
#             "messaggi": [
#                 {
#                     "log_id":             r.log_id,
#                     "domanda":            r.testo_domanda,
#                     "risposta":           r.testo_risposta,
#                     "latency_ms":         r.tempo_risposta_ms,
#                     "timestamp":          r.timestamp_query.isoformat() if r.timestamp_query else None,
#                     "feedback_csat":      r.feedback_csat,
#                     "bloccato":           r.bloccato,
#                     "tipo_risposta":      r.tipo_risposta,
#                     "n_chunk":            r.n_chunk_recuperati,
#                     "documento_ids":      r.documento_ids or [],
#                     "documenti":          r.documenti_dettaglio or [],
#                 }
#                 for r in messaggi
#             ],
#         }

#     except Exception as e:
#         logger.error(f"[chat_history] get_messaggi_sessione fallito: {e}")
#         return None
#     finally:
#         db.close()


# # ─────────────────────────────────────────────
# # RECUPERO: audit admin (lista sessioni con filtri)
# # ─────────────────────────────────────────────

# def get_audit_sessioni(
#     page: int = 0,
#     page_size: int = 30,
#     utente_filter: str = "",
#     data_da: Optional[str] = None,
#     data_a: Optional[str] = None,
#     tipo_filter: str = "",
#     solo_bloccate: bool = False,
#     owner_filter: Optional[int] = None,  # per admin non-super
# ) -> dict:
#     """
#     Lista sessioni paginata per il pannello audit admin.

#     Args:
#         page, page_size: paginazione
#         utente_filter:  filtra per email/nome utente (LIKE)
#         data_da, data_a: range date ISO (YYYY-MM-DD)
#         tipo_filter:    filtra sessioni che contengono messaggi di quel tipo
#         solo_bloccate:  mostra solo sessioni con almeno un messaggio bloccato
#         owner_filter:   se non None, mostra solo le sessioni degli utenti
#                         creati da questo Admin (ownership)
#     """
#     from sqlalchemy import text

#     db = _get_db()
#     try:
#         conditions = ["1=1"]
#         params: dict = {"limit": page_size, "offset": page * page_size}

#         if utente_filter:
#             conditions.append(
#                 "(LOWER(utente_email) LIKE :uf "
#                 "OR LOWER(utente_nome) LIKE :uf "
#                 "OR LOWER(utente_cognome) LIKE :uf)"
#             )
#             params["uf"] = f"%{utente_filter.lower()}%"

#         if data_da:
#             conditions.append("creata_il >= :data_da")
#             params["data_da"] = data_da

#         if data_a:
#             conditions.append("creata_il <= :data_a::date + interval '1 day'")
#             params["data_a"] = data_a

#         if solo_bloccate:
#             conditions.append("n_bloccati > 0")

#         # Ownership filter: mostra solo sessioni di utenti creati da owner_filter
#         if owner_filter is not None:
#             conditions.append("""
#                 utente_id IN (
#                     SELECT utente_id FROM Utente
#                     WHERE creato_da = :owner_filter OR utente_id = :owner_filter
#                 )
#             """)
#             params["owner_filter"] = owner_filter

#         where = "WHERE " + " AND ".join(conditions)

#         total = db.execute(text(
#             f"SELECT COUNT(*) FROM v_chat_audit {where}"
#         ), params).scalar() or 0

#         rows = db.execute(text(f"""
#             SELECT *
#             FROM v_chat_audit
#             {where}
#             ORDER BY aggiornata_il DESC
#             LIMIT :limit OFFSET :offset
#         """), params).fetchall()

#         sessioni = [
#             {
#                 "sessione_id":     r.sessione_id,
#                 "session_uuid":    r.session_uuid,
#                 "titolo":          r.titolo or "Conversazione",
#                 "creata_il":       r.creata_il.isoformat() if r.creata_il else None,
#                 "aggiornata_il":   r.aggiornata_il.isoformat() if r.aggiornata_il else None,
#                 "n_messaggi":      r.n_messaggi,
#                 "n_log_risposta":  r.n_log_risposta,
#                 "n_bloccati":      r.n_bloccati,
#                 "n_not_found":     r.n_not_found,
#                 "avg_latency_ms":  r.avg_latency_ms,
#                 "n_documenti_unici": r.n_documenti_unici,
#                 "durata_secondi":  r.durata_secondi,
#                 "is_archiviata":   r.is_archiviata,
#                 "ip_address":      r.ip_address,
#                 "utente_id":       r.utente_id,
#                 "utente_email":    r.utente_email,
#                 "utente_nome":     r.utente_nome,
#                 "utente_cognome":  r.utente_cognome,
#             }
#             for r in rows
#         ]

#         return {
#             "sessioni":  sessioni,
#             "total":     total,
#             "page":      page,
#             "page_size": page_size,
#         }

#     except Exception as e:
#         logger.error(f"[chat_history] get_audit_sessioni fallito: {e}")
#         return {"sessioni": [], "total": 0, "page": page, "page_size": page_size}
#     finally:
#         db.close()


# # ─────────────────────────────────────────────
# # AZIONI UTENTE: archivia / feedback
# # ─────────────────────────────────────────────

# def archivia_sessione(session_uuid: str, utente_id: int) -> bool:
#     """Archivia (soft-delete) una sessione dell'utente."""
#     from sqlalchemy import text

#     db = _get_db()
#     try:
#         result = db.execute(text("""
#             UPDATE Chat_Sessione
#             SET is_archiviata = TRUE
#             WHERE session_uuid = :uuid AND utente_id = :uid
#         """), {"uuid": session_uuid, "uid": utente_id})
#         db.commit()
#         return result.rowcount > 0
#     except Exception as e:
#         logger.error(f"[chat_history] archivia_sessione fallito: {e}")
#         try:
#             db.rollback()
#         except Exception:
#             pass
#         return False
#     finally:
#         db.close()


# def salva_feedback(log_id: int, utente_id: int, csat: int) -> bool:
#     """
#     Salva il feedback CSAT (1-5) su un messaggio.
#     Verifica che il log appartenga all'utente prima di aggiornare.
#     """
#     from sqlalchemy import text

#     if not 1 <= csat <= 5:
#         return False

#     db = _get_db()
#     try:
#         result = db.execute(text("""
#             UPDATE Log_Risposta lr
#             SET feedback_csat = :csat
#             FROM Chat_Sessione cs
#             WHERE lr.log_id = :lid
#               AND lr.sessione_id = cs.sessione_id
#               AND cs.utente_id = :uid
#         """), {"lid": log_id, "uid": utente_id, "csat": csat})
#         db.commit()
#         return result.rowcount > 0
#     except Exception as e:
#         logger.error(f"[chat_history] salva_feedback fallito: {e}")
#         try:
#             db.rollback()
#         except Exception:
#             pass
#         return False
#     finally:
#         db.close()




# app/services/chat_history_service.py
"""
ChatHistoryService
==================
Gestisce la persistenza delle sessioni chat su PostgreSQL.

RESPONSABILITÀ:
  - Creare/aggiornare Chat_Sessione ad ogni messaggio
  - Salvare ogni coppia (domanda, risposta) in Log_Risposta
  - Esporre metodi per il recupero (storico utente, audit admin)
  - Ricaricare il contesto di una sessione precedente (load_session_context)

DESIGN:
  - Ogni operazione usa una propria sessione DB (non quella della request)
    per evitare che un errore di salvataggio blocchi la risposta all'utente.
  - I fallimenti sono loggati ma NON rilanciati: la chat funziona anche
    se il DB è temporaneamente irraggiungibile.
  - session_uuid è il session_id stringa generato dal frontend React
    (es: "session_abc123"). È l'unica chiave di correlazione tra frontend e DB.
"""

import logging
import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Numero massimo di messaggi recenti da ricaricare come HumanMessage/AIMessage
# Il resto viene condensato nel summary. Allineato con MAX_HISTORY_MSGS del chain.
MAX_MESSAGES_RELOAD = 10


# ─────────────────────────────────────────────
# HELPER: sessione DB isolata
# ─────────────────────────────────────────────

def _get_db():
    from app.db.session import SessionLocal
    return SessionLocal()


# ─────────────────────────────────────────────
# UPSERT Chat_Sessione
# ─────────────────────────────────────────────

def _upsert_sessione(
    db,
    session_uuid: str,
    utente_id: Optional[int],
    prima_domanda: Optional[str],
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[int]:
    """
    Crea la sessione se non esiste, altrimenti aggiorna aggiornata_il e n_messaggi.
    Restituisce il sessione_id (integer PK) o None in caso di errore.
    """
    from sqlalchemy import text

    titolo = None
    if prima_domanda:
        titolo = prima_domanda[:120].strip()

    try:
        result = db.execute(text("""
            INSERT INTO Chat_Sessione
                (session_uuid, utente_id, titolo, ip_address, user_agent,
                 creata_il, aggiornata_il, n_messaggi)
            VALUES
                (:uuid, :uid, :titolo, CAST(:ip AS inet), :ua,
                 NOW(), NOW(), 1)
            ON CONFLICT (session_uuid) DO UPDATE SET
                aggiornata_il = NOW(),
                n_messaggi    = Chat_Sessione.n_messaggi + 1,
                -- Aggiorna titolo solo se era NULL (prima domanda)
                titolo        = COALESCE(Chat_Sessione.titolo, EXCLUDED.titolo),
                utente_id     = COALESCE(Chat_Sessione.utente_id, EXCLUDED.utente_id)
            RETURNING sessione_id
        """), {
            "uuid":   session_uuid,
            "uid":    utente_id,
            "titolo": titolo,
            "ip":     ip_address,
            "ua":     user_agent,
        })
        db.commit()
        row = result.fetchone()
        return row.sessione_id if row else None

    except Exception as e:
        logger.error(f"[chat_history] upsert sessione fallito: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return None


# ─────────────────────────────────────────────
# CARICAMENTO CONTESTO SESSIONE PRECEDENTE
# ─────────────────────────────────────────────

def load_session_context(session_uuid: str, utente_id: int) -> dict:
    """
    Ricostruisce il contesto di una sessione precedente per LangGraph.

    Strategia ibrida:
      - Prende i messaggi ordinati per timestamp ASC dal DB
      - Gli ultimi MAX_MESSAGES_RELOAD vengono convertiti in
        HumanMessage/AIMessage (history reale per il chain)
      - I messaggi più vecchi vengono condensati in un summary testuale
        (conversation_summary) per non superare la finestra di contesto

    Args:
        session_uuid: UUID della sessione da ripristinare
        utente_id:    PK dell'utente che sta facendo la richiesta
                      (usato per il controllo di ownership)

    Returns:
        {
            "history": List[HumanMessage | AIMessage],  # ultimi N messaggi
            "summary": str,                             # riassunto dei precedenti
            "found":   bool,                            # True se la sessione esiste
            "n_total": int,                             # numero totale messaggi nel DB
        }

    In caso di errore o sessione non trovata restituisce un contesto vuoto
    con found=False, senza mai propagare l'eccezione al chiamante.
    """
    from sqlalchemy import text
    from langchain_core.messages import HumanMessage, AIMessage

    empty = {"history": [], "summary": "", "found": False, "n_total": 0}

    db = _get_db()
    try:
        # ── 1. Verifica ownership ──────────────────────────────
        sess = db.execute(text("""
            SELECT sessione_id, utente_id
            FROM Chat_Sessione
            WHERE session_uuid = :uuid
              AND is_archiviata = FALSE
        """), {"uuid": session_uuid}).fetchone()

        if not sess:
            logger.debug(f"[load_session_context] sessione non trovata: {session_uuid}")
            return empty

        # Un utente può caricare SOLO le proprie sessioni
        if sess.utente_id != utente_id:
            logger.warning(
                f"[load_session_context] ownership mismatch: "
                f"sessione.utente_id={sess.utente_id} != richiedente={utente_id}"
            )
            return empty

        # ── 2. Recupera TUTTI i messaggi in ordine cronologico ─
        rows = db.execute(text("""
            SELECT
                testo_domanda,
                testo_risposta,
                tipo_risposta,
                timestamp_query
            FROM Log_Risposta
            WHERE sessione_id = :sid
              AND bloccato = FALSE          -- non ricaricare messaggi bloccati
              AND testo_risposta IS NOT NULL
            ORDER BY timestamp_query ASC
        """), {"sid": sess.sessione_id}).fetchall()

        if not rows:
            return {**empty, "found": True}

        n_total = len(rows)

        # ── 3. Splitta: vecchi (→ summary) + recenti (→ history) ─
        if n_total <= MAX_MESSAGES_RELOAD:
            # Tutti entrano come history, nessun summary da vecchi messaggi
            old_rows    = []
            recent_rows = list(rows)
        else:
            split       = n_total - MAX_MESSAGES_RELOAD
            old_rows    = list(rows[:split])
            recent_rows = list(rows[split:])

        # ── 4. Costruisci summary dai messaggi vecchi ──────────
        summary = ""
        if old_rows:
            # Formato compatto: "U: domanda\nA: risposta (troncata)"
            parts = []
            for r in old_rows:
                domanda  = (r.testo_domanda or "").strip()[:200]
                risposta = (r.testo_risposta or "").strip()[:300]
                if domanda and risposta:
                    parts.append(f"Utente: {domanda}\nAssistente: {risposta}")

            if parts:
                summary = (
                    f"[Riassunto dei {len(old_rows)} messaggi precedenti]\n"
                    + "\n---\n".join(parts)
                )

        # ── 5. Converti messaggi recenti in LangChain messages ──
        history = []
        for r in recent_rows:
            domanda  = (r.testo_domanda  or "").strip()
            risposta = (r.testo_risposta or "").strip()
            if domanda:
                history.append(HumanMessage(content=domanda))
            if risposta:
                history.append(AIMessage(content=risposta))

        logger.info(
            f"[load_session_context] sessione={session_uuid} "
            f"totale={n_total} history={len(history)//2} summary_msgs={len(old_rows)}"
        )

        return {
            "history": history,
            "summary": summary,
            "found":   True,
            "n_total": n_total,
        }

    except Exception as e:
        logger.error(f"[load_session_context] errore: {e}")
        return empty
    finally:
        db.close()


# ─────────────────────────────────────────────
# SALVATAGGIO MESSAGGIO
# ─────────────────────────────────────────────

def salva_messaggio(
    session_uuid: str,
    utente_id: Optional[int],
    domanda: str,
    risposta: str,
    source_docs: list,
    tempo_ms: Optional[int] = None,
    tipo_risposta: str = "content",
    bloccato: bool = False,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[int]:
    """
    Salva una coppia domanda/risposta.

    - Crea o aggiorna Chat_Sessione
    - Inserisce in Log_Risposta con metadati RAG

    Questa funzione è fire-and-forget: gli errori vengono loggati
    ma non propagati al chiamante (la risposta chat non deve fallire
    per un problema di persistenza).

    Args:
        session_uuid:   ID sessione dal frontend (es. "session_abc123")
        utente_id:      PK dell'utente autenticato
        domanda:        testo della domanda originale
        risposta:       testo della risposta generata dall'LLM
        source_docs:    lista di Document LangChain usati come contesto
        tempo_ms:       latenza end-to-end in millisecondi
        tipo_risposta:  'content' | 'courtesy' | 'not_found' | 'blocked'
        bloccato:       True se la risposta è stata bloccata dal guard
        ip_address:     IP del client (da Request)
        user_agent:     User-Agent del client
    """
    from sqlalchemy import text
    import json

    db = _get_db()
    try:
        # 1. Upsert sessione
        sessione_id = _upsert_sessione(
            db            = db,
            session_uuid  = session_uuid,
            utente_id     = utente_id,
            prima_domanda = domanda,
            ip_address    = ip_address,
            user_agent    = user_agent,
        )

        # 2. Estrai documento_ids dai metadati dei chunk
        # Già presente nel tuo codice — lascia invariato
        documento_ids: list[int] = []
        seen: set[int] = set()
        for doc in (source_docs or []):
            raw = doc.metadata.get("documento_id", None)
            if raw:
                try:
                    did = int(raw)
                    if did not in seen:
                        seen.add(did)
                        documento_ids.append(did)
                except (ValueError, TypeError):
                    pass

# AGGIUNGI QUESTO BLOCCO SUBITO DOPO
        import re as _re
        sources_json = []
        seen_keys: set = set()
        for doc in (source_docs or []):
            m = doc.metadata
            titolo = m.get("titolo_documento", "")
            link   = m.get("anchor_link", "") or ""
            pagina = str(m.get("pagina", "") or "")
            if not pagina and link:
                mp = _re.search(r'#page=(\d+)', link)
                if mp:
                    pagina = mp.group(1)
            key = (titolo, pagina)
            if key not in seen_keys and titolo:
                seen_keys.add(key)
                sources_json.append({"titolo": titolo, "link": link, "pagina": pagina})

        n_chunk = len(source_docs) if source_docs else 0

        # 3. Inserisci in Log_Risposta
        result = db.execute(text("""
            INSERT INTO Log_Risposta (
                utente_id, sessione_id, session_id,
                testo_domanda, testo_risposta,
                tempo_risposta_ms, tipo_risposta, bloccato,
                n_chunk_recuperati, documento_ids,
                sources_json,
                timestamp_query
            ) VALUES (
                :uid, :sid, :suuid,
                :domanda, :risposta,
                :ms, :tipo, :bloccato,
                :n_chunk, :doc_ids,
                CAST(:sources AS jsonb),
                NOW()
            )
            RETURNING log_id
        """), {
            "uid":      utente_id,
            "sid":      sessione_id,
            "suuid":    session_uuid,
            "domanda":  domanda,
            "risposta": risposta,
            "ms":       tempo_ms,
            "tipo":     tipo_risposta,
            "bloccato": bloccato,
            "n_chunk":  n_chunk,
            "doc_ids":  documento_ids if documento_ids else [],
            "sources":  json.dumps(sources_json),
        })
        db.commit()

        row = result.fetchone()
        log_id = row.log_id if row else None

        logger.debug(
            f"[chat_history] salvato: sessione={session_uuid} "
            f"tipo={tipo_risposta} docs={documento_ids}"
        )

        return log_id       

    except Exception as e:
        logger.error(f"[chat_history] salva_messaggio fallito: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return None
    finally:
        db.close()


# ─────────────────────────────────────────────
# RECUPERO: sessioni utente (per la sidebar)
# ─────────────────────────────────────────────

def get_sessioni_utente(
    utente_id: int,
    limit: int = 20,
    include_archiviate: bool = False,
) -> list[dict]:
    """
    Restituisce le ultime N sessioni dell'utente per popolare la sidebar.
    Ordinate dalla più recente alla più vecchia.
    """
    from sqlalchemy import text

    db = _get_db()
    try:
        where_arch = "" if include_archiviate else "AND is_archiviata = FALSE"
        rows = db.execute(text(f"""
            SELECT
                sessione_id, session_uuid, titolo,
                creata_il, aggiornata_il, n_messaggi,
                is_archiviata
            FROM Chat_Sessione
            WHERE utente_id = :uid
              {where_arch}
            ORDER BY aggiornata_il DESC
            LIMIT :lim
        """), {"uid": utente_id, "lim": limit}).fetchall()

        return [
            {
                "sessione_id":   r.sessione_id,
                "session_uuid":  r.session_uuid,
                "titolo":        r.titolo or "Conversazione",
                "creata_il":     r.creata_il.isoformat() if r.creata_il else None,
                "aggiornata_il": r.aggiornata_il.isoformat() if r.aggiornata_il else None,
                "n_messaggi":    r.n_messaggi,
                "is_archiviata": r.is_archiviata,
            }
            for r in rows
        ]

    except Exception as e:
        logger.error(f"[chat_history] get_sessioni_utente fallito: {e}")
        return []
    finally:
        db.close()


# ─────────────────────────────────────────────
# RECUPERO: dettaglio singola sessione (messaggi)
# ─────────────────────────────────────────────

def get_messaggi_sessione(
    session_uuid: str,
    utente_id_richiedente: Optional[int] = None,
    is_admin: bool = False,
) -> Optional[dict]:
    """
    Restituisce i messaggi di una sessione.

    Controllo accesso:
      - Admin/SuperAdmin: accesso a qualsiasi sessione
      - User: accesso solo alle proprie sessioni (utente_id_richiedente == sessione.utente_id)

    Restituisce None se la sessione non esiste o l'utente non ha accesso.
    """
    from sqlalchemy import text

    db = _get_db()
    try:
        # Verifica esistenza + ownership
        sess = db.execute(text("""
            SELECT sessione_id, utente_id, titolo, creata_il, aggiornata_il,
                   n_messaggi, durata_secondi
            FROM Chat_Sessione
            WHERE session_uuid = :uuid
        """), {"uuid": session_uuid}).fetchone()

        if not sess:
            return None

        # Controllo accesso
        if not is_admin and sess.utente_id != utente_id_richiedente:
            return None

        # Recupera messaggi dalla view
        messaggi = db.execute(text("""
            SELECT
                lr.log_id, lr.testo_domanda, lr.testo_risposta,
                lr.tempo_risposta_ms, lr.timestamp_query,
                lr.feedback_csat, lr.bloccato, lr.tipo_risposta,
                lr.n_chunk_recuperati, lr.documento_ids,
                lr.sources_json,
                vcm.documenti_dettaglio
            FROM Log_Risposta lr
            LEFT JOIN v_chat_messaggi vcm ON vcm.log_id = lr.log_id
            WHERE lr.sessione_id = :sid
            ORDER BY lr.timestamp_query ASC
        """), {"sid": sess.sessione_id}).fetchall()


        return {
            "sessione_id":    sess.sessione_id,
            "session_uuid":   session_uuid,
            "titolo":         sess.titolo or "Conversazione",
            "creata_il":      sess.creata_il.isoformat() if sess.creata_il else None,
            "aggiornata_il":  sess.aggiornata_il.isoformat() if sess.aggiornata_il else None,
            "n_messaggi":     sess.n_messaggi,
            "durata_secondi": sess.durata_secondi,
            "messaggi": [
                {
                    "log_id":             r.log_id,
                    "domanda":            r.testo_domanda,
                    "risposta":           r.testo_risposta,
                    "latency_ms":         r.tempo_risposta_ms,
                    "timestamp":          r.timestamp_query.isoformat() if r.timestamp_query else None,
                    "feedback_csat":      r.feedback_csat,
                    "bloccato":           r.bloccato,
                    "tipo_risposta":      r.tipo_risposta,
                    "n_chunk":            r.n_chunk_recuperati,
                    "documento_ids":      r.documento_ids or [],
                    "fonti":              r.sources_json or [],
                    "documenti":          r.documenti_dettaglio or [],
                }
                for r in messaggi
            ],
        }

    except Exception as e:
        logger.error(f"[chat_history] get_messaggi_sessione fallito: {e}")
        return None
    finally:
        db.close()


# ─────────────────────────────────────────────
# RECUPERO: audit admin (lista sessioni con filtri)
# ─────────────────────────────────────────────

def get_audit_sessioni(
    page: int = 0,
    page_size: int = 30,
    utente_filter: str = "",
    data_da: Optional[str] = None,
    data_a: Optional[str] = None,
    tipo_filter: str = "",
    solo_bloccate: bool = False,
    owner_filter: Optional[int] = None,  # per admin non-super
) -> dict:
    """
    Lista sessioni paginata per il pannello audit admin.

    Args:
        page, page_size: paginazione
        utente_filter:  filtra per email/nome utente (LIKE)
        data_da, data_a: range date ISO (YYYY-MM-DD)
        tipo_filter:    filtra sessioni che contengono messaggi di quel tipo
        solo_bloccate:  mostra solo sessioni con almeno un messaggio bloccato
        owner_filter:   se non None, mostra solo le sessioni degli utenti
                        creati da questo Admin (ownership)
    """
    from sqlalchemy import text

    db = _get_db()
    try:
        conditions = ["1=1"]
        params: dict = {"limit": page_size, "offset": page * page_size}

        if utente_filter:
            conditions.append(
                "(LOWER(utente_email) LIKE :uf "
                "OR LOWER(utente_nome) LIKE :uf "
                "OR LOWER(utente_cognome) LIKE :uf)"
            )
            params["uf"] = f"%{utente_filter.lower()}%"

        if data_da:
            conditions.append("creata_il >= :data_da")
            params["data_da"] = data_da

        if data_a:
            conditions.append("creata_il <= :data_a::date + interval '1 day'")
            params["data_a"] = data_a

        if solo_bloccate:
            conditions.append("n_bloccati > 0")

        # Ownership filter: mostra solo sessioni di utenti creati da owner_filter
        if owner_filter is not None:
            conditions.append("""
                utente_id IN (
                    SELECT utente_id FROM Utente
                    WHERE creato_da = :owner_filter OR utente_id = :owner_filter
                )
            """)
            params["owner_filter"] = owner_filter

        where = "WHERE " + " AND ".join(conditions)

        total = db.execute(text(
            f"SELECT COUNT(*) FROM v_chat_audit {where}"
        ), params).scalar() or 0

        rows = db.execute(text(f"""
            SELECT *
            FROM v_chat_audit
            {where}
            ORDER BY aggiornata_il DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        sessioni = [
            {
                "sessione_id":     r.sessione_id,
                "session_uuid":    r.session_uuid,
                "titolo":          r.titolo or "Conversazione",
                "creata_il":       r.creata_il.isoformat() if r.creata_il else None,
                "aggiornata_il":   r.aggiornata_il.isoformat() if r.aggiornata_il else None,
                "n_messaggi":      r.n_messaggi,
                "n_log_risposta":  r.n_log_risposta,
                "n_bloccati":      r.n_bloccati,
                "n_not_found":     r.n_not_found,
                "avg_latency_ms":  r.avg_latency_ms,
                "n_documenti_unici": r.n_documenti_unici,
                "durata_secondi":  r.durata_secondi,
                "is_archiviata":   r.is_archiviata,
                "ip_address":      r.ip_address,
                "utente_id":       r.utente_id,
                "utente_email":    r.utente_email,
                "utente_nome":     r.utente_nome,
                "utente_cognome":  r.utente_cognome,
            }
            for r in rows
        ]

        return {
            "sessioni":  sessioni,
            "total":     total,
            "page":      page,
            "page_size": page_size,
        }

    except Exception as e:
        logger.error(f"[chat_history] get_audit_sessioni fallito: {e}")
        return {"sessioni": [], "total": 0, "page": page, "page_size": page_size}
    finally:
        db.close()


# ─────────────────────────────────────────────
# AZIONI UTENTE: archivia / feedback
# ─────────────────────────────────────────────

def archivia_sessione(session_uuid: str, utente_id: int) -> bool:
    """Archivia (soft-delete) una sessione dell'utente."""
    from sqlalchemy import text

    db = _get_db()
    try:
        result = db.execute(text("""
            UPDATE Chat_Sessione
            SET is_archiviata = TRUE
            WHERE session_uuid = :uuid AND utente_id = :uid
        """), {"uuid": session_uuid, "uid": utente_id})
        db.commit()
        return result.rowcount > 0
    except Exception as e:
        logger.error(f"[chat_history] archivia_sessione fallito: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return False
    finally:
        db.close()


def salva_feedback(log_id: int, utente_id: int, csat: int) -> bool:
    """
    Salva il feedback CSAT (1-5) su un messaggio.
    Verifica che il log appartenga all'utente prima di aggiornare.
    """
    from sqlalchemy import text

    if not 1 <= csat <= 5:
        return False

    db = _get_db()
    try:
        result = db.execute(text("""
            UPDATE Log_Risposta lr
            SET feedback_csat = :csat
            FROM Chat_Sessione cs
            WHERE lr.log_id = :lid
              AND lr.sessione_id = cs.sessione_id
              AND cs.utente_id = :uid
        """), {"lid": log_id, "uid": utente_id, "csat": csat})
        db.commit()
        return result.rowcount > 0
    except Exception as e:
        logger.error(f"[chat_history] salva_feedback fallito: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return False
    finally:
        db.close()
