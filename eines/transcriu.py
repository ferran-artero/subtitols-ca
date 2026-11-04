# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Àudio o vídeo -> subtítols, amb el motor de referència (sense NeMo ni PyTorch).

Per a cada fitxer escriu a --eixida:
  <nom>.json                 paraules amb inici/fi, signes i majúscules (la transcripció)
  <nom>.<perfil>[.<ressaltat>].srt / .vtt / .txt

Si li passes un .json (d'una transcripció anterior), només torna a fer els subtítols: és
instantani i serveix per a provar paràmetres. Amb --reutilitza fa el mateix si el .json del
vídeo ja és a --eixida.

Ús:
    python eines/transcriu.py video.mp4 --models models_onnx
    python eines/transcriu.py video.mp4 --perfil vertical --max-car 20 --ressalta progres --color groc
    python eines/transcriu.py video.json --perfil horitzontal vertical --formats srt vtt txt
    python eines/transcriu.py carpeta_amb_videos --reutilitza
"""
import argparse
import json
import time
from pathlib import Path

from motor_ref import subtitols as S
from motor_ref.audio import MULTIMEDIA, SR, llegeix

ARREL = Path(__file__).resolve().parent.parent


def entrades(rutes) -> list[Path]:
    res = []
    for r in map(Path, rutes):
        if r.is_dir():
            res += sorted(p for p in r.rglob("*") if p.suffix.lower() in MULTIMEDIA)
        elif r.exists():
            res.append(r)
        else:
            print(f"[avís] No existeix: {r}")
    return res


def main():
    ap = argparse.ArgumentParser(description="Àudio/vídeo (o JSON del motor) -> subtítols SRT/VTT/TXT")
    ap.add_argument("fitxers", nargs="+", help="Àudios, vídeos, JSON del motor o carpetes")
    ap.add_argument("--eixida", default=".", help="Carpeta on s'escriuen els resultats")
    ap.add_argument("--models", default=str(ARREL / "models_onnx"), help="Carpeta dels models ONNX")
    ap.add_argument("--reutilitza", action="store_true", help="Si <nom>.json ja existeix, no torna a transcriure")
    ap.add_argument("--fils", type=int, default=None, help="Fils de CPU")
    g = ap.add_argument_group("subtítols")
    g.add_argument("--perfil", nargs="+", default=["horitzontal"], choices=list(S.PERFILS))
    g.add_argument("--max-car", type=int, help="Caràcters màxims per línia")
    g.add_argument("--max-linies", type=int, help="Línies màximes per subtítol")
    g.add_argument("--max-paraules", type=int, help="Paraules màximes per subtítol (0 = sense límit)")
    g.add_argument("--max-cps", type=float, help="Caràcters per segon màxims")
    g.add_argument("--durada-min", type=float, help="Durada mínima d'un subtítol (s)")
    g.add_argument("--durada-max", type=float, help="Durada màxima de parla en un subtítol (s)")
    g.add_argument("--separacio", type=float, help="Buit mínim entre subtítols (s)")
    g.add_argument("--enganxa", type=float, help="Allarga el subtítol fins al següent si el buit és menor (s)")
    g.add_argument("--cua", type=float, help="Temps a pantalla després de la darrera paraula (s)")
    g.add_argument("--desfas", type=float, help="Desplaça tots els temps (s), p. ex. -0.08")
    g = ap.add_argument_group("ressaltat de paraules")
    g.add_argument("--ressalta", choices=["paraula", "progres", "acumula"],
                   help="paraula: la que es diu; progres: karaoke; acumula: apareixen d'una en una")
    g.add_argument("--subratlla", action="store_true", default=None, help="Subratllat (per defecte si no se'n tria cap)")
    g.add_argument("--negreta", action="store_true", default=None)
    g.add_argument("--cursiva", action="store_true", default=None)
    g.add_argument("--color", help="Color del text marcat: #RRGGBB o groc, verd, roig, blau, taronja, rosa…")
    g.add_argument("--fons", help="Color de fons de la paraula marcada (només VTT)")
    g.add_argument("--marca", help="Etiquetes pròpies, p. ex. '<b>,</b>'")
    g.add_argument("--formats", nargs="+", default=["srt"], choices=["srt", "vtt", "txt"])
    a = ap.parse_args()

    try:
        color, fons = S.color_hex(a.color or ""), S.color_hex(a.fons or "")
    except ValueError as e:
        raise SystemExit(e)
    fitxers = entrades(a.fitxers)
    if not fitxers:
        raise SystemExit("No he trobat cap fitxer d'àudio, vídeo o JSON.")
    eix = Path(a.eixida)
    eix.mkdir(parents=True, exist_ok=True)
    motor = None

    for f in fitxers:
        js = eix / f"{f.stem}.json"
        if f.suffix.lower() == ".json":
            r = json.loads(f.read_text(encoding="utf-8"))
        elif a.reutilitza and js.exists():
            r = json.loads(js.read_text(encoding="utf-8"))
            print(f"{f.name}: reutilitze {js}")
        else:
            if motor is None:
                from motor_ref.motor import Motor
                motor = Motor(a.models, fils=a.fils)
                print(f"Motor carregat en {motor.temps_carrega:.1f} s")
            t0 = time.perf_counter()
            x = llegeix(f)
            print(f"\n{f.name}: {len(x) / SR / 60:.1f} min")
            r = motor.transcriu(x, progres=lambda i, n, t: print(f"  tros {i}/{n}  {t['ini']:7.1f}–{t['fi']:7.1f} s"))
            r["audio"] = f.name
            js.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  {time.perf_counter() - t0:.1f} s (RTF {r['temps']['rtf']})")

        ps = r["paraules"]
        if "txt" in a.formats:
            (eix / f"{f.stem}.txt").write_text(S.txt(ps), encoding="utf-8")
        for nom in a.perfil:
            P = S.params(nom, max_car=a.max_car, max_linies=a.max_linies, max_paraules=a.max_paraules,
                         max_cps=a.max_cps, durada_min=a.durada_min, durada_max=a.durada_max,
                         separacio=a.separacio, enganxa=a.enganxa, cua=a.cua, desfas=a.desfas,
                         ressalta=a.ressalta, subratlla=a.subratlla, negreta=a.negreta, cursiva=a.cursiva,
                         color=color or None, fons=fons or None,
                         marca=tuple(a.marca.split(",", 1)) if a.marca else None)
            seg = S.segmenta(ps, P)
            cues = S.expandeix(seg, P)
            nom_fitxer = f"{f.stem}.{nom}" + (f".{P.ressalta}" if P.ressalta else "")
            for fmt in ("srt", "vtt"):
                if fmt in a.formats:
                    for av in S.avisos(P, fmt):
                        print(f"[avís] {av}")
                    (eix / f"{nom_fitxer}.{fmt}").write_text(S.srt(cues, P) if fmt == "srt" else S.vtt(cues, P),
                                                             encoding="utf-8")
            print(f"  {nom}: {len(seg)} subtítols -> {eix / nom_fitxer}.*")


if __name__ == "__main__":
    main()
