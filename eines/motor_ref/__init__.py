# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Motor de referència del subtitulador: àudio -> paraules amb temps, signes i majúscules ->
subtítols. Només numpy, onnxruntime i tokenizers (sense NeMo ni PyTorch).

És la recepta que la web reprodueix en JavaScript, mòdul per mòdul:

    audio.py      llegir qualsevol àudio o vídeo a 16 kHz mono (ffmpeg)
    vad.py        Silero VAD -> trossos de veu de com a molt 25 s
    mel.py        espectrograma log-mel (idèntic al de NeMo)
    rnnt.py       encoder + bucle RNNT greedy -> tokens amb l'instant on surten
    paraules.py   tokens -> paraules amb inici i fi (apòstrofs reparats)
    puntua.py     signes (Softcatalà) + majúscules (UMU)
    motor.py      ho ajunta tot, amb el rescat de frases perdudes
    subtitols.py  paraules -> subtítols SRT/VTT (segmentació, perfils, ressaltat)
"""
