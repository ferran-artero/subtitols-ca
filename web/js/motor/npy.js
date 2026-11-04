// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Lector mínim de fitxers .npy (numpy): float32, float64, int32, int64, en ordre C.
// Serveix per als fitxers petits del model (mel_fb.npy, finestra.npy) i per a les proves.

const TIPUS = { "<f4": Float32Array, "<f8": Float64Array, "<i4": Int32Array, "<i8": BigInt64Array };

/** ArrayBuffer d'un .npy -> {dades: TypedArray, forma: [..]} */
export function llegeixNpy(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x93 || String.fromCharCode(...u8.slice(1, 6)) !== "NUMPY") throw new Error("No és un .npy");
  const major = u8[6];
  const dv = new DataView(buf);
  const llargCap = major === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true);
  const ini = major === 1 ? 10 : 12;
  const cap = new TextDecoder().decode(u8.slice(ini, ini + llargCap));
  const descr = /'descr':\s*'([^']+)'/.exec(cap)[1];
  if (/'fortran_order':\s*True/.test(cap)) throw new Error("npy en ordre Fortran: no suportat");
  const forma = /'shape':\s*\(([^)]*)\)/.exec(cap)[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const T = TIPUS[descr];
  if (!T) throw new Error(`Tipus de .npy no suportat: ${descr}`);
  const n = forma.reduce((a, b) => a * b, 1);
  const off = ini + llargCap;
  const dades = new T(buf.slice(off, off + n * T.BYTES_PER_ELEMENT));
  return { dades, forma };
}
