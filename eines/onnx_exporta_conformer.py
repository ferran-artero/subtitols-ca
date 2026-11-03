# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE

import argparse
import json
from pathlib import Path

ARREL = Path(__file__).resolve().parent.parent
MODEL = "projecte-aina/stt_ca-es_conformer_transducer_large"


def mida_mb(p: Path) -> float:
    return p.stat().st_size / 2**20


def quantitza(entrada: Path, eixida: Path) -> None:
    """int8 dinàmic només a MatMul/Gemm: és on hi ha quasi tots els pesos i és el que
    onnxruntime-web executa bé. Les convolucions i la LSTM es queden en float32."""
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(str(entrada), str(eixida), weight_type=QuantType.QInt8,
                     op_types_to_quantize=["MatMul", "Gemm"])


def main():
    ap = argparse.ArgumentParser(description="Exporta el Conformer RNNT a ONNX (float32 + int8)")
    ap.add_argument("--model", default=MODEL, help="Id de Hugging Face o ruta a un .nemo")
    ap.add_argument("--eixida", default=str(ARREL / "models_onnx" / "conformer-ca-es"))
    ap.add_argument("--opset", type=int, default=17)
    a = ap.parse_args()

    import numpy as np
    import torch
    import nemo.collections.asr as nemo_asr
    from omegaconf import OmegaConf

    out = Path(a.eixida)
    out.mkdir(parents=True, exist_ok=True)

    print(f"Carregant {a.model} ...")
    if a.model.endswith(".nemo"):
        m = nemo_asr.models.ASRModel.restore_from(a.model, map_location="cpu")
    else:
        m = nemo_asr.models.ASRModel.from_pretrained(a.model, map_location="cpu")
    m.eval()

    # ---- 1. Exportació (NeMo fa servir l'exportador clàssic de torch, dynamo=False)
    print("Exportant a ONNX (pot tardar uns minuts) ...")
    base = out / "model.onnx"
    with torch.inference_mode():
        m.export(str(base), onnx_opset_version=a.opset, check_trace=False)
    for sub in ("encoder", "decoder_joint"):
        trobats = list(out.glob(f"{sub}-*.onnx"))
        if not trobats:
            raise SystemExit(f"No trobe l'eixida de {sub} a {out}: {[p.name for p in out.iterdir()]}")
        desti = out / f"{sub}.onnx"
        if desti.exists():
            desti.unlink()
        trobats[0].rename(desti)
        print(f"  {desti.name}: {mida_mb(desti):.0f} MB")

    # ---- 2. Vocabulari
    V = m.tokenizer.vocab_size
    try:
        peces = m.tokenizer.ids_to_tokens(list(range(V)))
    except Exception:
        peces = [m.tokenizer.tokenizer.id_to_piece(i) for i in range(V)]
    (out / "tokens.txt").write_text("\n".join(peces) + "\n", encoding="utf-8")
    try:
        (out / "tokenizer.model").write_bytes(m.tokenizer.tokenizer.serialized_model_proto())
    except Exception as e:
        print(f"  [avís] No he pogut desar tokenizer.model ({e}); tens tokens.txt igualment.")

    # ---- 3. Configuració i preprocessador (per a la fase 2)
    pre = OmegaConf.to_container(m.cfg.preprocessor, resolve=True)
    sub_factor = int(m.cfg.encoder.get("subsampling_factor", 4))
    stride = float(pre.get("window_stride", 0.01))
    cfg = {
        "model": a.model,
        "llicencia": "CC-BY-4.0",
        "autoria": "Language Technologies Unit, Barcelona Supercomputing Center (Projecte AINA); "
                   "basat en nvidia/stt_es_conformer_transducer_large",
        "sample_rate": int(pre.get("sample_rate", 16000)),
        "preprocessor": pre,
        "subsampling_factor": sub_factor,
        "segons_per_instant": stride * sub_factor,
        "vocab_size": V,
        "blank_id": V,                 # en els RNNT de NeMo, el blank és l'últim (= mida del vocabulari)
        "max_symbols_per_step": 10,
        "opset": a.opset,
    }
    (out / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        feat = m.preprocessor.featurizer
        np.save(out / "mel_fb.npy", feat.fb.squeeze(0).cpu().numpy().astype(np.float32))
        np.save(out / "finestra.npy", feat.window.cpu().numpy().astype(np.float32))
    except Exception as e:
        print(f"  [avís] No he pogut desar el banc de filtres ({e}). Ho farem a la fase 2.")

    # ---- 4. Quantització int8
    print("Quantitzant a int8 ...")
    for sub in ("encoder", "decoder_joint"):
        quantitza(out / f"{sub}.onnx", out / f"{sub}.int8.onnx")
        print(f"  {sub}.int8.onnx: {mida_mb(out / f'{sub}.int8.onnx'):.0f} MB")

    # ---- 5. Comprovació ràpida: el blank ha de ser l'últim logit
    import onnxruntime as ort
    dec = ort.InferenceSession(str(out / "decoder_joint.onnx"), providers=["CPUExecutionProvider"])
    print("\nEntrades del decoder_joint:", [(i.name, i.shape, i.type) for i in dec.get_inputs()])
    print("Eixides del decoder_joint:", [(o.name, o.shape) for o in dec.get_outputs()])
    enc = ort.InferenceSession(str(out / "encoder.onnx"), providers=["CPUExecutionProvider"])
    print("Entrades de l'encoder:", [(i.name, i.shape, i.type) for i in enc.get_inputs()])
    print(f"\nFet. Vocabulari {V} + blank (id {V}). Cada instant de l'encoder = {cfg['segons_per_instant']:.3f} s")
    total = sum(mida_mb(p) for p in out.glob("*.int8.onnx"))
    print(f"Mida int8 (encoder + decoder_joint): {total:.0f} MB")
    print("Següent: python codi/onnx_exporta_puntuadors.py")


if __name__ == "__main__":
    main()
