# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Encoder + descodificació RNNT greedy (lot d'1), amb l'instant on surt cada token.

decoder_joint.onnx rep: un instant de l'encoder [1, D, 1], l'últim token [1, 1] (int32),
la longitud [1] (int32) i els dos estats de la LSTM [1, 1, 640]. Torna els logits
[1, 1, 1, V+1] i els estats nous. Algorisme, per a cada instant t de l'encoder:

    repeteix (com a molt max_simbols vegades):
        k = argmax(decoder_joint(enc[t], últim, estats))
        si k és el blank: passa a l'instant següent (sense tocar l'últim ni els estats)
        si no: emet k a l'instant t, últim = k, estats = estats nous

Al principi, "últim" és el blank: el decoder el tracta com a inici de seqüència.

Penalització del blank (penal_blank): es resta al logit del blank abans de l'argmax. Els RNNT
de vegades s'"encallen" emetent blank durant segons (sobretot amb música o soroll de fons) i
es mengen frases senceres; una penalització petita (≈1-3) ho evita.
"""
import json
from pathlib import Path

import numpy as np


def _tipus(entrada) -> type:
    return np.int32 if "int32" in entrada.type else np.int64 if "int64" in entrada.type else np.float32


class RNNT:
    def __init__(self, carpeta: Path, sufix: str = ".int8pc", fils: int | None = None, sufix_dec: str | None = None,
                 penal_blank: float = 0.0):
        """sufix: variant de l'encoder; sufix_dec: del decoder_joint (per defecte, la mateixa)."""
        import onnxruntime as ort
        carpeta = Path(carpeta)
        self.cfg = json.loads((carpeta / "config.json").read_text(encoding="utf-8"))
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if fils:
            so.intra_op_num_threads = fils
        prov = ["CPUExecutionProvider"]
        self.enc = ort.InferenceSession(str(carpeta / f"encoder{sufix}.onnx"), so, providers=prov)
        sufix_dec = sufix if sufix_dec is None else sufix_dec
        self.dec = ort.InferenceSession(str(carpeta / f"decoder_joint{sufix_dec}.onnx"), so, providers=prov)
        e = self.enc.get_inputs()
        self.n_audio, self.n_lon, self.t_lon = e[0].name, e[1].name, _tipus(e[1])
        d = self.dec.get_inputs()
        self.n_enc, self.n_tgt, self.n_len = d[0].name, d[1].name, d[2].name
        self.t_tgt, self.t_len = _tipus(d[1]), _tipus(d[2])
        self.estats_noms = [i.name for i in d[3:]]
        self.estats0 = [np.zeros([s if isinstance(s, int) else 1 for s in i.shape], dtype=np.float32)
                        for i in d[3:]]
        self.blank = int(self.cfg["blank_id"])
        self.penal_blank = float(penal_blank)
        self.max_simbols = int(self.cfg.get("max_symbols_per_step", 10))
        self.seg_instant = float(self.cfg.get("segons_per_instant", 0.04))
        self.peces = (carpeta / "tokens.txt").read_text(encoding="utf-8").split("\n")[: self.blank]

    def encoder(self, mel: np.ndarray, valides: int) -> tuple[np.ndarray, int]:
        out, lon = self.enc.run(None, {self.n_audio: mel[None].astype(np.float32),
                                       self.n_lon: np.array([valides], dtype=self.t_lon)})
        return out, int(lon[0])                                   # [1, D, T'], T'

    def descodifica(self, enc_out: np.ndarray, T: int,
                    penal_blank: "float | np.ndarray | None" = None) -> tuple[list[int], list[int]]:
        """penal_blank: si es dona, substitueix la penalització per defecte només en aquesta crida.
        Pot ser un número (tots els instants) o un vector de T valors (un per instant de l'encoder):
        així es pot penalitzar el blank només dins dels forats on el model s'ha encallat."""
        penal = self.penal_blank if penal_blank is None else penal_blank
        per_instant = isinstance(penal, np.ndarray)
        estats = self.estats0
        ultim = self.blank
        lon = np.array([1], dtype=self.t_len)
        ids, instants = [], []
        for t in range(T):
            f = np.ascontiguousarray(enc_out[:, :, t:t + 1])
            pt = float(penal[t]) if per_instant else float(penal)
            for _ in range(self.max_simbols):
                feed = {self.n_enc: f, self.n_tgt: np.array([[ultim]], dtype=self.t_tgt), self.n_len: lon}
                feed.update(zip(self.estats_noms, estats))
                eix = self.dec.run(None, feed)
                logits = eix[0].reshape(-1)
                if pt:
                    logits = logits.copy()
                    logits[self.blank] -= pt
                k = int(np.argmax(logits))
                if k == self.blank:
                    break
                ids.append(k)
                instants.append(t)
                ultim = k
                estats = eix[-len(estats):]
        return ids, instants

    def text(self, ids: list[int]) -> str:
        """Com SentencePiece: s'ajunten les peces i '▁' és un espai."""
        return "".join(self.peces[i] for i in ids).replace("▁", " ").strip()
