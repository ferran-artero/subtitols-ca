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
                          index.json            llista d'àudios (nom, durada i fitxer original
                                                dins de --dades) per al banc de proves (proves/banc)

Ús (des de l'arrel del repositori):
    python proves/referencia_motor.py ruta/als/audios --models ruta/models_onnx [--dades ruta/dades]
"""
import argparse
import json
import os
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
    ap.add_argument("--dades", default=os.environ.get("SUBTITOLS_DADES"),
                    help="carpeta de les dades: a index.json, el fitxer original hi va relatiu (banc de proves)")
    a = ap.parse_args()
    m = Motor(a.models, fils=a.fils)
    eixida = Path(a.eixida)
    ruta_index = eixida / "index.json"
    index = {e["nom"]: e for e in json.loads(ruta_index.read_text(encoding="utf-8"))} if ruta_index.exists() else {}
    for f in entrades(a.fitxers):
        d = eixida / f.stem
        index[f.stem] = {"nom": f.stem, "durada": None, "original": original(f, a.dades)}
        if (d / "motor.json").exists():
            index[f.stem]["durada"] = round(len(np.load(d / "pcm.npy", mmap_mode="r")) / SR, 1)
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
        index[f.stem]["durada"] = round(len(x) / SR, 1)
        print(f"{f.name}: {len(trossos)} trossos, {len(r['paraules'])} paraules", flush=True)
        desa_index(ruta_index, index)
    desa_index(ruta_index, index)


def original(f: Path, dades: str | None) -> str | None:
    """Camí del fitxer dins de la carpeta de dades (amb /), o None si no hi és."""
    try:
        return f.resolve().relative_to(Path(dades).resolve()).as_posix() if dades else None
    except ValueError:
        return None


def desa_index(ruta: Path, index: dict) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(sorted(index.values(), key=lambda e: e["nom"]), ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
