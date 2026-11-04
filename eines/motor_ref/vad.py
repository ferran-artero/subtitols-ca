# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Detecció de veu (Silero VAD v5, ONNX) i tall en trossos per a l'ASR.

1. Probabilitats: l'àudio es processa en finestres de 512 mostres (32 ms). A cada finestra se li
   afegeixen davant les 64 últimes mostres de l'anterior (context) i l'estat [2, 1, 128] passa
   d'una finestra a la següent. És el que fa OnnxWrapper del paquet silero-vad.
2. Segments de veu: comença quan p >= llindar; acaba quan p < llindar - 0.15 durant
   `silenci_min` segons. Es descarten els de menys de `veu_min` i s'amplien `marge` per banda.
3. Trossos per a l'ASR (com a molt `max_tros` segons): s'ajunten segments consecutius si el
   silenci entre ells és curt; un segment massa llarg es talla pel punt de probabilitat més baixa
   entre el 60 % i el 100 % de `max_tros` (tall forçat).
4. Talls forçats: els dos trossos s'allarguen `solap` segons per damunt del tall, perquè l'ASR
   senta sencera la paraula que hi haja just al tall. Cada tros té una zona "pròpia"
   ([propi_ini, propi_fi)): el motor només es queda les paraules el centre de les quals cau dins
   la seua zona pròpia, així cap paraula surt dues vegades.
5. Context: cada tros s'allarga fins a `extensio` segons dins del silenci que l'envolta (sense
   passar de la meitat del silenci fins al tros veí). Sense aquest context el Conformer
   al·lucina.
