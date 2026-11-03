# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Baixa el model de majúscules i puntuació de la UMU quantitzat a 8 bits per ells mateixos
(UMUTeam/catalan_capitalization_punctuation_restoration_int8, Apache-2.0) i el deixa a
models_onnx/umu-oficial/ amb la mateixa estructura que els altres puntuadors:

    models_onnx/umu-oficial/config.json, tokenizer.json, tokenizer_config.json
    models_onnx/umu-oficial/onnx/model.onnx

Després comprova que és compatible amb el nostre (mateixes etiquetes, mateix tokenitzador, mateixes
entrades) i compara les seues prediccions amb les de umu/onnx/model_q8pc.onnx (la nostra quantització).

Ús (entorn venv-nemo):
    python eines/onnx_baixa_umu_oficial.py

Cita (ho demanen els autors): Pan, García-Díaz, Vivancos-Vicente i Valencia-García (2023),
"Evaluation of Transformer-Based Models for Punctuation and Capitalization Restoration in Catalan
and Galician", Procesamiento del Lenguaje Natural 70, 27-38, doi:10.26342/2023-70-2.
"""
import hashlib
import json
import shutil
import time

from pathlib import Path

MODELS_ONNX = Path(__file__).resolve().parent.parent / "models_onnx"

REPO = "UMUTeam/catalan_capitalization_punctuation_restoration_int8"
DESTI = MODELS_ONNX / "umu-oficial"
NOSTRE = MODELS_ONNX / "umu"
FITXERS = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
           "vocab.json", "merges.txt", "README.md", "model.onnx"]

FRASES = [
    "bon dia a tothom avui parlarem de daniel sancho i de la seua mare sílvia bronchalo",
    "la universitat politècnica de valència i valgrai treballen en models de llenguatge",
    "què has fet aquest cap de setmana idò res de nou he anat a palma amb els meus amics",
    "el president de la generalitat ha anunciat que el pressupost arribarà al parlament dimarts",
]


def md5(ruta):
    return hashlib.md5(ruta.read_bytes()).hexdigest()


def main():
    from huggingface_hub import hf_hub_download
    (DESTI / "onnx").mkdir(parents=True, exist_ok=True)
    print(f"Baixant {REPO} ...")
    for f in FITXERS:
        try:
            ruta = hf_hub_download(REPO, f)
        except Exception as e:
            print(f"  {f}: no hi és ({type(e).__name__})")
            continue
        desti = DESTI / "onnx" / f if f.endswith(".onnx") else DESTI / f
        shutil.copyfile(ruta, desti)
        print(f"  {f}: {desti.stat().st_size / 1e6:.1f} MB")

    print("\n== Compatibilitat amb models_onnx/umu ==")
    a = json.loads((NOSTRE / "config.json").read_text(encoding="utf-8"))["id2label"]
    b = json.loads((DESTI / "config.json").read_text(encoding="utf-8"))["id2label"]
    print(f"  etiquetes: {'IGUALS' if a == b else 'DIFERENTS'}  ({len(b)}: {list(b.values())})")
    if a != b:
        print(f"  les nostres: {list(a.values())}")
    print(f"  tokenizer.json: {'igual' if md5(NOSTRE / 'tokenizer.json') == md5(DESTI / 'tokenizer.json') else 'DIFERENT'}")

    import onnx
    import onnxruntime as ort
    m = onnx.load(str(DESTI / "onnx" / "model.onnx"), load_external_data=False)
    ops = {}
    for n in m.graph.node:
        ops[n.op_type] = ops.get(n.op_type, 0) + 1
    quant = {k: v for k, v in ops.items() if any(q in k for q in ("Quant", "Integer", "NBits"))}
    print(f"  entrades: {[i.name for i in m.graph.input]} · eixides: {[o.name for o in m.graph.output]}")
    print(f"  operadors de quantització: {quant or 'cap'} · opset {[o.version for o in m.opset_import]}")

    print("\n== Prediccions: oficial int8 contra la nostra q8pc ==")
    from motor_ref.puntua import ModelEtiquetes
    oficial = ModelEtiquetes(DESTI, "model.onnx")
    nostre = ModelEtiquetes(NOSTRE, "model_q8pc.onnx")
    iguals = total = 0
    for fr in FRASES:
        w = fr.split()
        t0 = time.perf_counter()
        po, mo = oficial.prediu(w)
        to = time.perf_counter() - t0
        t0 = time.perf_counter()
        pn, mn = nostre.prediu(w)
        tn = time.perf_counter() - t0
        iguals += sum(x == y for x, y in zip(zip(po, mo), zip(pn, mn)))
        total += len(w)
        fmt = lambda ps, ms: " ".join((x.capitalize() if mm else x) + (p or "") for x, p, mm in zip(w, ps, ms))
        print(f"  oficial ({to:.2f} s): {fmt(po, mo)}\n  nostre  ({tn:.2f} s): {fmt(pn, mn)}\n")
    print(f"Etiquetes idèntiques: {iguals}/{total} paraules")


if __name__ == "__main__":
    main()
