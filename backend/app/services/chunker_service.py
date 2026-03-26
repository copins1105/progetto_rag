# app/services/chunker_service.py
"""
Wrapper di rag_chunker.py come servizio riutilizzabile.
Per ora esegue solo il chunking e salva il JSON.
Il caricamento in ChromaDB/PostgreSQL verrà aggiunto quando
il LoaderService sarà pronto.
"""

import json
from pathlib import Path
from typing import Callable


def chunking_e_indicizzazione(
    md_path: str,
    output_dir: str,
    emit: Callable[[str], None] = print,
    privacy_id: int = 1,
) -> dict:
    """
    Esegue chunking semantico del markdown e salva il JSON dei chunk.

    Args:
        md_path:    percorso al markdown pulito (output di postprocessor_service)
        output_dir: cartella dove salvare il file _chunks.json
        emit:       callback per i log
        privacy_id: riservato per uso futuro con LoaderService

    Returns:
        il dict { "documento": {...}, "frammenti": [...] } prodotto da rag_chunker
    """
    md_path    = Path(md_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    emit("⚙️  Chunking semantico (rag_chunker)...")

    from app.services.rag_chunker import processa_md

    chunks_data = processa_md(md_path)

    n_tot = chunks_data["documento"]["n_frammenti"]
    n_rag = chunks_data["documento"]["n_frammenti_rag"]
    emit(f"✅ Chunking completato: {n_tot} frammenti totali, {n_rag} per RAG")

    stem        = md_path.stem
    chunks_path = output_dir / f"{stem}_chunks.json"
    chunks_path.write_text(
        json.dumps(chunks_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    emit(f"📄 JSON chunk salvato: {chunks_path.name}")
    emit("🎉 Pipeline completata! Usa il loader per indicizzare in ChromaDB.")

    return chunks_data