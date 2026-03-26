# app/services/marker_service.py
"""
Wrapper di ingestionaMarker.py come servizio riutilizzabile.
Carica i modelli Marker una sola volta per processo e li riusa.
"""

import os
import time
from pathlib import Path
from typing import Callable

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TORCH_DEVICE", "cpu")

# Modelli caricati una sola volta (singleton)
_converter = None
_config    = None


def _get_converter(emit: Callable[[str], None]):
    global _converter, _config
    if _converter is not None:
        return _converter, _config

    from marker.converters.pdf import PdfConverter
    from marker.config.parser import ConfigParser
    from marker.models import create_model_dict

    emit("📦 Caricamento modelli Marker (prima volta, ~30s)...")
    t0 = time.time()
    artifact_dict = create_model_dict(device="cpu", dtype="float32")
    emit(f"   ✅ Modelli caricati in {time.time() - t0:.1f}s")

    _config = ConfigParser({
        "device":                   "cpu",
        "dtype":                    "float32",
        "langs":                    ["it"],
        "batch_multiplier":         1,
        "disable_image_extraction": True,
        "ocr_all_pages":            False,
        "workers":                  1,
        "paginate_output":          True,
        "use_llm":                  False,
    })

    _converter = PdfConverter(
        config=_config.generate_config_dict(),
        artifact_dict=artifact_dict,
    )
    return _converter, _config


def converti_pdf(
    pdf_path: str,
    output_dir: str,
    emit: Callable[[str], None] = print,
) -> dict:
    """
    Converte un PDF in Markdown usando Marker.

    Returns:
        { "md_raw": str, "stem": str, "n_parole": int, "n_immagini": int, "tempo_s": float }
    """
    from marker.output import MarkdownOutput

    pdf_path   = Path(pdf_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = pdf_path.stem

    emit(f"📖 Conversione: {pdf_path.name}")
    converter, _ = _get_converter(emit)

    t0 = time.time()
    rendered: MarkdownOutput = converter(str(pdf_path))
    elapsed = time.time() - t0

    full_text = rendered.markdown
    images    = rendered.images or {}

    md_raw = output_dir / f"{stem}_raw.md"
    md_raw.write_text(full_text, encoding="utf-8")
    emit(f"✅ Markdown grezzo salvato in {elapsed:.1f}s ({len(full_text.split())} parole)")

    if images:
        img_dir = output_dir / f"{stem}_images"
        img_dir.mkdir(exist_ok=True)
        for img_name, img in images.items():
            img.save(img_dir / img_name)

    return {
        "md_raw":     str(md_raw),
        "stem":       stem,
        "n_parole":   len(full_text.split()),
        "n_immagini": len(images),
        "tempo_s":    elapsed,
    }