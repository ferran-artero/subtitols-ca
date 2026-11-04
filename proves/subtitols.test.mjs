// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Comprova que web/js/subtitols.js dona exactament els mateixos SRT, VTT i TXT que la versió de
// Python, amb els casos que genera proves/casos_subtitols.py.
//     node proves/subtitols.test.mjs [resultats/proves/casos_subtitols.json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as S from "../web/js/subtitols.js";

const ruta = process.argv[2] || fileURLToPath(new URL("../resultats/proves/casos_subtitols.json", import.meta.url));
const { paraules, casos } = JSON.parse(readFileSync(ruta, "utf-8"));
let ok = 0;
const t0 = performance.now();
for (const cas of casos) {
  const P = S.params(cas.perfil, cas.canvis);
  const cues = S.expandeix(S.segmenta(paraules[cas.fitxer], P), P);
  const res = { srt: S.srt(cues, P), vtt: S.vtt(cues, P), txt: S.txt(paraules[cas.fitxer]) };
  const dif = ["srt", "vtt", "txt"].filter((k) => res[k] !== cas[k]);
  if (dif.length === 0) { ok++; continue; }
  console.log(`DIFERENT ${cas.fitxer} ${cas.perfil} ${JSON.stringify(cas.canvis)}: ${dif.join(", ")}`);
  const a = cas[dif[0]].split("\n"), b = res[dif[0]].split("\n");
  const i = a.findIndex((l, k) => l !== b[k]);
  console.log(`   línia ${i + 1}\n   python: ${a[i]}\n   js:     ${b[i]}`);
}
console.log(`${ok}/${casos.length} casos idèntics a Python (${((performance.now() - t0) / casos.length).toFixed(1)} ms per cas)`);
process.exit(ok === casos.length ? 0 : 1);
