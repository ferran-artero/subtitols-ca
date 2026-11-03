# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Llegeix qualsevol àudio o vídeo a 16 kHz mono float32.

- .wav/.flac/.ogg/.mp3: librosa (el mateix que fan servir els scripts d'avaluació).
- Vídeos i altres formats: ffmpeg. Si no el tens instal·lat, `pip install imageio-ffmpeg`
  en porta un dins.
"""
import shutil
import subprocess
from pathlib import Path

import numpy as np

SR = 16000
DIRECTES = {".wav", ".flac", ".ogg", ".mp3"}
MULTIMEDIA = DIRECTES | {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4a", ".aac", ".opus", ".wma", ".m4v", ".mts"}


def _ffmpeg() -> str | None:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def llegeix(ruta: str | Path) -> np.ndarray:
    ruta = Path(ruta)
    if ruta.suffix.lower() in DIRECTES:
        import librosa
        y, _ = librosa.load(str(ruta), sr=SR, mono=True)
        return y.astype(np.float32)
    exe = _ffmpeg()
    if exe is None:
        raise SystemExit("Per a llegir vídeos cal ffmpeg: pip install imageio-ffmpeg")
    cmd = [exe, "-nostdin", "-v", "error", "-i", str(ruta), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg no ha pogut llegir {ruta}:\n{err}")
    return np.frombuffer(r.stdout, dtype=np.float32).copy()


def expandeix(rutes) -> list[Path]:
    """Fitxers i carpetes -> llista de fitxers d'àudio/vídeo (les carpetes, recursivament)."""
    res = []
    for r in map(Path, rutes):
        if r.is_dir():
            res += sorted(p for p in r.rglob("*") if p.suffix.lower() in MULTIMEDIA)
        elif r.exists():
            res.append(r)
        else:
            print(f"[avís] No existeix: {r}")
    return res
