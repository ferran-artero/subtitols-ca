// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Compara rnnt.js amb Python: per a cada tros de la referència que no ha necessitat rescat,
// mel (JS) -> encoder -> RNNT sense penalització, i els tokens (ids i trames) han de ser iguals.
// Mesura també el temps de l'encoder i del bucle (i les crides al decoder_joint).
//
//   node proves/rnnt.test.mjs --models ruta/models_onnx [--refs ...] [--nomes nom1,nom2] [--fils N]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { llegeixNpy } from "../web/js/motor/npy.js";
import { Mel } from "../web/js/motor/mel.js";
import { RNNT } from "../web/js/motor/rnnt.js";
import { SR } from "../web/js/motor/vad.js";

const arg = (nom, def) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : def; };
const ARREL = fileURLToPath(new URL("..", import.meta.url));
const models = arg("--models", join(ARREL, "models_onnx"));
const refs = arg("--refs", join(ARREL, "resultats", "proves", "motor"));
const nomes = arg("--nomes", "") ? new Set(arg("--nomes").split(",")) : null;
const ort = await import(process.env.ORT_WEB || "onnxruntime-web");
ort.env.wasm.numThreads = Number(arg("--fils", 1));

const npy = (ruta) => { const b = readFileSync(ruta); return llegeixNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const conf = join(models, "conformer-ca-es");
const mel = new Mel(npy(join(conf, "mel_fb.npy")).dades, npy(join(conf, "finestra.npy")).dades);
let t0 = performance.now();
const enc = await ort.InferenceSession.create(readFileSync(join(conf, arg("--encoder", "encoder.q8w.onnx"))));
const dec = await ort.InferenceSession.create(readFileSync(join(conf, "decoder_joint.onnx")));
console.log(`models carregats en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const rnnt = new RNNT(ort, enc, dec, JSON.parse(readFileSync(join(conf, "config.json"), "utf-8")),
  readFileSync(join(conf, "tokens.txt"), "utf-8").split("\n"));

let n = 0, iguals = 0, tEnc = 0, tDec = 0, segons = 0, crides = 0;
for (const nom of readdirSync(refs).sort()) {
  const d = join(refs, nom);
  if (!existsSync(join(d, "motor.json")) || (nomes && !nomes.has(nom))) continue;
  const ref = JSON.parse(readFileSync(join(d, "motor.json"), "utf-8"));
  const x = npy(join(d, "pcm.npy")).dades;
  const linia = [];
  for (let i = 0; i < ref.vad.length; i++) {
    const tr = ref.trossos[i];
    if (tr.rescat.length) { linia.push("r"); continue; }          // amb rescat: ho comprovarà motor.js
    const v = ref.vad[i];
    const m = mel.calcula(x.subarray(Math.trunc(v.ini * SR), Math.trunc(v.fi * SR)));
    t0 = performance.now();
    const e = await rnnt.encoder(m.mel, m.trames, m.valides);
    const t1 = performance.now();
    const c0 = rnnt.crides;
    const { ids, trames } = await rnnt.descodifica(e, 0);
    const t2 = performance.now();
    tEnc += t1 - t0; tDec += t2 - t1; segons += v.fi - v.ini; crides += rnnt.crides - c0;
    const ok = ids.length === tr.ids.length && ids.every((k, j) => k === tr.ids[j] && trames[j] === tr.trames[j]);
    n++; iguals += ok;
    linia.push(ok ? "=" : "X");
    if (!ok) {
      const j = ids.findIndex((k, q) => k !== tr.ids[q] || trames[q] !== tr.trames[q]);
      console.log(`   ${nom} tros ${i}: primer canvi al token ${j} — js ${rnnt.peces[ids[j]]}@${trames[j]}, py ${rnnt.peces[tr.ids[j]]}@${tr.trames[j]}`);
    }
  }
  console.log(`${nom.padEnd(22)} ${linia.join("")}`);
}
console.log(`\nTrossos amb tokens idèntics: ${iguals}/${n}  (r = amb rescat, es comprova després)`);
console.log(`Encoder: ${(tEnc / 1000).toFixed(1)} s · bucle: ${(tDec / 1000).toFixed(1)} s · ${crides} crides ` +
  `(${(tDec / crides).toFixed(2)} ms per crida) · RTF ${((tEnc + tDec) / 1000 / segons).toFixed(2)} per a ${segons.toFixed(0)} s d'àudio`);
process.exit(iguals === n ? 0 : 1);
