# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Motor de referència del subtitulador: àudio -> paraules amb temps, puntuació i majúscules.

Només fa servir numpy, onnxruntime i tokenizers (cap dependència de NeMo ni de PyTorch).
És la recepta que la web reprodueix en JavaScript, pas per pas:

    audio.py   llegir l'àudio a 16 kHz mono
    vad.py     Silero VAD -> trossos de veu de com a molt 25 s
    mel.py     espectrograma log-mel (idèntic al preprocessador de NeMo)
    rnnt.py    encoder + bucle RNNT greedy -> tokens amb l'instant on surten
    paraules.py  tokens -> paraules amb inici i final
    puntua.py  signes (softcatala) + majúscules (umu)
    motor.py   ho ajunta tot
    srt.py     subtítols senzills per a escoltar i comprovar els temps
"""
