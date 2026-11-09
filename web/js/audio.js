// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Lectura de l'àudio d'un vídeo o àudio amb el descodificador del navegador -> Float32Array
// mono a 16 kHz (com eines/motor_ref: mitjana dels canals). Només al fil principal
// (AudioContext no existeix als workers).
import { edicioAudio } from "./mp4.js";

export const SR = 16000;

function mono(ab) {
  const n = ab.length, C = ab.numberOfChannels;
  const x = new Float32Array(n);
  for (let c = 0; c < C; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < n; i++) x[i] += d[i];
  }
  if (C > 1) for (let i = 0; i < n; i++) x[i] /= C;
  return x;
}

/** File o Blob -> Float32Array a 16 kHz. */
export async function llegeixAudio(fitxer) {
  const buf = await fitxer.arrayBuffer();
  let ed = null;
  try { ed = edicioAudio(buf); } catch { /* no és MP4/MOV o la capçalera és rara: no es corregeix */ }
  let ab;
  try {
    // el navegador descodifica i re-mostreja directament a la freqüència del context
    ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf);
  } catch (e) {
    throw new Error(`El navegador no sap llegir l'àudio de «${fitxer.name}». ` +
      `Prova de convertir-lo a MP4 (AAC), MP3 o WAV. (${(e && e.message) || e})`);
  }
  let x;
  if (ab.sampleRate === SR) x = mono(ab);
  else {
    // per si el navegador no ha re-mostrejat (no hauria de passar): renderitza a 16 kHz
    const ctx = new OfflineAudioContext(1, Math.ceil(ab.duration * SR), SR), src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(ctx.destination);
    src.start();
    x = (await ctx.startRendering()).getChannelData(0).slice();
  }
  return aplicaEdicio(x, ed);
}

/**
 * Aplica la llista d'edició si el navegador no ho ha fet. Chrome descodifica la pista sencera
 * (durada ≈ total − salta); ffmpeg, que sí que l'aplica, dona ≈ total − 2·salta (també retalla el
 * farciment final). Si la durada queda més prop del primer cas, se salten les mostres inicials.
 * Comprovat amb Chrome; als altres navegadors cal comprovar-ho (fase 7).
 */
export function aplicaEdicio(x, ed) {
  if (!ed || ed.salta <= 0 || ed.salta > 2) return x;
  const durada = x.length / SR;
  if (durada < ed.mostres - 1.5 * ed.salta) return x;              // ja aplicada pel navegador
  const salta = Math.round(ed.salta * SR), retard = Math.round(ed.retard * SR);
  const y = new Float32Array(retard + x.length - salta);
  y.set(x.subarray(salta), retard);
  console.info(`àudio: s'han saltat ${salta} mostres inicials (llista d'edició del MP4)`);
  return y;
}
