# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
FASE 1.3 — Baixa Silero VAD (ja és ONNX, ~2 MB) i la seua llicència (MIT).

Escriu a models_onnx/silero-vad/: silero_vad.onnx, LICENSE, CITATION.cff

Ús:
    python eines/onnx_baixa_vad.py
"""
import argparse
import urllib.request
from pathlib import Path

ARREL = Path(__file__).resolve().parent.parent
BASE = "https://raw.githubusercontent.com/snakers4/silero-vad/master/"
FITXERS = {
    "silero_vad.onnx": "src/silero_vad/data/silero_vad.onnx",
    "LICENSE": "LICENSE",
    "CITATION.cff": "CITATION.cff",
}


def main():
    ap = argparse.ArgumentParser(description="Baixa Silero VAD (ONNX) i la seua llicència")
    ap.add_argument("--eixida", default=str(ARREL / "models_onnx" / "silero-vad"))
    a = ap.parse_args()
    out = Path(a.eixida)
    out.mkdir(parents=True, exist_ok=True)
    for nom, ruta in FITXERS.items():
        desti = out / nom
        try:
            urllib.request.urlretrieve(BASE + ruta, desti)
            print(f"  {nom}: {desti.stat().st_size / 1024:.0f} KB")
        except Exception as e:
            print(f"  [error] {nom}: {e}\n          Baixa'l a mà de {BASE + ruta} i desa'l a {desti}")

    vad = out / "silero_vad.onnx"
    if vad.exists():
        import onnxruntime as ort
        s = ort.InferenceSession(str(vad), providers=["CPUExecutionProvider"])
        print("  Entrades:", [(i.name, i.shape, i.type) for i in s.get_inputs()])
        print("  Eixides:", [(o.name, o.shape) for o in s.get_outputs()])
    print("\nSegüent: python eines/onnx_quantitza_pesos.py --bits 8")


if __name__ == "__main__":
    main()
