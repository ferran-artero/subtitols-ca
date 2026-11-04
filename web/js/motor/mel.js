// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Espectrograma log-mel, idèntic a eines/motor_ref/mel.py (i al preprocessador de NeMo):
//   1. preènfasi y[n] = x[n] - 0.97 x[n-1]
//   2. STFT: n_fft 512, finestra de Hann de 400 mostres centrada dins dels 512, salt 160,
//      center=True amb 256 zeros a cada costat
//   3. potència |X|^2   4. 80 filtres mel   5. log(x + 2^-24)
//   6. normalització per banda amb les trames vàlides: (x - mitjana) / (desviació (n-1) + 1e-5)
// Trames: 1 + N/160, de les quals N/160 són vàlides (l'última és farciment i es posa a 0).
// El resultat és [80, trames] en ordre C (fila = banda), com el que rep l'encoder.

const PREEMF = Math.fround(0.97);
const GUARDA_LOG = 2 ** -24;
const CONSTANT = 1e-5;
const f32 = Math.fround;

/** FFT complexa radix-2 en el lloc (n potència de 2). */
function preparaFFT(n) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let mida = 2; mida <= n; mida <<= 1) {
      const meitat = mida >> 1, pas = n / mida;
      for (let i = 0; i < n; i += mida) {
        for (let k = 0; k < meitat; k++) {
          const wr = cos[k * pas], wi = sin[k * pas];
          const a = i + k, b = a + meitat;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

export class Mel {
  /** fb: Float32Array [80 × 257]; finestra: Float32Array [400]. */
  constructor(fb, finestra, nFft = 512, salt = 160) {
    this.fb = fb;
    this.bandes = fb.length / (nFft / 2 + 1);
    this.nFft = nFft;
    this.salt = salt;
    this.finestra = new Float32Array(nFft);
    this.finestra.set(finestra, (nFft - finestra.length) >> 1);
    this.fft = preparaFFT(nFft);
  }

  /** x: Float32Array a 16 kHz -> {mel: Float32Array [bandes × trames], trames, valides}. */
  calcula(x) {
    const n = x.length, nFft = this.nFft, salt = this.salt, nBins = nFft / 2 + 1, B = this.bandes;
    const valides = Math.floor(n / salt);
    // 1. preènfasi, amb 256 zeros a cada costat (center=True)
    const mig = nFft >> 1;
    const y = new Float32Array(n + 2 * mig);
    if (n) y[mig] = x[0];
    for (let i = 1; i < n; i++) y[mig + i] = f32(x[i] - f32(PREEMF * x[i - 1]));
    const trames = 1 + Math.floor((y.length - nFft) / salt);
    // 2-4. STFT, potència i filtres mel
    const mel = new Float32Array(B * trames);
    const re = new Float64Array(nFft), im = new Float64Array(nFft), pot = new Float64Array(nBins);
    for (let t = 0; t < trames; t++) {
      const o = t * salt;
      for (let i = 0; i < nFft; i++) { re[i] = f32(y[o + i] * this.finestra[i]); im[i] = 0; }
      this.fft(re, im);
      for (let k = 0; k < nBins; k++) pot[k] = f32(re[k] * re[k] + im[k] * im[k]);
      for (let b = 0; b < B; b++) {
        let s = 0;
        const fila = b * nBins;
        for (let k = 0; k < nBins; k++) s += this.fb[fila + k] * pot[k];
        mel[b * trames + t] = f32(Math.log(f32(s) + GUARDA_LOG));      // 5. log
      }
    }
    // 6. normalització per banda amb les trames vàlides
    for (let b = 0; b < B; b++) {
      const fila = b * trames;
      let suma = 0;
      for (let t = 0; t < valides; t++) suma += mel[fila + t];
      const mitjana = suma / valides;
      let q = 0;
      for (let t = 0; t < valides; t++) { const d = mel[fila + t] - mitjana; q += d * d; }
      const desv = Math.sqrt(q / Math.max(valides - 1, 1)) + CONSTANT;
      for (let t = 0; t < trames; t++) mel[fila + t] = t < valides ? f32((mel[fila + t] - mitjana) / desv) : 0;
    }
    return { mel, trames, valides };
  }
}
