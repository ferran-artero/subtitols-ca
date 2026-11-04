# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Encoder + descodificació RNNT greedy, amb l'instant on surt cada token.

encoder.onnx:       mel [1, 80, T] + llargada [1]  ->  [1, 512, T'] (una trama cada 40 ms)
decoder_joint.onnx: una trama de l'encoder [1, 512, 1], l'últim token [1, 1] (int32), la
                    llargada [1] (int32) i els dos estats de la LSTM [1, 1, 640]
                    ->  logits [1, 1, 1, 257] i els estats nous

Per a cada trama t (com a molt max_simbols vegades):
    k = argmax(logits - penal[t] al blank)
    si k és el blank: trama següent (l'últim token i els estats no canvien)
    si no: s'emet k a la trama t, últim = k, estats = estats nous
Al principi, l'últim token és el blank (inici de seqüència).
"""
import json
from pathlib import Path

import numpy as np

# encoder: q8w = pesos de 8 bits (MatMulNBits, 191 MB); fp32 = original (481 MB).
# El decoder_joint sempre en float32: es crida milers de vegades i en 8 bits va 5 vegades més lent.
ENCODERS = {"q8w": "encoder.q8w.onnx", "fp32": "encoder.onnx"}


class RNNT:
    def __init__(self, carpeta: Path, variant: str = "q8w", fils: int | None = None):
        import onnxruntime as ort
        carpeta = Path(carpeta)
        cfg = json.loads((carpeta / "config.json").read_text(encoding="utf-8"))
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if fils:
            so.intra_op_num_threads = fils
        prov = ["CPUExecutionProvider"]
        self.enc = ort.InferenceSession(str(carpeta / ENCODERS[variant]), so, providers=prov)
        self.dec = ort.InferenceSession(str(carpeta / "decoder_joint.onnx"), so, providers=prov)
        self.n_enc = [i.name for i in self.enc.get_inputs()]
        d = self.dec.get_inputs()
        self.n_dec = [i.name for i in d[:3]]
        self.n_estats = [i.name for i in d[3:]]
        self.blank = int(cfg["blank_id"])
        self.max_simbols = int(cfg.get("max_symbols_per_step", 10))
        self.seg_trama = float(cfg.get("segons_per_instant", 0.04))
        self.peces = (carpeta / "tokens.txt").read_text(encoding="utf-8").split("\n")[: self.blank]

    def encoder(self, mel: np.ndarray, valides: int) -> tuple[np.ndarray, int]:
        out, lon = self.enc.run(None, {self.n_enc[0]: mel[None], self.n_enc[1]: np.array([valides], np.int64)})
        return out, int(lon[0])                                   # [1, 512, T'], T'

    def descodifica(self, enc: np.ndarray, T: int, penal=0.0) -> tuple[list[int], list[int]]:
        """penal: es resta al logit del blank; un número o un vector amb un valor per trama."""
        penal = np.broadcast_to(np.asarray(penal, dtype=np.float32), (T,))
        estats = [np.zeros((1, 1, 640), np.float32), np.zeros((1, 1, 640), np.float32)]
        ultim = self.blank
        lon = np.array([1], np.int32)
        ids, trames = [], []
        for t in range(T):
            f = np.ascontiguousarray(enc[:, :, t:t + 1])
            for _ in range(self.max_simbols):
                feed = {self.n_dec[0]: f, self.n_dec[1]: np.array([[ultim]], np.int32), self.n_dec[2]: lon,
                        self.n_estats[0]: estats[0], self.n_estats[1]: estats[1]}
                eix = self.dec.run(None, feed)
                logits = eix[0].reshape(-1).copy()
                logits[self.blank] -= penal[t]
                k = int(np.argmax(logits))
                if k == self.blank:
                    break
                ids.append(k)
                trames.append(t)
                ultim = k
                estats = eix[-2:]                      # [logits, llargades, estat1, estat2]
        return ids, trames
