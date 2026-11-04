# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Genera els casos de prova de la segmentació: per a cada JSON del motor i cada combinació de
paràmetres, el SRT i el VTT que fa la versió de Python. subtitols.test.mjs comprova que la
versió JavaScript (web/js/subtitols.js) dona exactament el mateix.

Ús (des de l'arrel del repositori):
    python proves/casos_subtitols.py resultats/*.json        -> resultats/proves/casos_subtitols.json
    node proves/subtitols.test.mjs
"""
import glob
import itertools
import json
import sys
from pathlib import Path

ARREL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ARREL / "eines"))
from motor_ref import subtitols as S  # noqa: E402

CANVIS = [
    {},
    {"max_car": 30, "max_linies": 1},
    {"max_car": 18, "max_linies": 2},
    {"max_paraules": 3},
    {"max_cps": 12.0, "durada_min": 1.5},
    {"desfas": -0.08},
    {"ressalta": "paraula"},
    {"ressalta": "progres", "color": "#FFFF00"},
    {"ressalta": "paraula", "negreta": True, "cursiva": True, "fons": "#000000", "color": "#00E676"},
    {"ressalta": "acumula"},
    {"ressalta": "acumula", "subratlla": True},
    {"ressalta": "paraula", "marca": ["<b>", "</b>"]},
]


def main():
    fitxers = [f for a in (sys.argv[1:] or [str(ARREL / "resultats" / "*.json")]) for f in glob.glob(a)]
    casos = []
    for f in fitxers:
        ps = json.loads(Path(f).read_text(encoding="utf-8")).get("paraules")
        if not ps:
            continue
        for perfil, canvis in itertools.product(S.PERFILS, CANVIS):
            c = dict(canvis)
            if "marca" in c:
                c["marca"] = tuple(c["marca"])
            P = S.params(perfil, **c)
            seg = S.segmenta(ps, P)
            cues = S.expandeix(seg, P)
            casos.append({"fitxer": Path(f).name, "perfil": perfil, "canvis": canvis,
                          "srt": S.srt(cues, P), "vtt": S.vtt(cues, P), "txt": S.txt(ps)})
    desti = ARREL / "resultats" / "proves" / "casos_subtitols.json"
    desti.parent.mkdir(parents=True, exist_ok=True)
    desti.write_text(json.dumps({"paraules": {Path(f).name: json.loads(Path(f).read_text(encoding="utf-8"))["paraules"]
                                              for f in fitxers}, "casos": casos}, ensure_ascii=False),
                     encoding="utf-8")
    print(f"{len(casos)} casos de {len(fitxers)} fitxers -> {desti}")


if __name__ == "__main__":
    main()
