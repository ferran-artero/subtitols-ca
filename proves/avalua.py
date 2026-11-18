# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Avalua transcripcions del motor contra les referències humanes.

Mètriques (de corpus: se sumen els recomptes de tots els àudios d'un grup):
  - WER            normalitzat: minúscules, sense signes, apòstrofs i l·l unificats
  - WER formatat   es mantenen les majúscules i cada signe és un token (el que veu l'espectador)
  - F1 puntuació   per a cada parella de paraules alineades, el signe de darrere (classe exacta)
  - F1 majúscules  sobre les paraules encertades, si la inicial és majúscula
  - perdudes       frases perdudes: ≥ 3 paraules seguides de la referència eliminades
  - sincronia      (vídeos amb .ref.srt) inici de la paraula al motor − inici del subtítol
  - RTF            mediana del camp temps.rtf dels JSON

Dades (fora del repositori), a --dades o a la variable d'entorn SUBTITOLS_DADES:
    referencies.tsv           columnes «arxiu» (p. ex. balear/ba_lex_01.wav) i «text»
    videos/<nom>.ref.txt      text de referència d'un vídeo (números en lletres)
    videos/<nom>.ref.srt      opcional: subtítols de referència amb temps (sincronia)

Entrades: JSON del motor (eines/transcriu.py, proves/referencia_motor.py o el banc de proves),
o carpetes que en continguin. El nom de l'àudio és el del fitxer (o el de la carpeta, si el
fitxer es diu motor.json).

    python proves/avalua.py resultats/proves/motor
    python proves/avalua.py resultats/*.json --desa resultats/linia_base.json
    python proves/avalua.py resultats/*.json --compara resultats/linia_base.json   # falla si empitjora
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import re
import statistics
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import jiwer

SIGNES = [",", ".", "?", "!", ":", ";"]
_OBERTURA = "¿¡«“‘\"([{"


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

def _unifica(t: str) -> str:
    t = unicodedata.normalize("NFC", t or "")
    t = t.replace("’", "'").replace("‘", "'").replace("`", "'").replace("´", "'")
    return t.replace("ŀl", "l·l").replace("l.l", "l·l").replace("l•l", "l·l").replace("l∙l", "l·l")


def normalitza(text: str) -> str:
    """Per al WER: minúscules, sense puntuació, apòstrofs unificats (es mantenen dins de la
    paraula: l'home), l·l unificada, guionets com a espai (dóna-li -> dóna li)."""
    t = _unifica(text).lower()
    t = re.sub(r"[-‐‑‒–—]", " ", t)
    t = re.sub(r"[^\w\s'·]", " ", t)
    t = re.sub(r"(?<!\w)'|'(?!\w)", " ", t)           # apòstrofs solts fora
    t = re.sub(r"(?<!l)·|·(?!l)", " ", t)              # punt volat que no sigui l·l
    t = t.replace("_", " ")
    return re.sub(r"\s+", " ", t).strip()


def formata(text: str) -> str:
    """Tokens per al WER formatat: es manté la caixa i cada signe és un token."""
    t = _unifica(text).replace("…", ".")
    t = re.sub(r"[¿¡«»“”\"()\[\]{}]", " ", t)
    t = re.sub(r"([,.?!:;])", r" \1 ", t)
    return re.sub(r"\s+", " ", t).strip()


def te_puntuacio(text: str) -> bool:
    return bool(re.search(r"[,.?!:;]", text or "")) or any(c.isupper() for c in text or "")


def _classe(cua: str) -> str | None:
    """El signe que hi ha darrere d'una paraula (si n'hi ha diversos, el més fort)."""
    cua = (cua or "").replace("…", ".")
    return next((s for s in ("?", "!", ".", ":", ";", ",") if s in cua), None)


@dataclass
class Paraula:
    norm: str            # paraula normalitzada (per alinear)
    maj: bool            # comença en majúscula
    punt: str | None     # signe que la segueix


def _paraules(text: str) -> list[Paraula]:
    res: list[Paraula] = []
    for tok in _unifica(text).split():
        nucli = tok.lstrip(_OBERTURA)
        cos, cua = re.match(r"^(.*?)([^\w·']*)$", nucli).groups()
        punt = _classe(cua)
        peces = normalitza(cos).split()
        if not peces:                       # un signe solt: va a la paraula d'abans
            if punt and res and res[-1].punt is None:
                res[-1].punt = punt
            continue
        primera = next((c for c in cos if c.isalpha()), "")
        for i, p in enumerate(peces):
            res.append(Paraula(p, i == 0 and primera.isupper(), None))
        res[-1].punt = punt
    return res


# ---------------------------------------------------------------------------
# Recomptes
# ---------------------------------------------------------------------------

@dataclass
class Recompte:
    tp: dict = field(default_factory=lambda: dict.fromkeys(SIGNES, 0))
    fp: dict = field(default_factory=lambda: dict.fromkeys(SIGNES, 0))
    fn: dict = field(default_factory=lambda: dict.fromkeys(SIGNES, 0))
    maj_tp: int = 0
    maj_fp: int = 0
    maj_fn: int = 0
    err: int = 0          # errors de paraula (normalitzat)
    n: int = 0            # paraules de la referència
    err_f: int = 0        # errors de token (formatat)
    n_f: int = 0
    perdudes: int = 0
    audios: int = 0
    formatat: bool = True  # totes les hipòtesis tenien puntuació

    def suma(self, o: "Recompte") -> None:
        for s in SIGNES:
            self.tp[s] += o.tp[s]
            self.fp[s] += o.fp[s]
            self.fn[s] += o.fn[s]
        for a in ("maj_tp", "maj_fp", "maj_fn", "err", "n", "err_f", "n_f", "perdudes", "audios"):
            setattr(self, a, getattr(self, a) + getattr(o, a))
        self.formatat &= o.formatat


def _errors(ref: str, hip: str) -> tuple[int, int]:
    if not ref:
        return len(hip.split()), 0
    if not hip:
        return len(ref.split()), len(ref.split())
    o = jiwer.process_words(ref, hip)
    return o.substitutions + o.deletions + o.insertions, o.hits + o.substitutions + o.deletions


def _alineacio(ref: str, hip: str):
    return jiwer.process_words(ref, hip).alignments[0] if ref and hip else []


def frases_perdudes(ref: str, hip: str, minim: int = 3) -> int:
    rn, hn = normalitza(ref), normalitza(hip)
    if not hn:
        return int(len(rn.split()) >= minim)
    return sum(1 for c in _alineacio(rn, hn) if c.type == "delete" and c.ref_end_idx - c.ref_start_idx >= minim)


def recompte(ref: str, hip: str) -> Recompte:
    rc = Recompte(audios=1, formatat=te_puntuacio(hip))
    rw, hw = _paraules(ref), _paraules(hip)
    if not rw:
        return rc
    r_txt, h_txt = " ".join(w.norm for w in rw), " ".join(w.norm for w in hw)
    parelles = []
    if not h_txt:
        parelles = [(i, None, False) for i in range(len(rw))]
    for c in _alineacio(r_txt, h_txt):
        if c.type in ("equal", "substitute"):
            parelles += [(c.ref_start_idx + k, c.hyp_start_idx + k, c.type == "equal")
                         for k in range(c.ref_end_idx - c.ref_start_idx)]
        elif c.type == "delete":
            parelles += [(i, None, False) for i in range(c.ref_start_idx, c.ref_end_idx)]
        elif c.type == "insert":
            parelles += [(None, j, False) for j in range(c.hyp_start_idx, c.hyp_end_idx)]
    for i, j, igual in parelles:
        r = rw[i].punt if i is not None else None
        h = hw[j].punt if j is not None else None
        if r and h and r == h:
            rc.tp[r] += 1
        else:
            if r:
                rc.fn[r] += 1
            if h:
                rc.fp[h] += 1
        if igual:
            a, b = rw[i].maj, hw[j].maj
            rc.maj_tp += a and b
            rc.maj_fn += a and not b
            rc.maj_fp += b and not a
    rc.err, rc.n = _errors(normalitza(ref), normalitza(hip))
    rc.err_f, rc.n_f = _errors(formata(ref), formata(hip))
    rc.perdudes = frases_perdudes(ref, hip)
    return rc


def _f1(tp: int, fp: int, fn: int) -> float | None:
    d = 2 * tp + fp + fn
    return None if d == 0 else 2 * tp / d


# ---------------------------------------------------------------------------
# Sincronia (vídeos amb .ref.srt)
# ---------------------------------------------------------------------------

def llegeix_srt(ruta: Path) -> list[dict]:
    res = []
    for b in re.split(r"\n\s*\n", ruta.read_text(encoding="utf-8-sig").strip()):
        ls = b.strip().splitlines()
        k = next((i for i, l in enumerate(ls) if "-->" in l), None)
        m = k is not None and re.match(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->", ls[k])
        if m:
            h, mi, s, ms = map(int, m.groups())
            res.append({"ini": h * 3600 + mi * 60 + s + ms / 1000, "text": " ".join(ls[k + 1:])})
    return res


def sincronia(cues: list[dict], paraules: list[dict]) -> list[float]:
    rw, rt = [], []
    for c in cues:
        for k, w in enumerate(normalitza(c["text"]).split()):
            rw.append(w)
            rt.append(c["ini"] if k == 0 else None)
    hw, ht = [], []
    for p in paraules:
        for w in normalitza(p["text"]).split():
            hw.append(w)
            ht.append(p["ini"])
    dif = []
    for c in _alineacio(" ".join(rw), " ".join(hw)):
        if c.type == "equal":
            for k in range(c.ref_end_idx - c.ref_start_idx):
                i, j = c.ref_start_idx + k, c.hyp_start_idx + k
                if rt[i] is not None:
                    dif.append(ht[j] - rt[i])
    return dif


def _percentil(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    p = (len(xs) - 1) * q
    a = int(p)
    return xs[a] + (xs[min(a + 1, len(xs) - 1)] - xs[a]) * (p - a)


# ---------------------------------------------------------------------------
# Entrades
# ---------------------------------------------------------------------------

def referencies(dades: Path) -> tuple[dict[str, str], set[str], dict[str, Path]]:
    """Textos de referència per nom d'àudio, noms dels clips i SRT de referència dels vídeos."""
    refs, clips, srts = {}, set(), {}
    tsv = dades / "referencies.tsv"
    if tsv.exists():
        with open(tsv, encoding="utf-8") as f:
            for fila in csv.DictReader(f, delimiter="\t"):
                nom = Path(fila["arxiu"]).stem
                refs[nom] = fila["text"]
                clips.add(nom)
    for t in (dades / "videos").glob("*.ref.txt"):
        nom = t.name[: -len(".ref.txt")]
        refs[nom] = t.read_text(encoding="utf-8").strip()
        if (s := t.with_name(nom + ".ref.srt")).exists():
            srts[nom] = s
    return refs, clips, srts


def hipotesis(rutes: list[str]) -> dict[str, dict]:
    """JSON del motor per nom d'àudio. PowerShell no expandeix *: els patrons es resolen aquí."""
    fitxers = []
    for r in rutes:
        for p in map(Path, sorted(glob.glob(r)) or [r]):
            fitxers += sorted(p.rglob("*.json")) if p.is_dir() else [p]
    res = {}
    for f in fitxers:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(d, dict) or "paraules" not in d:
            continue
        nom = f.parent.name if f.name == "motor.json" else f.stem
        res[nom] = d
    return res


def text_hipotesi(d: dict) -> str:
    if d.get("text"):
        return d["text"]
    return " ".join(p["text"] + (p.get("punt") or "") for p in d["paraules"])


# ---------------------------------------------------------------------------

def avalua(hips: dict[str, dict], refs: dict[str, str], clips: set[str], srts: dict[str, Path]) -> dict[str, dict]:
    grups: dict[str, Recompte] = {}
    sinc: dict[str, list[float]] = {}
    rtf: dict[str, list[float]] = {}
    for nom, d in sorted(hips.items()):
        if nom not in refs:
            continue
        g = "clips" if nom in clips else nom
        grups.setdefault(g, Recompte()).suma(recompte(refs[nom], text_hipotesi(d)))
        if nom in srts:
            sinc.setdefault(g, []).extend(sincronia(llegeix_srt(srts[nom]), d["paraules"]))
        if (r := (d.get("temps") or {}).get("rtf")) is not None:
            rtf.setdefault(g, []).append(r)
    res = {}
    for g, rc in grups.items():
        tp, fp, fn = sum(rc.tp.values()), sum(rc.fp.values()), sum(rc.fn.values())
        s = sinc.get(g) or []
        res[g] = {
            "audios": rc.audios,
            "paraules": rc.n,
            "wer": 100 * rc.err / rc.n if rc.n else None,
            "wer_formatat": 100 * rc.err_f / rc.n_f if rc.n_f and rc.formatat else None,
            "f1_puntuacio": _f1(tp, fp, fn) if rc.formatat else None,
            "f1_majuscules": _f1(rc.maj_tp, rc.maj_fp, rc.maj_fn) if rc.formatat else None,
            "perdudes": rc.perdudes,
            "sincronia": statistics.median(s) if s else None,
            "sincronia_p10": _percentil(s, 0.1) if s else None,
            "sincronia_p90": _percentil(s, 0.9) if s else None,
            "rtf": statistics.median(rtf[g]) if g in rtf else None,
        }
    return res


def imprimeix(res: dict[str, dict]) -> None:
    def f(v, fmt):
        if v is None:
            return "–"
        return format(v, fmt[:-1]) + "%" if fmt.endswith("%") else format(v, fmt)
    print(f"{'grup':28s} {'àudios':>6s} {'paraules':>8s} {'WER':>7s} {'WER f.':>7s} {'F1 punt.':>8s} "
          f"{'F1 maj.':>7s} {'perdudes':>8s} {'sincronia':>9s} {'p10..p90':>13s} {'RTF':>6s}")
    for g, r in res.items():
        rang = "–" if r["sincronia"] is None else f"{r['sincronia_p10']:+.2f}..{r['sincronia_p90']:+.2f}"
        print(f"{g[:28]:28s} {r['audios']:6d} {r['paraules']:8d} {f(r['wer'], '6.2f%'):>7s} "
              f"{f(r['wer_formatat'], '6.2f%'):>7s} {f(r['f1_puntuacio'], '8.3f'):>8s} {f(r['f1_majuscules'], '7.3f'):>7s} "
              f"{r['perdudes']:8d} {f(r['sincronia'], '+9.2f'):>9s} {rang:>13s} {f(r['rtf'], '6.3f'):>6s}")


# (mètrica, quin sentit és pitjor) per a --compara; la sincronia i l'RTF no es comparen (soroll)
PITJOR = {"wer": +1, "wer_formatat": +1, "f1_puntuacio": -1, "f1_majuscules": -1, "perdudes": +1}


def compara(res: dict[str, dict], base: dict[str, dict], tolerancia: float) -> list[str]:
    avisos = []
    for g, r in res.items():
        if g not in base:
            continue
        for m, sentit in PITJOR.items():
            a, b = base[g].get(m), r.get(m)
            if a is None or b is None:
                continue
            marge = 0 if m == "perdudes" else tolerancia * (1 if m.startswith("wer") else 0.01)
            if sentit * (b - a) > marge:
                avisos.append(f"{g}: {m} {a:.4g} → {b:.4g}")
    return avisos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entrades", nargs="+", help="JSON del motor o carpetes")
    ap.add_argument("--dades", default=os.environ.get("SUBTITOLS_DADES"),
                    help="carpeta amb referencies.tsv i videos/ (per defecte, $SUBTITOLS_DADES)")
    ap.add_argument("--desa", help="desa el resum en aquest JSON (p. ex. com a línia base)")
    ap.add_argument("--compara", help="compara amb un resum desat: codi 1 si alguna mètrica empitjora")
    ap.add_argument("--tolerancia", type=float, default=0.0,
                    help="marge permès en punts de WER (i en centèsimes de F1) abans de considerar-ho pitjor")
    a = ap.parse_args()
    if not a.dades:
        ap.error("indica la carpeta de les referències amb --dades o la variable SUBTITOLS_DADES")
    refs, clips, srts = referencies(Path(a.dades))
    hips = hipotesis(a.entrades)
    res = avalua(hips, refs, clips, srts)
    sense = sorted(set(hips) - set(refs))
    if not res:
        print(f"Cap transcripció amb referència ({len(hips)} JSON llegits).")
        return 1
    imprimeix(res)
    if sense:
        print(f"\nSense referència (no compten): {', '.join(sense)}")
    if a.desa:
        Path(a.desa).parent.mkdir(parents=True, exist_ok=True)
        Path(a.desa).write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"\nDesat a {a.desa}")
    if a.compara:
        avisos = compara(res, json.loads(Path(a.compara).read_text(encoding="utf-8")), a.tolerancia)
        print("\n" + ("EMPITJORA:\n  " + "\n  ".join(avisos) if avisos else "Cap mètrica no empitjora."))
        return 1 if avisos else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
