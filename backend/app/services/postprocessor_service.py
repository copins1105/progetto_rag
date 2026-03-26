# app/services/postprocessor_service.py
"""
Wrapper di postprocessor6.py come servizio riutilizzabile.
Espone una sola funzione: processa_markdown(md_raw, pdf_path, output_dir, emit)
"""

from pathlib import Path
from typing import Callable, Optional


def processa_markdown(
    md_raw_path: str,
    output_dir: str,
    pdf_path: Optional[str] = None,
    emit: Callable[[str], None] = print,
) -> str:
    """
    Pulisce un markdown grezzo prodotto da Marker tramite postprocessor6.

    Args:
        md_raw_path: percorso al file _raw.md prodotto da marker_service
        output_dir:  cartella dove salvare il markdown pulito
        pdf_path:    (opzionale) percorso al PDF originale per estrarre footnote
        emit:        callback per i log

    Returns:
        percorso assoluto al file .md pulito

    Raises:
        Exception se il post-processing fallisce
    """
    md_raw_path = Path(md_raw_path)
    output_dir  = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Nome output: rimuove suffisso _raw → documento_pulito.md
    stem     = md_raw_path.stem.replace("_raw", "")
    md_fixed = output_dir / f"{stem}.md"

    emit("🧹 Post-processing markdown...")

    try:
        # Importa la funzione `processa` direttamente da postprocessor6
        # Il file deve essere nel PYTHONPATH oppure nella stessa directory
        from app.services.postprocessor6 import processa

        processa(
            md_path=str(md_raw_path),
            pdf_path=pdf_path,        # None → skip footnote
            output_path=str(md_fixed),
        )
        emit("✅ Post-processing completato")

    except ImportError:
        # Fallback: se postprocessor6 non è importabile, usa il raw
        emit("⚠️  postprocessor6 non trovato — uso markdown grezzo senza pulizia")
        import shutil
        shutil.copy(md_raw_path, md_fixed)

    return str(md_fixed)