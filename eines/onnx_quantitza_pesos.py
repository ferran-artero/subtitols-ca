# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Quantització NOMÉS DELS PESOS del Conformer (MatMulNBits), a 8 i a 4 bits.

La int8 "dinàmica" (onnx_exporta_conformer.py / onnx_requantitza.py) també quantitza les
activacions sobre la marxa, i això fa el model inestable: amb petits canvis a l'entrada pot
deixar de generar paraules durant segons (frases perdudes). Aquí les activacions es queden en
float32 i només els pesos de les MatMul es guarden en 8 o 4 bits, per blocs de 32 o 64 valors.
onnxruntime-web també executa MatMulNBits.

Escriu, al costat dels altres:
  conformer-ca-es/encoder.q8w.onnx, decoder_joint.q8w.onnx   (8 bits per pes)
  conformer-ca-es/encoder.q4w.onnx, decoder_joint.q4w.onnx   (4 bits per pes)

Ús (entorn venv-nemo; si cal: pip install onnx_ir):
    python eines/onnx_quantitza_pesos.py
    python eines/onnx_quantitza_pesos.py --bits 8
"""
import argparse
from pathlib import Path

ARREL = Path(__file__).resolve().parent.parent


def quantitza(entrada: Path, eixida: Path, bits: int, bloc: int) -> None:
    import logging
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    for nom in ("onnxruntime.quantization", "onnxruntime.quantization.matmul_nbits_quantizer", ""):
        logging.getLogger(nom).setLevel(logging.WARNING)
    model = onnx.load(str(entrada))
    q = MatMulNBitsQuantizer(model, bits=bits, block_size=bloc, is_symmetric=True,
                             op_types_to_quantize=("MatMul",))
    q.process()
    q.model.save_model_to_file(str(eixida), use_external_data_format=False)
    print(f"  {eixida.name}: {entrada.stat().st_size / 2**20:.0f} MB -> {eixida.stat().st_size / 2**20:.0f} MB")


def main():
    ap = argparse.ArgumentParser(description="Quantització només dels pesos (MatMulNBits) del Conformer")
    ap.add_argument("--models-onnx", default=str(ARREL / "models_onnx"))
    ap.add_argument("--bits", type=int, nargs="+", default=[8, 4], choices=[4, 8])
    a = ap.parse_args()
    conf = Path(a.models_onnx) / "conformer-ca-es"
    for bits in a.bits:
        bloc = 64 if bits == 8 else 32
        print(f"{bits} bits (blocs de {bloc}):")
        for sub in ("encoder", "decoder_joint"):
            quantitza(conf / f"{sub}.onnx", conf / f"{sub}.q{bits}w.onnx", bits, bloc)


if __name__ == "__main__":
    main()
