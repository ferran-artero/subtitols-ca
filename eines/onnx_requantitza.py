# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE

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

    print("\nSegüent:")
    print("    python codi/onnx_valida.py --models onnx-int8pc")
    print("    python codi/pas0_linia_base.py --models conformer-ca-es onnx-fp32 onnx-int8 onnx-int8pc")
    print("    python codi/pas1_cascada.py --asr onnx-int8 onnx-int8pc --puntuadors "
          "softcatala-int8+umu-int8 softcatala-q8pc+umu-q8pc --compara")


if __name__ == "__main__":
    main()
