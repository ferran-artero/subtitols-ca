# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Transcriu qualsevol àudio o vídeo amb el motor de referència (sense NeMo ni PyTorch)
i escriu, per a cada fitxer:
  <nom>.json   paraules amb inici/fi, signes i majúscules, trossos del VAD i temps
  <nom>.srt    subtítols senzills, per a obrir el vídeo amb VLC i comprovar els temps

Ús:
    python eines/transcriu.py C:/videos/entrevista.mp4
    python eines/transcriu.py dades/videos            (tots els de la carpeta)
    python eines/transcriu.py C:/audios/nota.wav --eixida C:/subtitols
Per a vídeos cal ffmpeg (si no el tens: pip install imageio-ffmpeg).
"""
import argparse
import json
import time
from pathlib import Path

from motor_ref.audio import SR, expandeix, llegeix
from motor_ref.motor import ASR_PER_DEFECTE, RESCAT_FINESTRES, RESCAT_FORAT, RESCAT_MAX, RESCAT_PENAL, VARIANTS_ASR, Motor
from motor_ref.vad import ParamsVAD
from motor_ref.srt import escriu_srt, subtitols

ARREL = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description="Àudio/vídeo -> JSON + SRT amb el motor de referència")
    ap.add_argument("fitxers", nargs="+", help="Fitxers o carpetes d'àudio/vídeo")
    ap.add_argument("--models", default=str(ARREL / "models_onnx"))
    ap.add_argument("--eixida", default=str(ARREL / "resultats"))
    ap.add_argument("--fils", type=int, default=None)
    ap.add_argument("--asr", choices=list(VARIANTS_ASR), default=ASR_PER_DEFECTE, help="Variant del Conformer")
    ap.add_argument("--rescat", type=float, default=RESCAT_PENAL,
                    help="Penalització inicial del blank dins dels forats amb veu (0 = sense rescat)")
    ap.add_argument("--rescat-max", type=float, default=RESCAT_MAX, help="Fins on pot pujar la penalització")
    ap.add_argument("--rescat-forat", type=float, default=RESCAT_FORAT, help="Durada mínima d'un forat (s)")
    ap.add_argument("--sense-finestra", action="store_true", help="Rescat sense l'etapa de la finestra curta")
    ap.add_argument("--majuscules", default=None,
                    help="Model de majúscules dins de models_onnx (per defecte umu-oficial; l'antic: umu/model_q8pc.onnx)")
    ap.add_argument("--max-tros", type=float, default=None, help="Durada màxima d'un tros (s)")
    ap.add_argument("--penal-blank", type=float, default=0.0, help="Penalització del blank (0 = cap)")
    a = ap.parse_args()

    fitxers = expandeix(a.fitxers)
    if not fitxers:
        raise SystemExit("No he trobat cap fitxer d'àudio o vídeo.")
    print(f"{len(fitxers)} fitxers: {', '.join(f.name for f in fitxers)}")
    pv = ParamsVAD() if a.max_tros is None else ParamsVAD(max_tros=a.max_tros)
    motor = Motor(a.models, fils=a.fils, asr=a.asr, params_vad=pv, penal_blank=a.penal_blank, rescat=a.rescat,
                  rescat_max=a.rescat_max, rescat_forat=a.rescat_forat, majuscules=a.majuscules,
                  finestres=() if a.sense_finestra else RESCAT_FINESTRES)
    sufix_nom = ("" if a.asr == ASR_PER_DEFECTE else f".{a.asr}") + ("" if a.max_tros is None else f".t{a.max_tros:g}") + \
        (f".b{a.penal_blank:g}" if a.penal_blank else "") + ("" if a.rescat == RESCAT_PENAL else f".r{a.rescat:g}") + \
        ("" if a.rescat_max == RESCAT_MAX else f".rm{a.rescat_max:g}") + \
        ("" if a.rescat_forat == RESCAT_FORAT else f".rf{a.rescat_forat:g}") + \
        (f".{Path(a.majuscules).stem}" if a.majuscules else "") + (".sf" if a.sense_finestra else "")
    print(f"ASR {a.asr} · trossos de com a molt {pv.max_tros:g} s · penalització fixa {a.penal_blank:g} · "
          f"rescat {a.rescat:g}..{a.rescat_max:g} en forats de ≥ {a.rescat_forat:g} s"
          + (f" · majúscules {a.majuscules}" if a.majuscules else ""))
    print(f"Motor carregat en {motor.temps_carrega:.1f} s")
    eix = Path(a.eixida)
    eix.mkdir(parents=True, exist_ok=True)

    for f in fitxers:
        t0 = time.perf_counter()
        try:
            x = llegeix(f)
        except Exception as e:
            print(f"\n[error] {f.name}: {e}")
            continue
        print(f"\n{f.name}: {len(x) / SR / 60:.1f} min (lectura {time.perf_counter() - t0:.1f} s)")

        def progres(i, n, r):
            print(f"  tros {i}/{n}  {r['ini']:7.1f}–{r['fi']:7.1f} s  {len(r['paraules']):4d} paraules  "
                  f"(enc {r['temps']['encoder']:.2f} s, dec {r['temps']['decoder']:.2f} s)")

        r = motor.transcriu(x, progres=progres)
        r["audio"] = f.name
        (eix / f"{f.stem}{sufix_nom}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        escriu_srt(subtitols(r["paraules"]), eix / f"{f.stem}{sufix_nom}.srt")
        t = r["temps"]
        forcats = sum(t["forcat"] for t in r["trossos"])
        rescatats = [t for t in r["trossos"] if t.get("rescat")]
        if rescatats:
            print(f"  rescat (forats amb veu tornats a descodificar, amb la penalització usada): "
                  + ", ".join(f"{r['forat'][0]:.1f}–{r['forat'][1]:.1f} s ("
                              + (f"finestra ±{r['marge']:g} s, {r['paraules']} paraules" if r['abast'] == 'finestra' and r['marge'] is not None
                                 else "finestra sense resultat" if r['abast'] == 'finestra'
                                 else f"p{r['penal']:g}" + (" tros" if r['abast'] == 'tros' else "")) + ")"
                              for t in rescatats for r in t["rescat"]))
        print(f"  {len(r['paraules'])} paraules en {len(r['trossos'])} trossos"
              + (f" ({forcats} amb talls forçats per parla seguida de més de 25 s)" if forcats else ""))
        print(f"  temps: VAD {t['vad']} s · mel {t['mel']} s · encoder {t['encoder']} s · "
              f"decoder {t['decoder']} s · puntuació {t['puntuacio']} s · total {t['total']} s  "
              f"->  RTF {t['rtf']}")
        print(f"  escrit: {eix / (f.stem + sufix_nom + '.json')} i .srt")


if __name__ == "__main__":
    main()
