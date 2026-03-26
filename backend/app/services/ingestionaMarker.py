import os
import time
import sys
from pathlib import Path
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["TORCH_DEVICE"] = "cpu"

# ──────────────────────────────────────────────
# CONFIGURAZIONE GLOBALE
# ──────────────────────────────────────────────

USE_GEMINI_LLM = False
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# ── PATH DI DEFAULT ───────────────────────────
# Modifica queste due variabili per il tuo progetto
DEFAULT_INPUT  = r'C:\\Users\\PC_A26\\Desktop\\programmi\\TirocinioAI\\backend\\data'
DEFAULT_OUTPUT = r'C:\\Users\\PC_A26\\Desktop\\programmi\\TirocinioAI\\backend\\output_json'

from marker.converters.pdf import PdfConverter
from marker.output import MarkdownOutput
from marker.config.parser import ConfigParser
from marker.models import create_model_dict


# ─────────────────────────────────────────────
# CONVERSIONE SINGOLO PDF
# ─────────────────────────────────────────────

def converti_singolo(pdf_path: str, output_path: str, converter, config) -> dict:
    """
    Converte un singolo PDF e applica il post-processor.
    Restituisce un dict con i risultati.
    """
    nome = Path(pdf_path).stem  # nome file senza estensione

    print(f"\n{'─'*50}")
    print(f"📖 {Path(pdf_path).name}")
    print(f"{'─'*50}")

    t0 = time.time()
    try:
        rendered = converter(pdf_path)
    except Exception as e:
        print(f"   ❌ Errore conversione: {e}")
        return {"file": pdf_path, "status": "errore", "errore": str(e)}

    elapsed = time.time() - t0
    print(f"   ✅ Marker completato in {elapsed:.1f}s")

    # Estrai output
    output: MarkdownOutput = rendered
    full_text = output.markdown
    images    = output.images

    # Salva raw
    os.makedirs(output_path, exist_ok=True)
    md_raw = os.path.join(output_path, f"{nome}_raw.md")
    with open(md_raw, "w", encoding="utf-8") as f:
        f.write(full_text)

    # Salva immagini
    if images:
        img_dir = os.path.join(output_path, f"{nome}_images")
        os.makedirs(img_dir, exist_ok=True)
        for img_name, img in images.items():
            img.save(os.path.join(img_dir, img_name))

    # Post-processing
    md_fixed = os.path.join(output_path, f"{nome}.md")
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        sys.path.insert(0, script_dir)
        from TirocinioAI.backend.app.services.postprocessor6 import processa as postprocessa
        postprocessa(md_path=md_raw, pdf_path=pdf_path, output_path=md_fixed)
    except ImportError:
        print("   ⚠️  postprocessor4.py non trovato, skip pulizia")
        md_fixed = md_raw

    return {
        "file":     Path(pdf_path).name,
        "status":   "ok",
        "md_raw":   md_raw,
        "md_fixed": md_fixed,
        "parole":   len(full_text.split()),
        "immagini": len(images),
        "tempo":    elapsed
    }


# ─────────────────────────────────────────────
# PIPELINE BATCH
# ─────────────────────────────────────────────

def converti_cartella(input_path: str, output_path: str):
    """
    Processa tutti i PDF in una cartella (ricerca ricorsiva opzionale).
    """
    input_path  = Path(input_path)
    output_path = Path(output_path)

    # Trova tutti i PDF
    pdf_files = sorted(input_path.glob("*.pdf"))

    if not pdf_files:
        print(f"❌ Nessun PDF trovato in: {input_path}")
        print(f"   Controlla che il percorso sia corretto.")
        return

    print(f"📂 Cartella input : {input_path}")
    print(f"📂 Cartella output: {output_path}")
    print(f"📄 PDF trovati    : {len(pdf_files)}")
    for f in pdf_files:
        print(f"   • {f.name}")

    # Carica modelli UNA SOLA VOLTA per tutti i PDF
    print(f"\n🚀 Caricamento modelli surya (una volta sola)...")
    t0 = time.time()
    artifact_dict = create_model_dict(device="cpu", dtype="float32")
    print(f"   ✅ Modelli caricati in {time.time() - t0:.1f}s")

    # Configurazione
    base_config = {
        "device":                   "cpu",
        "dtype":                    "float32",
        "langs":                    ["it"],
        "batch_multiplier":         1,
        "disable_image_extraction": True,
        "ocr_all_pages":            False,
        "workers":                  1,
        "paginate_output":          True,   # aggiunge separatori pagina nel raw
    }

    if USE_GEMINI_LLM and GEMINI_API_KEY:
        print("   ☁️  Modalità: Marker + Gemini 2.0 Flash")
        base_config.update({
            "use_llm":        True,
            "llm_service":    "marker.services.gemini.GoogleGeminiService",
            "gemini_api_key": GEMINI_API_KEY,
            "gemini_model":   "gemini-2.0-flash",
        })
    else:
        print("   🏎️  Modalità: Marker puro (massima velocità CPU)")
        base_config["use_llm"] = False

    config      = ConfigParser(base_config)
    config_dict = config.generate_config_dict()

    converter_kwargs = dict(config=config_dict, artifact_dict=artifact_dict)
    if USE_GEMINI_LLM and GEMINI_API_KEY:
        converter_kwargs["llm_service"] = config.get_llm_service()

    converter = PdfConverter(**converter_kwargs)

    # Processa ogni PDF
    t_totale = time.time()
    risultati = []

    for i, pdf in enumerate(pdf_files, 1):
        print(f"\n[{i}/{len(pdf_files)}]", end="")
        risultato = converti_singolo(
            pdf_path=str(pdf),
            output_path=str(output_path),
            converter=converter,
            config=config
        )
        risultati.append(risultato)

    # Riepilogo finale
    tempo_totale = time.time() - t_totale
    ok    = [r for r in risultati if r["status"] == "ok"]
    err   = [r for r in risultati if r["status"] == "errore"]

    print(f"\n{'='*50}")
    print(f"✅ PIPELINE COMPLETATA")
    print(f"{'='*50}")
    print(f"📄 Processati  : {len(ok)}/{len(pdf_files)}")
    print(f"❌ Errori      : {len(err)}")
    print(f"⏱️  Tempo totale: {tempo_totale:.0f}s ({tempo_totale/60:.1f} min)")
    print(f"\n📁 Output in: {output_path}")

    if ok:
        print(f"\n{'File':<35} {'Parole':>8} {'Tempo':>8}")
        print("─" * 55)
        for r in ok:
            print(f"  {r['file']:<33} {r['parole']:>8,} {r['tempo']:>7.1f}s")

    if err:
        print(f"\n⚠️  File con errori:")
        for r in err:
            print(f"  • {r['file']}: {r['errore']}")


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Converti PDF in Markdown con Marker + post-processing"
    )
    parser.add_argument(
        "--input",  "-i",
        default=DEFAULT_INPUT,
        help=f"Cartella con i PDF (default: {DEFAULT_INPUT})"
    )
    parser.add_argument(
        "--output", "-o",
        default=DEFAULT_OUTPUT,
        help=f"Cartella output (default: {DEFAULT_OUTPUT})"
    )
    parser.add_argument(
        "--gemini",
        action="store_true",
        help="Usa Gemini LLM per migliorare la qualità (richiede GEMINI_API_KEY)"
    )
    args = parser.parse_args()

    if args.gemini:
        USE_GEMINI_LLM = True

    converti_cartella(
        input_path=args.input,
        output_path=args.output
    )