# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
FASE 1.5 — Torna a quantitzar els models ONNX ja exportats, amb dues millores:

  1. Per canal (per_channel): cada columna de pesos té la seua pròpia escala en lloc d'una
     per a tota la matriu. Sol recuperar part de la precisió que es perd en passar a int8.
  2. També la taula d'embeddings (Gather) dels puntuadors: en la primera versió es quedava
     en float32 i ocupava ~150 MB per model.

No sobreescriu res: crea fitxers nous al costat dels actuals
  conformer-ca-es/encoder.int8pc.onnx, decoder_joint.int8pc.onnx
  softcatala/onnx/model_q8pc.onnx, umu/onnx/model_q8pc.onnx

Ús (entorn venv-nemo):
    python eines/onnx_requantitza.py
"""
import argparse
from pathlib import Path

ARREL = Path(__file__).resolve().parent.parent


def quantitza(entrada: Path, eixida: Path, ops: list[str], per_canal: bool) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(str(entrada), str(eixida), weight_type=QuantType.QInt8,
                     op_types_to_quantize=ops, per_channel=per_canal)
    print(f"  {eixida.name}: {entrada.stat().st_size / 2**20:.0f} MB (float32) -> "
          f"{eixida.stat().st_size / 2**20:.0f} MB")


def main():
    ap = argparse.ArgumentParser(description="Quantització int8 per canal (+ embeddings dels puntuadors)")
    ap.add_argument("--models-onnx", default=str(ARREL / "models_onnx"))
    ap.add_argument("--sense-per-canal", action="store_true", help="Per a comparar: només afegeix Gather")
    a = ap.parse_args()
    base = Path(a.models_onnx)
    pc = not a.sense_per_canal

    conf = base / "conformer-ca-es"
    if (conf / "encoder.onnx").exists():
        print("Conformer:")
        for sub in ("encoder", "decoder_joint"):
            quantitza(conf / f"{sub}.onnx", conf / f"{sub}.int8pc.onnx", ["MatMul", "Gemm"], pc)
    else:
        print(f"[avís] No trobe {conf / 'encoder.onnx'}")

    for nom in ("softcatala", "umu"):
        f32 = base / nom / "onnx" / "model.onnx"
        if f32.exists():
            print(f"{nom}:")
            quantitza(f32, f32.with_name("model_q8pc.onnx"), ["MatMul", "Gemm", "Gather"], pc)
        else:
            print(f"[avís] No trobe {f32}")

    print("\nSegüent: python eines/onnx_baixa_umu_oficial.py")
    print("    python eines/pas0_linia_base.py --models conformer-ca-es onnx-fp32 onnx-int8 onnx-int8pc")
    print("    python eines/pas1_cascada.py --asr onnx-int8 onnx-int8pc --puntuadors "
          "softcatala-int8+umu-int8 softcatala-q8pc+umu-q8pc --compara")


if __name__ == "__main__":
    main()
