# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Baixa el model de majúscules i puntuació de la UMU quantitzat a 8 bits per ells mateixos
(UMUTeam/catalan_capitalization_punctuation_restoration_int8, Apache-2.0) a
models_onnx/umu-oficial/ (config.json, tokenizer.json… i onnx/model.onnx).

Ús:
    python eines/models/baixa_umu.py

Cita (ho demanen els autors): Pan, García-Díaz, Vivancos-Vicente i Valencia-García (2023),
"Evaluation of Transformer-Based Models for Punctuation and Capitalization Restoration in Catalan
and Galician", Procesamiento del Lenguaje Natural 70, 27-38, doi:10.26342/2023-70-2.
"""
import argparse
import json
import shutil
from pathlib import Path

ARREL = Path(__file__).resolve().parents[2]          # arrel del repositori
REPO = "UMUTeam/catalan_capitalization_punctuation_restoration_int8"
FITXERS = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
           "vocab.json", "merges.txt", "README.md", "model.onnx"]


def main():
    ap = argparse.ArgumentParser(description="Baixa l'int8 oficial de la UMU")
    ap.add_argument("--eixida", default=str(ARREL / "models_onnx" / "umu-oficial"))
    a = ap.parse_args()
    from huggingface_hub import hf_hub_download
    desti = Path(a.eixida)
    (desti / "onnx").mkdir(parents=True, exist_ok=True)
    print(f"Baixant {REPO} ...")
    for f in FITXERS:
        try:
            ruta = hf_hub_download(REPO, f)
        except Exception as e:
            print(f"  {f}: no hi és ({type(e).__name__})")
            continue
        d = desti / "onnx" / f if f.endswith(".onnx") else desti / f
        shutil.copyfile(ruta, d)
        print(f"  {f}: {d.stat().st_size / 1e6:.1f} MB")
    etiquetes = json.loads((desti / "config.json").read_text(encoding="utf-8"))["id2label"]
    print(f"Etiquetes ({len(etiquetes)}): {list(etiquetes.values())}")
    print("\nSegüent: python eines/models/quantitza.py")


if __name__ == "__main__":
    main()
