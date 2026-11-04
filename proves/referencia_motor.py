# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Desa, per a cada àudio, el que fa el motor de Python pas a pas, perquè motor.test.mjs ho compare
amb la versió JavaScript (web/js/motor/):

    resultats/proves/motor/<nom>/pcm.npy        àudio a 16 kHz (l'entrada de tot)
                                 probs.npy      probabilitats del VAD (una per finestra de 32 ms)
                                 mel_<i>.npy    espectrograma de cada tros [80, T]
                                 motor.json     trossos (ini, fi, propis, ids, trames, rescat),
                                                paraules i text final

Ús (des de l'arrel del repositori):
    python proves/referencia_motor.py ruta/als/audios --models ruta/models_onnx
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

ARREL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ARREL / "eines"))
from motor_ref.audio import SR, llegeix  # noqa: E402
from motor_ref.motor import Motor  # noqa: E402
from transcriu import entrades  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Referències pas a pas del motor de Python")
    ap.add_argument("fitxers", nargs="+")
    ap.add_argument("--models", default=str(ARREL / "models_onnx"))
    ap.add_argument("--eixida", default=str(ARREL / "resultats" / "proves" / "motor"))
    ap.add_argument("--fils", type=int, default=None)
    a = ap.parse_args()
    m = Motor(a.models, fils=a.fils)
    for f in entrades(a.fitxers):
        d = Path(a.eixida) / f.stem
        if (d / "motor.json").exists():
            continue
        d.mkdir(parents=True, exist_ok=True)
        x = llegeix(f)
        np.save(d / "pcm.npy", x)
        trossos, probs = m.vad.trossos(x)
        np.save(d / "probs.npy", probs)
        for i, t in enumerate(trossos):
            mel, _ = m.mel(x[int(t["ini"] * SR):int(t["fi"] * SR)])
            np.save(d / f"mel_{i}.npy", mel)
        r = m.transcriu(x)
        (d / "motor.json").write_text(json.dumps({"vad": trossos, "trossos": r["trossos"], "paraules": r["paraules"],
                                                  "text": r["text"]}, ensure_ascii=False), encoding="utf-8")
        print(f"{f.name}: {len(trossos)} trossos, {len(r['paraules'])} paraules", flush=True)


if __name__ == "__main__":
    main()
