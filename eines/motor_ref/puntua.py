# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Puntuació (softcatala) + majúscules (umu), només amb tokenizers i onnxruntime.

Per a cada model i cada finestra de 120 paraules:
  0. finestres de 120 paraules que avancen de 100 en 100; de cada una es fa servir la part
     central (vegeu `finestres`), perquè cap paraula es quede sense context
  1. ids = [<s>] + tokens(" paraula1") + tokens(" paraula2") + ... + [</s>]
     (cada paraula es tokenitza sola amb un espai davant; és el que fa transformers amb
     is_split_into_words=True i add_prefix_space=True)
  2. logits = model(ids); per a cada paraula, l'etiqueta del seu PRIMER token
  3. etiqueta -> (signe darrere de la paraula, majúscula?)  p. ex. ',u' -> (',', True)

Combinació: els signes són de softcatala; d'umu només les majúscules de DINS de frase
(si umu posa majúscula perquè ell creu que la paraula anterior acaba frase, s'ignora), excepte
si en algun altre lloc del text umu ha escrit aquella paraula en majúscula a mig de frase
(és un nom propi: "Daniel").
Inici de frase (primera paraula i després de . ? !) sempre en majúscula. Punt final si falta.
"""
import json
import re
from pathlib import Path

import numpy as np

FINAL_FRASE = {".", "?", "!"}
_NOMS = {"comma": ",", "period": ".", "question": "?", "exclamation": "!", "colon": ":", "semicolon": ";"}


def finestres(n: int, mida: int = 120, solap: int = 20) -> list[tuple[int, int, int, int]]:
    """Finestres solapades sobre n paraules: (inici, fi, es_queda_des_de, es_queda_fins_a).
    Avancen de (mida - solap) en (mida - solap); de cada una només es fa servir la part central
    (es descarten solap/2 paraules de cada vora, excepte a l'inici i al final del text), així cap
    paraula es puntua sense context a la dreta o a l'esquerra."""
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


def interpreta_etiqueta(et: str) -> tuple[str | None, bool | None]:
    s = str(et).strip()
    if s.upper() in ("", "0", "O", "NONE"):
        return None, None
    punt = next((c for c in s if c in ",.?!:;"), None)
    parts = [p.lower() for p in re.findall(r"[A-Za-z]+", s)]
    if punt is None:
        punt = next((v for k, v in _NOMS.items() if k in parts), None)
    maj = True if any(p in ("u", "upper", "cap", "maj") for p in parts) else \
        False if any(p in ("l", "lower", "min") for p in parts) else None
    return punt, maj


class ModelEtiquetes:
    def __init__(self, carpeta: Path, fitxer_onnx: str, fils: int | None = None, max_paraules: int = 120):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        carpeta = Path(carpeta)
        self.tok = Tokenizer.from_file(str(carpeta / "tokenizer.json"))
        cfg = json.loads((carpeta / "config.json").read_text(encoding="utf-8"))
        self.etiquetes = {int(i): interpreta_etiqueta(l) for i, l in cfg["id2label"].items()}
        self.inici, self.final = self._especials(carpeta, cfg)
        so = ort.SessionOptions()
        if fils:
            so.intra_op_num_threads = fils
        self.s = ort.InferenceSession(str(carpeta / "onnx" / fitxer_onnx), so, providers=["CPUExecutionProvider"])
        self.entrades = [i.name for i in self.s.get_inputs()]   # input_ids, attention_mask (, token_type_ids)
        self.max_paraules = max_paraules
        self.te_majuscules = any(m is not None for _, m in self.etiquetes.values())

    def _especials(self, carpeta: Path, cfg: dict) -> tuple[int, int]:
        tj = json.loads((carpeta / "tokenizer.json").read_text(encoding="utf-8"))
        pp = tj.get("post_processor") or {}
        if pp.get("type") == "RobertaProcessing":
            return int(pp["cls"][1]), int(pp["sep"][1])
        for nom_ini, nom_fi in (("<s>", "</s>"), ("[CLS]", "[SEP]")):
            a, b = self.tok.token_to_id(nom_ini), self.tok.token_to_id(nom_fi)
            if a is not None and b is not None:
                return a, b
        return int(cfg.get("bos_token_id", 0)), int(cfg.get("eos_token_id", 2))

    def codifica(self, paraules: list[str]) -> tuple[list[int], list[int]]:
        """ids i, per a cada paraula, la posició del seu primer token."""
        ids, primers = [self.inici], []
        for w in paraules:
            t = self.tok.encode(" " + w, add_special_tokens=False).ids
            primers.append(len(ids))
            ids.extend(t)
        ids.append(self.final)
        return ids, primers

    def prediu(self, paraules: list[str]) -> tuple[list, list]:
        punts, majs = [None] * len(paraules), [None] * len(paraules)
        for ini, fi, des_de, fins_a in finestres(len(paraules), self.max_paraules):
            ids, primers = self.codifica(paraules[ini:fi])
            ids = ids[:512]
            x = np.array([ids], dtype=np.int64)
            feed = {"input_ids": x, "attention_mask": np.ones_like(x), "token_type_ids": np.zeros_like(x)}
            logits = self.s.run(None, {k: feed[k] for k in self.entrades})[0][0]
            for k, pos in enumerate(primers):
                if des_de <= ini + k < fins_a and pos < len(ids) - 1:
                    punts[ini + k], majs[ini + k] = self.etiquetes[int(np.argmax(logits[pos]))]
        return punts, majs


def capitalitza(w: str) -> str:
    for i, c in enumerate(w):
        if c.isalpha():
            return w[:i] + c.upper() + w[i + 1:]
    return w


class Puntuador:
    """signes de `signes` + majúscules (de dins de frase) de `majuscules`."""

    def __init__(self, signes: ModelEtiquetes, majuscules: ModelEtiquetes | None = None,
                 punt_final: bool = True):
        self.signes, self.majuscules, self.punt_final = signes, majuscules, punt_final

    def puntua(self, paraules: list[str]) -> list[tuple[str, str | None]]:
        """Torna, per a cada paraula, (text amb majúscules, signe darrere o None)."""
        if not paraules:
            return []
        punts, majs_s = self.signes.prediu(paraules)
        if self.majuscules is not None:
            punts_m, majs_m = self.majuscules.prediu(paraules)
            inici_umu = [i == 0 or punts_m[i - 1] in FINAL_FRASE for i in range(len(paraules))]
            fiables = {w.lower() for w, m, ini in zip(paraules, majs_m, inici_umu) if m and not ini}
            majs = [bool(m) and (not ini or w.lower() in fiables)
                    for w, m, ini in zip(paraules, majs_m, inici_umu)]
        else:
            majs = [bool(m) for m in majs_s]
        res, inici = [], True
        for w, p, m in zip(paraules, punts, majs):
            res.append((capitalitza(w) if (m or inici) else w, p))
            inici = p in FINAL_FRASE
        if self.punt_final:
            w, p = res[-1]
            if p is None or p not in ".?!:;":
                res[-1] = (w, ".")
        return res

    @staticmethod
    def text(res: list[tuple[str, str | None]]) -> str:
        return " ".join(w + (p or "") for w, p in res)
