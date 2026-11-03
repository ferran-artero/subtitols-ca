# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Motor complet: àudio 16 kHz -> paraules amb temps, signes i majúscules.

    motor = Motor("models_onnx")
    res = motor.transcriu(audio)        # dict, vegeu `transcriu`
"""
import time
from pathlib import Path

import numpy as np

from .mel import Mel
from .paraules import a_paraules
from .puntua import ModelEtiquetes, Puntuador
from .rnnt import RNNT
from .vad import SR, VAD, ParamsVAD

VERSIO = 3              # 3: rescat en tres etapes (tros, forats escalats, finestra curta)

# Rescat de frases perdudes: el Conformer de vegades s'"encalla" emetent blank durant segons
# (sobretot amb música de fons i en trossos llargs; NeMo original fa el mateix) i al voltant es
# menja paraules soltes. Cada tros es descodifica primer sense penalització. Si a la seua zona
# pròpia queda un forat (≥ RESCAT_FORAT s sense paraules i amb ≥ RESCAT_VEU_FRAC d'aquest temps
# amb veu segons el VAD):
#   1. el tros és "difícil": es torna a descodificar (només el bucle RNNT, l'encoder no) restant
#      RESCAT_PENAL al logit del blank a TOT el tros (recupera també les paraules soltes);
#   2. si encara queda algun forat, es torna a passar per l'encoder NOMÉS una finestra curta al
#      voltant del forat: amb trossos llargs (> 15 s, més que els clips amb què es va entrenar)
#      l'encoder de vegades "no sent" una frase que en una finestra curta reconeix perfectament.
#      Com que el resultat depén del context exacte, es proven finestres de ± RESCAT_FINESTRES s
#      (sense penalització i amb la del rescat) fins que una tanca el forat. De la finestra només
#      s'agafen les paraules que cauen dins del forat: la resta del tros no canvia mai;
#   3. si tot i això queda algun forat, la penalització NOMÉS d'aquell forat (± RESCAT_MARGE s)
#      puja +1 cada vegada fins a RESCAT_MAX.
# Els trossos sense forats no canvien: als àudios nets no s'hi aplica mai (una penalització fixa
# a tot arreu hi faria inventar paraules).
RESCAT_FORAT = 0.7
RESCAT_VEU_FRAC = 0.75
RESCAT_LLINDAR = 0.5
RESCAT_PENAL = 2.0
RESCAT_MAX = 4.0
RESCAT_MARGE = 0.2
RESCAT_FINESTRES = (1.0, 2.0, 0.5, 3.0)   # s de context a cada costat del forat a l'etapa 3, per ordre
SEG_VAD = 0.032           # segons per finestra del VAD (512 mostres a 16 kHz)


def forats_amb_veu(paraules: list[dict], ini: float, fi: float, probs: np.ndarray | None,
                   minim: float = RESCAT_FORAT, frac: float = RESCAT_VEU_FRAC,
                   llindar: float = RESCAT_LLINDAR) -> list[tuple[float, float]]:
    """Intervals entre `ini` i `fi` (la zona pròpia del tros) sense cap paraula, d'almenys `minim` s,
    dels quals almenys una fracció `frac` és veu segons el VAD (probabilitat ≥ `llindar`).
    Sense VAD, cap."""
    if probs is None:
        return []
    temps = [ini] + [min(max(t, ini), fi) for p in paraules for t in (p["ini"], p["fi"])] + [fi]
    res = []
    for a, b in zip(temps[0::2], temps[1::2]):            # (fi anterior, inici següent)
        if b - a < minim:
            continue
        i0, i1 = int(a / SEG_VAD), int(b / SEG_VAD)
        if float((probs[i0:i1] >= llindar).sum()) * SEG_VAD < frac * minim:
            continue
        res.append((round(a, 2), round(b, 2)))
    return res


# Variants del Conformer a models_onnx/conformer-ca-es/: (sufix de l'encoder, sufix del decoder_joint)
# El decoder_joint és petit (17 MB) però es crida milers de vegades amb matrius petites: en
# MatMulNBits va 5 vegades més lent, per això les variants q*w el deixen en float32.
VARIANTS_ASR = {
    "fp32": ("", ""),                 # sense quantitzar (459 + 17 MB)
    "int8": (".int8", ".int8"),       # int8 dinàmic (pesos i activacions)
    "int8pc": (".int8pc", ".int8pc"), # int8 dinàmic per canal (fase 1): inestable, perd frases
    "q8w": (".q8w", ""),              # encoder amb pesos de 8 bits (onnx_quantitza_pesos.py)
    "q4w": (".q4w", ""),              # encoder amb pesos de 4 bits: perd massa qualitat
}
ASR_PER_DEFECTE = "q8w"          # estable com fp32 i 182 MB (fase 2)

# Fitxers de models_onnx/ que fa servir (els mateixos que baixarà la web)
FITXERS = {
    "asr": "conformer-ca-es",                    # + encoder/decoder_joint{sufix}.onnx (VARIANTS_ASR)
    "vad": "silero-vad/silero_vad.onnx",
    "signes": ("softcatala", "model_q8pc.onnx"),
    "majuscules": ("umu-oficial", "model.onnx"),   # int8 de la UMU (onnx_baixa_umu_oficial.py)
}


def llig_model_punt(nom: str) -> tuple[str, str]:
    """'umu-oficial' -> ('umu-oficial', 'model.onnx'); 'umu/model_q8pc.onnx' -> ('umu', 'model_q8pc.onnx')."""
    nom = nom.replace("\\", "/").strip("/")
    if nom.endswith(".onnx"):
        carpeta, fitxer = nom.rsplit("/", 1)
        return carpeta.replace("/onnx", ""), fitxer
    return nom, "model.onnx"


def ajunta(totes: list[dict], noves: list[dict]) -> None:
    """Afegeix les paraules d'un tros a les anteriors. A la frontera d'un tall forçat, els dos
    trossos poden haver vist la mateixa paraula amb temps lleugerament diferents: si una paraula
    nova comença abans que acabe l'última anterior i és la mateixa, es descarta; si és diferent,
    se li ajusta l'inici perquè l'ordre i els temps siguen coherents."""
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
    def __init__(self, models: str | Path, fils: int | None = None, params_vad: ParamsVAD | None = None,
                 asr: str | None = None, fitxer_punt: str | None = None, penal_blank: float = 0.0,
                 rescat: float = RESCAT_PENAL, rescat_max: float = RESCAT_MAX, rescat_forat: float = RESCAT_FORAT,
                 majuscules: str | None = None, finestres: tuple = RESCAT_FINESTRES):
        """penal_blank: penalització fixa (tot arreu); rescat: penalització inicial només dins dels
        forats on hi ha veu (0 = sense rescat); rescat_max: fins on pot pujar; rescat_forat: durada
        mínima d'un forat (s); finestres: marges (s) de l'etapa 2, () = sense; majuscules: model de majúscules, "carpeta" (amb onnx/model.onnx) o
        "carpeta/fitxer.onnx" dins de models_onnx (per defecte FITXERS["majuscules"])."""
        models = Path(models)
        t0 = time.perf_counter()
        conf = models / FITXERS["asr"]
        self.asr = asr or ASR_PER_DEFECTE
        sufix_enc, sufix_dec = VARIANTS_ASR[self.asr]
        self.rnnt = RNNT(conf, sufix_enc, fils, sufix_dec, penal_blank)
        self.rescat = float(rescat)
        self.rescat_max = max(float(rescat_max), self.rescat)
        self.rescat_forat = float(rescat_forat)
        self.finestres = tuple(float(f) for f in finestres)      # () = sense etapa 3
        self.mel = Mel(np.load(conf / "mel_fb.npy"), np.load(conf / "finestra.npy"))
        self.vad = VAD(str(models / FITXERS["vad"]), params_vad, fils)
        (cs, fs), (cm, fm) = FITXERS["signes"], llig_model_punt(majuscules) if majuscules else FITXERS["majuscules"]
        self.puntuador = Puntuador(ModelEtiquetes(models / cs, fitxer_punt or fs, fils),
                                   ModelEtiquetes(models / cm, fitxer_punt or fm, fils))
        self.temps_carrega = time.perf_counter() - t0

    def _omple_finestra(self, senyal: np.ndarray, paraules: list[dict], forat: tuple[float, float],
                        probs: np.ndarray) -> tuple[list[dict], dict | None]:
        """Etapa 2 del rescat: torna a reconéixer finestres curtes al voltant del `forat` i hi afig les paraules
        que hi cauen dins (sense tocar les altres). Es queda amb la primera finestra que tanca el
        forat; si cap no el tanca, amb la que més paraules hi posa. Torna (paraules, què s'ha usat)."""
        a, b = forat
        abans = [p for p in paraules if (p["ini"] + p["fi"]) / 2 < a]
        despres = [p for p in paraules if (p["ini"] + p["fi"]) / 2 >= b]
        millor, usat = [], None
        for marge in self.finestres:
            w0 = max(0.0, a - marge)
            w1 = min(len(senyal) / SR, b + marge)
            mel, valides = self.mel(senyal[int(w0 * SR):int(w1 * SR)])
            enc, T = self.rnnt.encoder(mel, valides)
            for pen in (self.rnnt.penal_blank, self.rnnt.penal_blank + self.rescat):
                ids, inst = self.rnnt.descodifica(enc, T, penal_blank=pen)
                cand = [p for p in a_paraules(ids, inst, self.rnnt.peces, w0, self.rnnt.seg_instant)
                        if a <= (p["ini"] + p["fi"]) / 2 < b]
                # la finestra pot tornar a veure la paraula de just abans o just després del forat
                if cand and abans and cand[0]["text"] == abans[-1]["text"] and cand[0]["ini"] < a + 0.3:
                    cand = cand[1:]
                if cand and despres and cand[-1]["text"] == despres[0]["text"] and cand[-1]["fi"] > b - 0.3:
                    cand = cand[:-1]
                if not cand:
                    continue
                if not forats_amb_veu(cand, a, b, probs, minim=self.rescat_forat):
                    return cand, {"marge": marge, "penal": pen, "tancat": True}
                if len(cand) > len(millor):
                    millor, usat = cand, {"marge": marge, "penal": pen, "tancat": False}
        return millor, usat

    def asr_tros(self, x: np.ndarray, inici: float, probs: np.ndarray | None = None,
                 propi: tuple[float, float] | None = None, senyal: np.ndarray | None = None) -> dict:
        """Un tros (≤ 25 s): mel -> encoder -> RNNT (+ rescat). `propi`: zona on el tros és el
        responsable de les paraules (els forats només es busquen allí). Torna ids, instants, paraules i temps."""
        t = {}
        t0 = time.perf_counter()
        mel, valides = self.mel(x)
        t["mel"] = time.perf_counter() - t0
        t0 = time.perf_counter()
        enc, T = self.rnnt.encoder(mel, valides)
        t["encoder"] = time.perf_counter() - t0
        t0 = time.perf_counter()
        ids, instants = self.rnnt.descodifica(enc, T)
        paraules = a_paraules(ids, instants, self.rnnt.peces, inici, self.rnnt.seg_instant)
        fi = inici + len(x) / SR
        z0, z1 = propi or (inici, fi)
        forats = lambda ps: forats_amb_veu(ps, z0, z1, probs, minim=self.rescat_forat)
        rescat = []                    # [{"forat": [a, b], "penal": p, "abast": "tros"|"forat"}]
        trobats = forats(paraules) if self.rescat > 0 else []
        if trobats:
            base = self.rnnt.penal_blank
            penal = np.full(T, base + self.rescat, dtype=np.float32)       # 1. tot el tros
            rescat += [{"forat": [a, b], "penal": self.rescat, "abast": "tros"} for a, b in trobats]
            ids, instants = self.rnnt.descodifica(enc, T, penal_blank=penal)
            paraules = a_paraules(ids, instants, self.rnnt.peces, inici, self.rnnt.seg_instant)
            si, nivell = self.rnnt.seg_instant, self.rescat + 1.0
            trobats = forats(paraules)
            afegides = []

            def etapa_finestra():
                nonlocal trobats
                if not (trobats and senyal is not None and self.finestres):
                    return
                for forat in trobats:
                    noves, usat = self._omple_finestra(senyal, paraules + afegides, forat, probs)
                    rescat.append({"forat": list(forat), "penal": usat and usat["penal"], "abast": "finestra",
                                   "marge": usat and usat["marge"], "paraules": len(noves)})
                    afegides.extend(noves)
                trobats = forats(sorted(paraules + afegides, key=lambda p: p["ini"]))

            etapa_finestra()                                                 # 2. finestra curta
            while trobats and nivell <= self.rescat_max + 1e-6:              # 3. només els forats
                for a, b in trobats:
                    i0 = max(0, int((a - RESCAT_MARGE - inici) / si))
                    i1 = min(T, int(np.ceil((b + RESCAT_MARGE - inici) / si)))
                    penal[i0:i1] = np.maximum(penal[i0:i1], base + nivell)
                    rescat.append({"forat": [a, b], "penal": nivell, "abast": "forat"})
                ids, instants = self.rnnt.descodifica(enc, T, penal_blank=penal)
                nou = a_paraules(ids, instants, self.rnnt.peces, inici, self.rnnt.seg_instant)
                # les paraules ja afegides per l'etapa 3 tenen preferència dins del seu forat
                ocupat = [(p["ini"], p["fi"]) for p in afegides]
                paraules = [p for p in nou if not any(i0 - 0.05 < (p["ini"] + p["fi"]) / 2 < f0 + 0.05
                                                      for i0, f0 in ocupat)]
                trobats = forats(sorted(paraules + afegides, key=lambda p: p["ini"]))
                nivell += 1.0
            paraules = sorted(paraules + afegides, key=lambda p: p["ini"])
        t["decoder"] = time.perf_counter() - t0
        return {"rescat": rescat, "ini": round(inici, 3), "fi": round(fi, 3), "trames_mel": int(mel.shape[1]),
                "valides": valides, "mel_suma": float(mel.sum()), "mel_primera": mel[:, 0].round(5).tolist(),
                "ids": ids, "instants": instants, "paraules": paraules, "temps": t}

    def transcriu(self, x: np.ndarray, sense_vad: bool = False, puntua: bool = True,
                  progres=None) -> dict:
        """sense_vad=True: tot l'àudio com un sol tros (només per a àudios curts i proves)."""
        durada = len(x) / SR
        t_total = time.perf_counter()
        t0 = time.perf_counter()
        if sense_vad:
            trossos = [{"ini": 0.0, "fi": durada, "propi_ini": 0.0, "propi_fi": durada, "forcat": False}]
            probs = None          # sense VAD no hi ha rescat: és el mode de proves
        else:
            trossos, probs = self.vad.trossos(x)
        t_vad = time.perf_counter() - t0

        resultats = []
        for i, tr in enumerate(trossos):
            r = self.asr_tros(x[int(tr["ini"] * SR):int(tr["fi"] * SR)], tr["ini"], probs,
                              (tr["propi_ini"], tr["propi_fi"]), senyal=x)
            r["forcat"] = tr["forcat"]
            r["propi"] = [round(tr["propi_ini"], 3), round(tr["propi_fi"], 3)]
            if tr["forcat"]:     # només les paraules el centre de les quals cau a la zona pròpia
                r["paraules"] = [p for p in r["paraules"]
                                 if tr["propi_ini"] <= (p["ini"] + p["fi"]) / 2 < tr["propi_fi"]]
            resultats.append(r)
            if progres:
                progres(i + 1, len(trossos), r)
        paraules: list[dict] = []
        for r in resultats:
            ajunta(paraules, r["paraules"])

        t0 = time.perf_counter()
        if puntua and paraules:
            for p, (w, s) in zip(paraules, self.puntuador.puntua([p["text"] for p in paraules])):
                p["cru"], p["text"], p["punt"] = p["text"], w, s
        t_punt = time.perf_counter() - t0

        total = time.perf_counter() - t_total
        temps = {"vad": t_vad, "puntuacio": t_punt, "total": total,
                 **{k: sum(r["temps"][k] for r in resultats) for k in ("mel", "encoder", "decoder")}}
        temps = {k: round(v, 3) for k, v in temps.items()}
        temps["rtf"] = round(total / durada, 4) if durada else None
        return {
            "versio": VERSIO,
            "durada_s": round(durada, 3),
            "text": " ".join(p["text"] + (p.get("punt") or "") for p in paraules),
            "paraules": paraules,
            "trossos": [{k: v for k, v in r.items() if k != "paraules"} for r in resultats],
            "temps": temps,
        }
