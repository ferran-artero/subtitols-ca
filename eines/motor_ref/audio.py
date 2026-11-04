# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Llegeix qualsevol àudio o vídeo a 16 kHz mono float32.

- .wav .flac .ogg .mp3: soundfile + soxr (qualitat "HQ"; és exactament el que fa librosa.load,
  amb què es van mesurar tots els resultats).
- La resta (vídeos, m4a…): ffmpeg. Si no és al sistema, el que porta `imageio-ffmpeg`.
"""
import shutil
import subprocess
from pathlib import Path

import numpy as np

SR = 16000
DIRECTES = {".wav", ".flac", ".ogg", ".mp3"}
MULTIMEDIA = DIRECTES | {".m4a", ".aac", ".opus", ".wma", ".mp4", ".mov", ".mkv", ".avi", ".webm",
                         ".m4v", ".mts", ".3gp"}


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise SystemExit("Per a llegir vídeos cal ffmpeg: pip install imageio-ffmpeg")


def llegeix(ruta: str | Path) -> np.ndarray:
    ruta = Path(ruta)
    if ruta.suffix.lower() in DIRECTES:
        import soundfile as sf
        import soxr
        y, sr = sf.read(str(ruta), dtype="float32", always_2d=True)
        y = y.mean(axis=1)
        return y if sr == SR else soxr.resample(y, sr, SR, quality="soxr_hq").astype(np.float32)
    cmd = [_ffmpeg(), "-nostdin", "-v", "error", "-i", str(ruta), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg no ha pogut llegir {ruta}:\n{r.stderr.decode('utf-8', 'replace').strip()}")
    return np.frombuffer(r.stdout, dtype=np.float32).copy()