"""
from dataclasses import dataclass

import numpy as np

SR = 16000
FINESTRA = 512
CONTEXT = 64
SEG_FINESTRA = FINESTRA / SR      # 0,032 s


@dataclass
class ParamsVAD:
    llindar: float = 0.5
    silenci_min: float = 0.30     # s de silenci per a tancar un segment
    veu_min: float = 0.25         # s: segments més curts es descarten
    marge: float = 0.20           # s afegits a cada costat d'un segment
    max_tros: float = 25.0        # s: el Conformer va bé fins a ~30 s
    ajunta_si_silenci: float = 2.0  # s: ajunta segments si el silenci entre ells és menor
    solap: float = 1.0            # s que s'allarga cada tros per banda en un tall forçat
    extensio: float = 0.5         # s de silenci de context afegits a cada vora d'un tros
                                  # (0 dona al·lucinacions; 0,5 i 1 equivalents en WER: fase 2)


class VAD:
    def __init__(self, ruta_onnx: str, params: ParamsVAD | None = None, fils: int | None = None):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = fils or 1
        so.inter_op_num_threads = 1
        self.s = ort.InferenceSession(ruta_onnx, so, providers=["CPUExecutionProvider"])
        self.p = params or ParamsVAD()

    def probabilitats(self, x: np.ndarray) -> np.ndarray:
        """Una probabilitat de veu per cada finestra de 512 mostres."""
        x = np.asarray(x, dtype=np.float32)
        n = int(np.ceil(len(x) / FINESTRA))
        x = np.pad(x, (0, n * FINESTRA - len(x)))
        estat = np.zeros((2, 1, 128), dtype=np.float32)
        context = np.zeros((1, CONTEXT), dtype=np.float32)
        sr = np.array(SR, dtype=np.int64)
        probs = np.empty(n, dtype=np.float32)
        for i in range(n):
            tros = np.concatenate([context, x[None, i * FINESTRA:(i + 1) * FINESTRA]], axis=1)
            out, estat = self.s.run(None, {"input": tros, "state": estat, "sr": sr})
            probs[i] = out[0, 0]
            context = tros[:, -CONTEXT:]
        return probs

    def segments(self, probs: np.ndarray, durada: float) -> list[tuple[float, float]]:
        p = self.p
        baix = max(p.llindar - 0.15, 0.01)
        segs, inici, silenci_des_de = [], None, None
        for i, pr in enumerate(probs):
            t = i * SEG_FINESTRA
            if inici is None:
                if pr >= p.llindar:
                    inici, silenci_des_de = t, None
            elif pr < baix:
                if silenci_des_de is None:
                    silenci_des_de = t
                if t + SEG_FINESTRA - silenci_des_de >= p.silenci_min:
                    segs.append((inici, silenci_des_de))
                    inici, silenci_des_de = None, None
            else:
                silenci_des_de = None
        if inici is not None:
            segs.append((inici, len(probs) * SEG_FINESTRA))
        segs = [(a, b) for a, b in segs if b - a >= p.veu_min]
        # marge i fusió de solapaments
        amb_marge = []
        for a, b in segs:
            a, b = max(0.0, a - p.marge), min(durada, b + p.marge)
            if amb_marge and a <= amb_marge[-1][1]:
                amb_marge[-1] = (amb_marge[-1][0], max(b, amb_marge[-1][1]))
            else:
                amb_marge.append((a, b))
        return amb_marge

    def _parteix(self, a: float, b: float, probs: np.ndarray) -> list[tuple[float, float]]:
        """Talla un segment més llarg que max_tros pel punt de probabilitat mínima
        entre el 60% i el 100% del màxim."""
        p = self.p
        trossos = []
        while b - a > p.max_tros:
            i0 = int((a + 0.6 * p.max_tros) / SEG_FINESTRA)
            i1 = int((a + p.max_tros) / SEG_FINESTRA)
            i = i0 + int(np.argmin(probs[i0:i1])) if i1 > i0 else i1
            tall = i * SEG_FINESTRA
            trossos.append((a, tall))
            a = tall
        trossos.append((a, b))
        return trossos

    def trossos(self, x: np.ndarray) -> tuple[list[dict], np.ndarray]:
        """Trossos per a l'ASR i les probabilitats. Cada tros:
        {ini, fi, propi_ini, propi_fi, forcat}  (segons). Sense talls forçats, propi = [ini, fi]."""
        durada = len(x) / SR
        probs = self.probabilitats(x)
        res: list[dict] = []
        for a, b in self.segments(probs, durada):
            peces = self._parteix(a, b, probs)
            if len(peces) == 1:
                # segment normal: s'ajunta a l'anterior si el silenci és curt i no passa del màxim
                if res and not res[-1]["forcat"] and a - res[-1]["fi"] <= self.p.ajunta_si_silenci \
                        and b - res[-1]["ini"] <= self.p.max_tros:
                    res[-1]["fi"] = res[-1]["propi_fi"] = b
                else:
                    res.append({"ini": a, "fi": b, "propi_ini": a, "propi_fi": b, "forcat": False})
                continue
            for k, (c, d) in enumerate(peces):
                res.append({"ini": c if k == 0 else max(a, c - self.p.solap),
                            "fi": d if k == len(peces) - 1 else min(b, d + self.p.solap),
                            "propi_ini": c, "propi_fi": d, "forcat": True})
        return self._amplia(res, durada), probs

    def _amplia(self, res: list[dict], durada: float) -> list[dict]:
        """Allarga les vores exteriors de cada tros dins del silenci (fins a la meitat del
        silenci que el separa del tros veí). Les vores interiors d'un tall forçat no es toquen."""
        ext = self.p.extensio
        if ext <= 0:
            return res
        orig = [(t["ini"], t["fi"]) for t in res]
        for i, t in enumerate(res):
            continua_ant = i > 0 and res[i - 1]["forcat"] and t["forcat"] and \
                abs(res[i - 1]["propi_fi"] - t["propi_ini"]) < 1e-9
            continua_seg = i + 1 < len(res) and res[i + 1]["forcat"] and t["forcat"] and \
                abs(t["propi_fi"] - res[i + 1]["propi_ini"]) < 1e-9
            if not continua_ant:
                limit = (orig[i - 1][1] + orig[i][0]) / 2 if i > 0 else 0.0
                t["ini"] = t["propi_ini"] = max(limit, orig[i][0] - ext)
            if not continua_seg:
                limit = (orig[i][1] + orig[i + 1][0]) / 2 if i + 1 < len(res) else durada
                t["fi"] = t["propi_fi"] = min(limit, orig[i][1] + ext)
        return res
