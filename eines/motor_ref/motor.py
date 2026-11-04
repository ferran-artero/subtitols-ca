# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Motor complet: àudio 16 kHz -> paraules amb temps, signes i majúscules.

    motor = Motor("models_onnx")
    r = motor.transcriu(audio)    # {durada_s, text, paraules: [{text, ini, fi, cru, punt}], trossos, temps}

Rescat de frases perdudes. El Conformer de vegades s'"encalla" emetent blank durant segons
(sobretot amb música i en trossos llargs; NeMo original fa el mateix) i al voltant es menja
paraules soltes. Un forat és un interval de la zona pròpia d'un tros sense paraules, de
≥ FORAT s, on ≥ 75 % del temps el VAD diu que hi ha veu. Si un tros té cap forat:
  1. es torna a descodificar TOT el tros amb el blank penalitzat PENAL (l'encoder no es repeteix);
  2. per a cada forat que quede, es torna a passar per l'encoder només una finestra curta al
     voltant del forat (± FINESTRES s, per ordre; sense penalitzar i amb PENAL) i se n'agafen
     les paraules de dins del forat; es queda la primera que el tanca o, si cap, la que hi posa
     més paraules. (Amb trossos llargs l'encoder de vegades "no sent" una frase que en una
     finestra curta reconeix bé.)
  3. si encara queden forats, la penalització puja a PENAL+1 ... PENAL_MAX només dins dels
     forats (± MARGE s); les paraules de l'etapa 2 tenen preferència.
En àudios nets no s'activa mai (als 38 clips de prova el text no canvia).
"""
import time
from pathlib import Path

import numpy as np

from .mel import Mel
from .paraules import a_paraules
from .puntua import ModelEtiquetes, Puntuador
from .rnnt import RNNT
from .vad import SEG_FINESTRA, SR, VAD

FORAT = 0.7                     # s: durada mínima d'un forat
VEU_FRAC = 0.75                 # fracció del forat amb veu segons el VAD
VEU_LLINDAR = 0.5               # probabilitat del VAD que compta com a veu
PENAL = 2.0                     # penalització del blank a l'etapa 1
PENAL_MAX = 4.0                 # fins on puja a l'etapa 3
MARGE = 0.2                     # s al voltant del forat a l'etapa 3
FINESTRES = (1.0, 2.0, 0.5, 3.0)  # s de context a cada costat del forat a l'etapa 2

# Fitxers dins de la carpeta de models (els mateixos que baixa la web)
CONFORMER = "conformer-ca-es"
SILERO = "silero-vad/silero_vad.onnx"
SOFTCATALA = ("softcatala", "model_q8pc.onnx")
UMU = ("umu-oficial", "model.onnx")


def centre(p: dict) -> float:
    return (p["ini"] + p["fi"]) / 2


def forats(paraules: list[dict], ini: float, fi: float, probs: np.ndarray) -> list[tuple[float, float]]:
    """Intervals sense paraules dins de [ini, fi), de ≥ FORAT s i amb prou veu segons el VAD."""
    temps = [ini] + [min(max(t, ini), fi) for p in paraules for t in (p["ini"], p["fi"])] + [fi]
    res = []
    for a, b in zip(temps[0::2], temps[1::2]):            # (fi anterior, inici següent)
        if b - a < FORAT:
            continue
        i0, i1 = int(a / SEG_FINESTRA), int(b / SEG_FINESTRA)
        if float((probs[i0:i1] >= VEU_LLINDAR).sum()) * SEG_FINESTRA >= VEU_FRAC * FORAT:
            res.append((round(a, 2), round(b, 2)))
    return res


def ajunta(totes: list[dict], noves: list[dict]) -> None:
    """Afegeix les paraules d'un tros. A la vora d'un tall forçat els dos trossos poden veure la
    mateixa paraula: si una paraula nova comença abans que acabe l'anterior i és la mateixa, es
    descarta; si és diferent, se li ajusta l'inici."""
    if not totes:
        totes.extend(noves)
        return
    ult = totes[-1]
    for k, p in enumerate(noves):
        if p["ini"] >= ult["fi"]:
            totes.extend(noves[k:])
            return
        if p["text"] == ult["text"]:
            continue
        p["ini"] = ult["fi"]
        p["fi"] = round(max(p["fi"], p["ini"] + 0.04), 3)
        totes.append(p)


class Motor:
    def __init__(self, models: str | Path, fils: int | None = None, asr: str = "q8w", rescat: bool = True):
        """asr: "q8w" (per defecte) o "fp32"; rescat=False desactiva el rescat (per a comparar)."""
        models = Path(models)
        t0 = time.perf_counter()
        conf = models / CONFORMER
        self.rnnt = RNNT(conf, asr, fils)
        self.mel = Mel(np.load(conf / "mel_fb.npy"), np.load(conf / "finestra.npy"))
        self.vad = VAD(str(models / SILERO), fils=fils)
        self.puntuador = Puntuador(ModelEtiquetes(models / SOFTCATALA[0], SOFTCATALA[1], fils),
                                   ModelEtiquetes(models / UMU[0], UMU[1], fils))
        self.rescat = rescat
        self.temps_carrega = time.perf_counter() - t0

    def _paraules(self, enc, T, inici, penal=0.0) -> tuple[list[dict], list[int], list[int]]:
        ids, trames = self.rnnt.descodifica(enc, T, penal)
        return a_paraules(ids, trames, self.rnnt.peces, inici, self.rnnt.seg_trama), ids, trames

    def _finestra(self, x: np.ndarray, paraules: list[dict], forat: tuple[float, float],
                  probs: np.ndarray) -> tuple[list[dict], dict | None]:
        """Etapa 2: finestres curtes al voltant del forat; torna les paraules de dins i què s'ha usat."""
        a, b = forat
        abans = [p for p in paraules if centre(p) < a]
        despres = [p for p in paraules if centre(p) >= b]
        millor, usat = [], None
        for m in FINESTRES:
            w0, w1 = max(0.0, a - m), min(len(x) / SR, b + m)
            enc, T = self.rnnt.encoder(*self.mel(x[int(w0 * SR):int(w1 * SR)]))
            for pen in (0.0, PENAL):
                cand = [p for p in self._paraules(enc, T, w0, pen)[0] if a <= centre(p) < b]
                # la finestra pot tornar a veure la paraula de just abans o de just després
                if cand and abans and cand[0]["text"] == abans[-1]["text"] and cand[0]["ini"] < a + 0.3:
                    cand = cand[1:]
                if cand and despres and cand[-1]["text"] == despres[0]["text"] and cand[-1]["fi"] > b - 0.3:
                    cand = cand[:-1]
                if not cand:
                    continue
                if not forats(cand, a, b, probs):
                    return cand, {"marge": m, "penal": pen, "tancat": True}
                if len(cand) > len(millor):
                    millor, usat = cand, {"marge": m, "penal": pen, "tancat": False}
        return millor, usat

    def asr_tros(self, x: np.ndarray, tros: dict, probs: np.ndarray) -> dict:
        """Un tros del VAD: mel -> encoder -> RNNT (+ rescat). Torna paraules, ids i temps."""
        t0 = time.perf_counter()
        ini = tros["ini"]
        enc, T = self.rnnt.encoder(*self.mel(x[int(ini * SR):int(tros["fi"] * SR)]))
        t_enc = time.perf_counter() - t0
        paraules, ids, trames = self._paraules(enc, T, ini)
        zona = lambda ps: forats(sorted(ps, key=lambda p: p["ini"]), tros["propi_ini"], tros["propi_fi"], probs)
        rescat = []
        oberts = zona(paraules) if self.rescat else []
        if oberts:
            # 1. tot el tros amb penalització
            rescat += [{"forat": list(f), "penal": PENAL, "abast": "tros"} for f in oberts]
            penal = np.full(T, PENAL, dtype=np.float32)
            paraules, ids, trames = self._paraules(enc, T, ini, penal)
            # 2. finestres curtes
            afegides = []
            for f in zona(paraules):
                noves, usat = self._finestra(x, paraules + afegides, f, probs)
                rescat.append({"forat": list(f), "penal": usat and usat["penal"], "abast": "finestra",
                               "marge": usat and usat["marge"], "paraules": len(noves)})
                afegides += noves
            oberts = zona(paraules + afegides)
            # 3. penalització creixent només dins dels forats
            nivell = PENAL + 1.0
            while oberts and nivell <= PENAL_MAX + 1e-6:
                for a, b in oberts:
                    i0 = max(0, int((a - MARGE - ini) / self.rnnt.seg_trama))
                    i1 = min(T, int(np.ceil((b + MARGE - ini) / self.rnnt.seg_trama)))
                    penal[i0:i1] = np.maximum(penal[i0:i1], nivell)
                    rescat.append({"forat": [a, b], "penal": nivell, "abast": "forat"})
                nou, ids, trames = self._paraules(enc, T, ini, penal)
                ocupat = [(p["ini"], p["fi"]) for p in afegides]
                paraules = [p for p in nou if not any(i - 0.05 < centre(p) < f + 0.05 for i, f in ocupat)]
                oberts = zona(paraules + afegides)
                nivell += 1.0
            paraules = sorted(paraules + afegides, key=lambda p: p["ini"])
        if tros["forcat"]:          # només les paraules el centre de les quals cau a la zona pròpia
            paraules = [p for p in paraules if tros["propi_ini"] <= centre(p) < tros["propi_fi"]]
        return {"ini": round(ini, 3), "fi": round(tros["fi"], 3), "forcat": tros["forcat"],
                "propi": [round(tros["propi_ini"], 3), round(tros["propi_fi"], 3)],
                "ids": ids, "trames": trames, "rescat": rescat, "paraules": paraules,
                "temps": {"encoder": t_enc, "decoder": time.perf_counter() - t0 - t_enc}}

    def transcriu(self, x: np.ndarray, progres=None) -> dict:
        durada = len(x) / SR
        t0 = time.perf_counter()
        trossos, probs = self.vad.trossos(x)
        t_vad = time.perf_counter() - t0
        resultats, paraules = [], []
        for i, tros in enumerate(trossos):
            r = self.asr_tros(x, tros, probs)
            ajunta(paraules, r.pop("paraules"))
            resultats.append(r)
            if progres:
                progres(i + 1, len(trossos), r)
        t1 = time.perf_counter()
        if paraules:
            for p, (w, s) in zip(paraules, self.puntuador.puntua([p["text"] for p in paraules])):
                p["cru"], p["text"], p["punt"] = p["text"], w, s
        total = time.perf_counter() - t0
        temps = {"vad": t_vad, "puntuacio": time.perf_counter() - t1, "total": total,
                 **{k: sum(r["temps"][k] for r in resultats) for k in ("encoder", "decoder")}}
        temps = {k: round(v, 3) for k, v in temps.items()}
        temps["rtf"] = round(total / durada, 4) if durada else None
        return {"durada_s": round(durada, 3),
                "text": " ".join(p["text"] + (p.get("punt") or "") for p in paraules),
                "paraules": paraules, "trossos": resultats, "temps": temps}
