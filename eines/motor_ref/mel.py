# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Espectrograma log-mel, idèntic a FilterbankFeatures de NeMo (mode avaluació):

  1. preènfasi:          y[n] = x[n] - 0.97 x[n-1]
  2. STFT:               n_fft 512, finestra de Hann (no periòdica) de 400 mostres centrada dins
                         dels 512, salt de 160 mostres, center=True amb 256 zeros a cada costat
  3. potència:           |X|^2
  4. banc mel:           80 filtres (mel_fb.npy, el mateix que fa servir NeMo)
  5. log(x + 2^-24)
  6. normalització per característica: (x - mitjana) / (desviació (n-1) + 1e-5),
     només amb les trames vàlides; les no vàlides es posen a 0.

Trames: n_trames = 1 + N // 160, de les quals són vàlides N // 160 (l'última és farciment).
"""
import numpy as np

PREEMF = 0.97
GUARDA_LOG = 2.0 ** -24
CONSTANT = 1e-5


class Mel:
    def __init__(self, mel_fb: np.ndarray, finestra: np.ndarray, n_fft: int = 512, salt: int = 160):
        self.fb = mel_fb.astype(np.float32)                 # [80, n_fft/2 + 1]
        self.n_fft = n_fft
        self.salt = salt
        w = finestra.astype(np.float32)                     # [400]
        esquerra = (n_fft - len(w)) // 2                    # torch.stft centra la finestra
        self.finestra = np.zeros(n_fft, dtype=np.float32)
        self.finestra[esquerra:esquerra + len(w)] = w

    def __call__(self, x: np.ndarray) -> tuple[np.ndarray, int]:
        """x: àudio float32 a 16 kHz. Torna (mel [80, n_trames] float32, trames vàlides)."""
        x = np.asarray(x, dtype=np.float32)
        n = len(x)
        valides = n // self.salt
        # 1. preènfasi
        y = np.empty_like(x)
        y[0] = x[0]
        y[1:] = x[1:] - PREEMF * x[:-1]
        # 2. STFT amb center=True i farciment de zeros
        mig = self.n_fft // 2
        y = np.pad(y, (mig, mig))
        n_trames = 1 + (len(y) - self.n_fft) // self.salt
        idx = np.arange(self.n_fft)[None, :] + self.salt * np.arange(n_trames)[:, None]
        trames = y[idx] * self.finestra[None, :]            # [n_trames, n_fft]
        espectre = np.fft.rfft(trames, n=self.n_fft, axis=1)
        # 3. potència  4. mel  5. log
        potencia = (espectre.real ** 2 + espectre.imag ** 2).astype(np.float32)
        mel = self.fb @ potencia.T                          # [80, n_trames]
        mel = np.log(mel + GUARDA_LOG).astype(np.float32)
        # 6. normalització amb les trames vàlides
        v = mel[:, :valides]
        mitjana = v.mean(axis=1, keepdims=True)
        desv = np.sqrt(((v - mitjana) ** 2).sum(axis=1, keepdims=True) / max(valides - 1, 1)) + CONSTANT
        mel = (mel - mitjana) / desv
        mel[:, valides:] = 0.0
        return mel.astype(np.float32), valides
