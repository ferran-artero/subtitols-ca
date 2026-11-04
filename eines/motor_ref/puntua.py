# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Puntuació (Softcatalà) + majúscules (UMU), només amb tokenizers i onnxruntime.

Per a cada model, per finestres de 120 paraules que avancen de 100 en 100 (de cada una es fa
servir la part central, perquè cap paraula es quede sense context):
  1. ids = [<s>] + tokens(" paraula1") + tokens(" paraula2") + ... + [</s>]
  2. logits = model(ids); per a cada paraula, l'etiqueta del seu PRIMER token
  3. etiqueta -> (signe darrere de la paraula, majúscula?)
       Softcatalà: 0 . , ? - :            (el "-" no s'usa)
       UMU:        l u ?u ?l !u !l ,u ,l .u .l :u :l   (u = majúscula, l = minúscula)

Combinació: els signes són de Softcatalà; de la UMU només les majúscules de DINS de frase
(si la UMU posa majúscula perquè creu que hi comença una frase, s'ignora), excepte si en algun
altre lloc del text la UMU ha escrit aquella paraula en majúscula a mig de frase (és un nom
propi: "Daniel"). Inici de frase (primera paraula i després de . ? !) sempre en majúscula.
Punt final si falta.
"""
import json
from pathlib import Path

import numpy as np

FINAL_FRASE = {".", "?", "!"}
SIGNES = ",.?!:;"


def finestres(n: int, mida: int = 120, solap: int = 20) -> list[tuple[int, int, int, int]]:
    """Finestres sobre n paraules: (inici, fi, es_queda_des_de, es_queda_fins_a). Avancen de
    mida - solap; de cada una es descarten solap/2 paraules per vora (excepte als extrems)."""
    if n <= mida:
        return [(0, n, 0, n)]
    pas, vora = mida - solap, solap // 2
    inicis = list(range(0, n - mida, pas)) + [n - mida]
    res = []
    for k, s in enumerate(inicis):
        des_de = 0 if k == 0 else res[-1][3]
        fins_a = n if k == len(inicis) - 1 else s + mida - vora
        res.append((s, s + mida, des_de, fins_a))
    return res


def etiqueta(et: str) -> tuple[str | None, bool | None]:
    """'?u' -> ('?', True); 'l' -> (None, False); '.' -> ('.', None); '0' -> (None, None)."""
    punt = next((c for c in et if c in SIGNES), None)
    maj = True if et.endswith("u") else False if et.endswith("l") else None
    return punt, maj


class ModelEtiquetes:
    def __init__(self, carpeta: Path, fitxer_onnx: str = "model.onnx", fils: int | None = None):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        carpeta = Path(carpeta)
        self.tok = Tokenizer.from_file(str(carpeta / "tokenizer.json"))
        cfg = json.loads((carpeta / "config.json").read_text(encoding="utf-8"))
        self.etiquetes = {int(i): etiqueta(l) for i, l in cfg["id2label"].items()}
        self.inici, self.final = self.tok.token_to_id("<s>"), self.tok.token_to_id("</s>")
        so = ort.SessionOptions()
        if fils:
            so.intra_op_num_threads = fils
        self.s = ort.InferenceSession(str(carpeta / "onnx" / fitxer_onnx), so, providers=["CPUExecutionProvider"])
        self.entrades = [i.name for i in self.s.get_inputs()]   # input_ids, attention_mask (, token_type_ids)

    def codifica(self, paraules: list[str]) -> tuple[list[int], list[int]]:
        """ids i, per a cada paraula, la posició del seu primer token."""
        ids, primers = [self.inici], []
        for w in paraules:
            primers.append(len(ids))
            ids.extend(self.tok.encode(" " + w, add_special_tokens=False).ids)
        ids.append(self.final)
        return ids, primers

    def prediu(self, paraules: list[str]) -> tuple[list, list]:
        punts, majs = [None] * len(paraules), [None] * len(paraules)
        for ini, fi, des_de, fins_a in finestres(len(paraules)):
            ids, primers = self.codifica(paraules[ini:fi])
            x = np.array([ids[:512]], dtype=np.int64)
            feed = {"input_ids": x, "attention_mask": np.ones_like(x), "token_type_ids": np.zeros_like(x)}
            logits = self.s.run(None, {k: feed[k] for k in self.entrades})[0][0]
            for k, pos in enumerate(primers):
                if des_de <= ini + k < fins_a and pos < x.shape[1] - 1:
                    punts[ini + k], majs[ini + k] = self.etiquetes[int(np.argmax(logits[pos]))]
        return punts, majs


def capitalitza(w: str) -> str:
    for i, c in enumerate(w):
        if c.isalpha():
            return w[:i] + c.upper() + w[i + 1:]
    return w


class Puntuador:
    """Signes de `signes` (Softcatalà) + majúscules de dins de frase de `majuscules` (UMU)."""

    def __init__(self, signes: ModelEtiquetes, majuscules: ModelEtiquetes):
        self.signes, self.majuscules = signes, majuscules

    def puntua(self, paraules: list[str]) -> list[tuple[str, str | None]]:
        """Per a cada paraula: (text amb majúscules, signe darrere o None)."""
        if not paraules:
            return []
        punts, _ = self.signes.prediu(paraules)
        punts_m, majs_m = self.majuscules.prediu(paraules)
        inici_umu = [i == 0 or punts_m[i - 1] in FINAL_FRASE for i in range(len(paraules))]
        fiables = {w.lower() for w, m, ini in zip(paraules, majs_m, inici_umu) if m and not ini}
        majs = [bool(m) and (not ini or w.lower() in fiables) for w, m, ini in zip(paraules, majs_m, inici_umu)]
        res, inici = [], True
        for w, p, m in zip(paraules, punts, majs):
            res.append((capitalitza(w) if (m or inici) else w, p))
            inici = p in FINAL_FRASE
        w, p = res[-1]
        if p is None or p not in ".?!:;":
            res[-1] = (w, ".")
        return res
