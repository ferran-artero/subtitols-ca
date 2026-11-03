# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
FASE 1.2 — Exporta els puntuadors de text (token-classification) a ONNX i a int8.

Estructura d'eixida (la que espera transformers.js al navegador):
  models_onnx/<nom>/config.json, tokenizer.json, tokenizer_config.json, ...
  models_onnx/<nom>/onnx/model.onnx             (float32)
  models_onnx/<nom>/onnx/model_quantized.onnx   (int8)

Comprova que l'ONNX dona els mateixos logits que PyTorch amb frases de prova.

Ús (entorn venv-nemo, amb `pip install onnxruntime`):
    python eines/onnx_exporta_puntuadors.py
    python eines/onnx_exporta_puntuadors.py --models softcatala
"""
import argparse
from pathlib import Path

ARREL = Path(__file__).resolve().parent.parent
MODELS = {
    "softcatala": "softcatala/fullstop-catalan-punctuation-prediction",
    "umu": "UMUTeam/catalan_capitalization_punctuation_restoration",
}
FRASES = [
    "escolta que m'he deixat les claus a casa de ma mare pots baixar a obrir-me",
    "diumenge anam a deià i després a sopar a alcanada amb en tomeu i na margalida",
    "ie bon dia que hui no puc quedar eh bueno si de cas t'escric a la vesprada i ho parlem vale",
    "els investigadors han presentat un sistema de reconeixement de veu que funciona en temps real",
]


class NomesLogits:
    """Embolcall perquè l'ONNX tinga exactament dues entrades i una eixida."""

    def __new__(cls, model):
        import torch

        class W(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.m = m

            def forward(self, input_ids, attention_mask):
                return self.m(input_ids=input_ids, attention_mask=attention_mask).logits

        return W(model).eval()   # en mode avaluació: si no, torch el torna a posar en entrenament (dropout)


def exporta(nom: str, id_model: str, eixida: Path, opset: int) -> None:
    import numpy as np
    import onnxruntime as ort
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForTokenClassification, AutoTokenizer

    out = eixida / nom
    (out / "onnx").mkdir(parents=True, exist_ok=True)
    print(f"\n=== {nom}: {id_model}")
    try:
        tok = AutoTokenizer.from_pretrained(id_model, add_prefix_space=True)
    except Exception:
        tok = AutoTokenizer.from_pretrained(id_model)
    try:
        model = AutoModelForTokenClassification.from_pretrained(id_model, attn_implementation="eager")
    except Exception:
        model = AutoModelForTokenClassification.from_pretrained(id_model)
    model.eval()
    tok.save_pretrained(out)
    model.config.save_pretrained(out)
    if not (out / "tokenizer.json").exists():
        print("  [avís] El tokenitzador no és 'fast': no hi ha tokenizer.json (transformers.js el necessita).")

    enc = tok(FRASES[0].split(), is_split_into_words=True, return_tensors="pt")
    ids, mask = enc["input_ids"], enc["attention_mask"]
    f32 = out / "onnx" / "model.onnx"
    with torch.inference_mode():
        torch.onnx.export(
            NomesLogits(model), (ids, mask), str(f32),
            input_names=["input_ids", "attention_mask"], output_names=["logits"],
            dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
                          "logits": {0: "batch", 1: "seq"}},
            opset_version=opset, do_constant_folding=True, dynamo=False,
        )
    model.eval()
    q8 = out / "onnx" / "model_quantized.onnx"
    quantize_dynamic(str(f32), str(q8), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
    print(f"  model.onnx {f32.stat().st_size / 2**20:.0f} MB · model_quantized.onnx {q8.stat().st_size / 2**20:.0f} MB")

    # Comprovació: mateixa etiqueta per paraula que PyTorch
    sessions = {"fp32": ort.InferenceSession(str(f32), providers=["CPUExecutionProvider"]),
                "int8": ort.InferenceSession(str(q8), providers=["CPUExecutionProvider"])}
    iguals = {k: 0 for k in sessions}
    total, dif_max = 0, 0.0
    for frase in FRASES:
        e = tok(frase.split(), is_split_into_words=True, return_tensors="pt")
        with torch.inference_mode():
            ref = model(input_ids=e["input_ids"], attention_mask=e["attention_mask"]).logits[0].numpy()
        feed = {"input_ids": e["input_ids"].numpy().astype(np.int64),
                "attention_mask": e["attention_mask"].numpy().astype(np.int64)}
        total += ref.shape[0]
        for k, s in sessions.items():
            lo = s.run(None, feed)[0][0]
            iguals[k] += int((lo.argmax(-1) == ref.argmax(-1)).sum())
            if k == "fp32":
                dif_max = max(dif_max, float(np.abs(lo - ref).max()))
    print(f"  fp32: diferència màxima de logits {dif_max:.2e} · etiquetes iguals {100 * iguals['fp32'] / total:.1f}%")
    print(f"  int8: etiquetes iguals que PyTorch {100 * iguals['int8'] / total:.1f}% "
          "(la prova de veritat és pas1_cascada.py)")


def main():
    ap = argparse.ArgumentParser(description="Exporta els puntuadors a ONNX (float32 + int8)")
    ap.add_argument("--models", nargs="+", default=list(MODELS), help=f"{', '.join(MODELS)} o ids de HF")
    ap.add_argument("--eixida", default=str(ARREL / "models_onnx"))
    ap.add_argument("--opset", type=int, default=17)
    a = ap.parse_args()
    for nom in a.models:
        exporta(nom if nom in MODELS else Path(nom).name, MODELS.get(nom, nom), Path(a.eixida), a.opset)
    print("\nSegüent: python eines/onnx_baixa_vad.py")


if __name__ == "__main__":
    main()
