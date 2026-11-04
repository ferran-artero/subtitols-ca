// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Compara el motor JavaScript (web/js/motor/) amb les referències de Python que desa
// proves/referencia_motor.py, peça a peça:
//   mel  diferència màxima de l'espectrograma de cada tros (objectiu < 1e-3)
//   vad  diferència màxima de les probabilitats i trossos idèntics
//
//   node proves/motor.test.mjs --models ruta/models_onnx [--refs resultats/proves/motor]
// onnxruntime-web: `npm install onnxruntime-web@1.29.0` (o ORT_WEB=ruta/al/paquet).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { llegeixNpy } from "../web/js/motor/npy.js";
import { Mel } from "../web/js/motor/mel.js";
import { VAD, SR } from "../web/js/motor/vad.js";

const arg = (nom, def) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : def; };
const ARREL = fileURLToPath(new URL("..", import.meta.url));
const models = arg("--models", join(ARREL, "models_onnx"));
const refs = arg("--refs", join(ARREL, "resultats", "proves", "motor"));
const ort = await import(process.env.ORT_WEB || "onnxruntime-web");
ort.env.wasm.numThreads = 1;

const npy = (ruta) => { const b = readFileSync(ruta); return llegeixNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const conf = join(models, "conformer-ca-es");
const fb = npy(join(conf, "mel_fb.npy")), fin = npy(join(conf, "finestra.npy"));
const mel = new Mel(fb.dades, fin.dades);
const vad = new VAD(ort, await ort.InferenceSession.create(readFileSync(join(models, "silero-vad", "silero_vad.onnx"))));

const maxDif = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const igualsTrossos = (a, b) => a.length === b.length && a.every((t, i) =>
  ["ini", "fi", "propi_ini", "propi_fi"].every((k) => Math.abs(t[k] - b[i][k]) < 1e-9) && t.forcat === b[i].forcat);

let total = 0, okVad = 0, okMel = 0, pitjorMel = 0, pitjorVad = 0;
for (const nom of readdirSync(refs).sort()) {
  const d = join(refs, nom);
  if (!existsSync(join(d, "motor.json"))) continue;
  total++;
  const ref = JSON.parse(readFileSync(join(d, "motor.json"), "utf-8"));
  const x = npy(join(d, "pcm.npy")).dades;
  let t0 = performance.now();
  const { trossos, probs } = await vad.trossos(x);
  const tVad = performance.now() - t0;
  const dv = maxDif(probs, npy(join(d, "probs.npy")).dades);
  const tIguals = igualsTrossos(trossos, ref.vad);
  pitjorVad = Math.max(pitjorVad, dv);
  okVad += tIguals;
  // mel de cada tros de la referència (així es compara el mateix senyal encara que el VAD difereixa)
  let dm = 0, tMel = 0;
  ref.vad.forEach((t, i) => {
    const s = x.subarray(Math.trunc(t.ini * SR), Math.trunc(t.fi * SR));
    t0 = performance.now();
    const m = mel.calcula(s);
    tMel += performance.now() - t0;
    dm = Math.max(dm, maxDif(m.mel, npy(join(d, `mel_${i}.npy`)).dades));
  });
  pitjorMel = Math.max(pitjorMel, dm);
  okMel += dm < 1e-3;
  console.log(`${nom.padEnd(22)} ${(x.length / SR).toFixed(1).padStart(6)} s · VAD dif ${dv.toExponential(1)} ` +
    `trossos ${tIguals ? "iguals" : "DIFERENTS"} (${tVad.toFixed(0)} ms) · mel dif ${dm.toExponential(1)} (${tMel.toFixed(0)} ms)`);
  if (!tIguals) console.log("   js:", JSON.stringify(trossos.map((t) => [t.ini, t.fi])), "\n   py:", JSON.stringify(ref.vad.map((t) => [t.ini, t.fi])));
}
console.log(`\nVAD: trossos iguals ${okVad}/${total} (dif. màx. de probabilitat ${pitjorVad.toExponential(1)})`);
console.log(`mel: < 1e-3 en ${okMel}/${total} (dif. màx. ${pitjorMel.toExponential(1)})`);
process.exit(okVad === total && okMel === total ? 0 : 1);
