// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE

/** round(x, n) de Python: sobre el valor binari exacte, i els empats exactes al parell. */
export function roundPy(x, n = 0) {
  if (!Number.isFinite(x)) return x;
  const exacte = Math.abs(x).toFixed(Math.min(100, n + 60));     // prou xifres per a ser exacte
  const [ent, dec = ""] = exacte.split(".");
  const resta = dec.slice(n);
  let base = Number(`${ent}.${dec.slice(0, n) || "0"}`);
  const pas = 10 ** -n;
  const empat = /^50*$/.test(resta);
  const amunt = resta[0] > "5" || (resta[0] === "5" && !empat);
  if (amunt) base = Number((base + pas).toFixed(n));
  else if (empat) {
    const ultima = Number((n ? dec[n - 1] : ent[ent.length - 1]) || 0);
    if (ultima % 2 === 1) base = Number((base + pas).toFixed(n));
  }
  return Math.sign(x) * base || 0;
}
