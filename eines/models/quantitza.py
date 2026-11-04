# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Quantitza els models que fa servir la web (no sobreescriu els originals en float32):

  conformer-ca-es/encoder.q8w.onnx     (481 -> 191 MB)
      Només els PESOS de les MatMul a 8 bits, per blocs de 64 (MatMulNBits); les activacions es
      queden en float32. La int8 "dinàmica" (pesos i activacions) feia el model inestable i es
      menjava frases; la de 4 bits perdia massa qualitat. El decoder_joint es queda en float32:
      es crida milers de vegades amb matrius petites i en MatMulNBits va 5 vegades més lent.

  softcatala/onnx/model_q8pc.onnx      (≈ 500 -> 127 MB)
      int8 dinàmic per canal, incloent-hi la taula d'embeddings (Gather). Mateixa F1 que l'original.

Ús (cal onnx, onnxruntime i onnx_ir):
    python eines/models/quantitza.py
"""
import argparse
import logging
from pathlib import Path

ARREL = Path(__file__).resolve().parents[2]          # arrel del repositori


def mb(p: Path) -> str:
    return f"{p.stat().st_size / 2**20:.0f} MB"


def encoder_q8w(entrada: Path, eixida: Path) -> None:
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    for nom in ("onnxruntime.quantization", "onnxruntime.quantization.matmul_nbits_quantizer", ""):
        logging.getLogger(nom).setLevel(logging.WARNING)
    q = MatMulNBitsQuantizer(onnx.load(str(entrada)), bits=8, block_size=64, is_symmetric=True,
                             op_types_to_quantize=("MatMul",))
    q.process()
    q.model.save_model_to_file(str(eixida), use_external_data_format=False)


def puntuador_q8pc(entrada: Path, eixida: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(str(entrada), str(eixida), weight_type=QuantType.QInt8,
                     op_types_to_quantize=["MatMul", "Gemm", "Gather"], per_channel=True)


def main():
    ap = argparse.ArgumentParser(description="Quantitza l'encoder (q8w) i el puntuador de Softcatalà (q8pc)")
    ap.add_argument("--models", default=str(ARREL / "models_onnx"))
    base = Path(ap.parse_args().models)
    for funcio, entrada, eixida in (
            (encoder_q8w, base / "conformer-ca-es" / "encoder.onnx", "encoder.q8w.onnx"),
            (puntuador_q8pc, base / "softcatala" / "onnx" / "model.onnx", "model_q8pc.onnx")):
        if not entrada.exists():
            print(f"[avís] No trobe {entrada}")
            continue
        funcio(entrada, entrada.with_name(eixida))
        print(f"  {entrada.with_name(eixida)}: {mb(entrada)} -> {mb(entrada.with_name(eixida))}")


if __name__ == "__main__":
    main()
