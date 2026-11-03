# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Subtítols SRT senzills, només per a escoltar el resultat i comprovar els temps.
(La segmentació bona, amb tots els paràmetres, és la fase 5.)

Regles: com a molt 2 línies de 42 caràcters i 6 s per subtítol; es talla després de . ? !
si el subtítol ja dura 1 s; el subtítol dura fins a la darrera paraula + 0,3 s, sense
trepitjar el següent.
"""

def _temps(s: float) -> str:
    ms = int(round(max(s, 0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s_, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s_:02d},{ms:03d}"


def _dues_linies(text: str, max_linia: int) -> str:
    if len(text) <= max_linia:
        return text
    mig = len(text) // 2
    espais = [i for i, c in enumerate(text) if c == " "]
    i = min(espais, key=lambda k: abs(k - mig)) if espais else mig
    return text[:i] + "\n" + text[i + 1:]


def subtitols(paraules: list[dict], max_linia: int = 42, max_durada: float = 6.0) -> list[dict]:
    cues, actual = [], []
    for p in paraules:
        w = p["text"] + (p.get("punt") or "")
        if actual:
            text = " ".join(x["_w"] for x in actual + [{"_w": w}])
            if len(text) > 2 * max_linia or p["fi"] - actual[0]["ini"] > max_durada:
                cues.append(actual)
                actual = []
        actual.append({**p, "_w": w})
        if p.get("punt") in (".", "?", "!") and actual[-1]["fi"] - actual[0]["ini"] >= 1.0:
            cues.append(actual)
            actual = []
    if actual:
        cues.append(actual)
    res = []
    for i, c in enumerate(cues):
        ini = c[0]["ini"]
        fi = max(c[-1]["fi"] + 0.3, ini + 0.5)
        if i + 1 < len(cues):                       # mai trepitja el subtítol següent
            fi = min(fi, cues[i + 1][0]["ini"] - 0.04)
        res.append({"ini": ini, "fi": max(fi, ini + 0.04),
                    "text": _dues_linies(" ".join(x["_w"] for x in c), max_linia)})
    return res


def escriu_srt(cues: list[dict], ruta) -> None:
    linies = []
    for i, c in enumerate(cues, 1):
        linies += [str(i), f"{_temps(c['ini'])} --> {_temps(c['fi'])}", c["text"], ""]
    with open(ruta, "w", encoding="utf-8") as f:
        f.write("\n".join(linies))
