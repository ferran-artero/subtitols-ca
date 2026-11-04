// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Compara puntua.js amb Python: a partir de les paraules sense puntuar de la referència (cru),
// el text amb majúscules i el signe de cada paraula han de ser idèntics.
//   node proves/puntua.test.mjs --models ruta/models_onnx [--nomes a,b] [--refs ...]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelEtiquetes, Puntuador } from "../web/js/motor/puntua.js";

const arg = (nom, def) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : def; };
const ARREL = fileURLToPath(new URL("..", import.meta.url));
const models = arg("--models", join(ARREL, "models_onnx"));
const refs = arg("--refs", join(ARREL, "resultats", "proves", "motor"));
const nomes = arg("--nomes", "") ? new Set(arg("--nomes").split(",")) : null;
const ort = await import(process.env.ORT_WEB || "onnxruntime-web");
ort.env.wasm.numThreads = 1;

const json = (r) => JSON.parse(readFileSync(r, "utf-8"));
async function model(carpeta, fitxer) {
  const d = join(models, carpeta);
  return new ModelEtiquetes(ort, await ort.InferenceSession.create(readFileSync(join(d, "onnx", fitxer))),
    json(join(d, "tokenizer.json")), json(join(d, "config.json")));
}
let t0 = performance.now();
const punt = new Puntuador(await model("softcatala", "model_q8pc.onnx"), await model("umu-oficial", "model.onnx"));
console.log(`models carregats en ${((performance.now() - t0) / 1000).toFixed(1)} s`);

let n = 0, ok = 0, paraules = 0, iguals = 0, temps = 0;
for (const nom of readdirSync(refs).sort()) {
  const d = join(refs, nom);
  if (!existsSync(join(d, "motor.json")) || (nomes && !nomes.has(nom))) continue;
  const ref = json(join(d, "motor.json")).paraules;
  t0 = performance.now();
  const res = await punt.puntua(ref.map((p) => p.cru));
  temps += performance.now() - t0;
  const bons = res.filter(([w, s], i) => w === ref[i].text && s === (ref[i].punt ?? null)).length;
  n++; ok += bons === ref.length; paraules += ref.length; iguals += bons;
  if (bons !== ref.length) {
    const i = res.findIndex(([w, s], k) => w !== ref[k].text || s !== (ref[k].punt ?? null));
    console.log(`${nom}: ${bons}/${ref.length} · primera diferència (${i}): js «${res[i][0]}${res[i][1] ?? ""}» py «${ref[i].text}${ref[i].punt ?? ""}»`);
  }
}
console.log(`\n${ok}/${n} àudios amb puntuació idèntica (${iguals}/${paraules} paraules) · ${(temps / 1000).toFixed(1)} s en total`);
process.exit(ok === n ? 0 : 1);
