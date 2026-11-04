// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Motor JS complet (VAD -> mel -> RNNT -> paraules, amb el rescat) contra Python: per a cada
// àudio de referència, els tokens de cada tros, el rescat i les paraules amb temps han de ser
// idèntics (abans de la puntuació, que es comprova a part).
//
//   node proves/motor_complet.test.mjs --models ruta/models_onnx [--nomes a,b] [--refs ...] [--temps 150]
// Cada tros es desa a resultats/proves/js_cache/ en acabar: si s'esgota --temps (s), la prova
// s'atura i, executant-la de nou, continua on anava (útil per als vídeos llargs).
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { llegeixNpy } from "../web/js/motor/npy.js";
import { Mel } from "../web/js/motor/mel.js";
import { RNNT } from "../web/js/motor/rnnt.js";
import { VAD } from "../web/js/motor/vad.js";
import { Motor, ajunta } from "../web/js/motor/motor.js";

const arg = (nom, def) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : def; };
const ARREL = fileURLToPath(new URL("..", import.meta.url));
const models = arg("--models", join(ARREL, "models_onnx"));
const refs = arg("--refs", join(ARREL, "resultats", "proves", "motor"));
const nomes = arg("--nomes", "") ? new Set(arg("--nomes").split(",")) : null;
const pressupost = Number(arg("--temps", 1e9)) * 1000, inici = performance.now();
const cache = join(ARREL, "resultats", "proves", "js_cache");
const ort = await import(process.env.ORT_WEB || "onnxruntime-web");
ort.env.wasm.numThreads = 1;

const npy = (ruta) => { const b = readFileSync(ruta); return llegeixNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const sessio = (r) => ort.InferenceSession.create(readFileSync(r));
const conf = join(models, "conformer-ca-es");
const motor = new Motor({
  mel: new Mel(npy(join(conf, "mel_fb.npy")).dades, npy(join(conf, "finestra.npy")).dades),
  vad: new VAD(ort, await sessio(join(models, "silero-vad", "silero_vad.onnx"))),
  rnnt: new RNNT(ort, await sessio(join(conf, "encoder.q8w.onnx")), await sessio(join(conf, "decoder_joint.onnx")),
    JSON.parse(readFileSync(join(conf, "config.json"), "utf-8")), readFileSync(join(conf, "tokens.txt"), "utf-8").split("\n")),
});

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let n = 0, ok = 0;
for (const nom of readdirSync(refs).sort()) {
  const d = join(refs, nom);
  if (!existsSync(join(d, "motor.json")) || (nomes && !nomes.has(nom))) continue;
  const ref = JSON.parse(readFileSync(join(d, "motor.json"), "utf-8"));
  const x = npy(join(d, "pcm.npy")).dades;
  // com motor.transcriu(), però tros a tros i desant cada tros
  const { trossos: vadT, probs } = await motor.vad.trossos(x);
  const r = { trossos: [], paraules: [] };
  mkdirSync(join(cache, nom), { recursive: true });
  for (let i = 0; i < vadT.length; i++) {
    const fc = join(cache, nom, `tros_${i}.json`);
    let t;
    if (existsSync(fc)) t = JSON.parse(readFileSync(fc, "utf-8"));
    else {
      if (performance.now() - inici > pressupost) {
        console.log(`${nom}: ${i}/${vadT.length} trossos fets; s'ha acabat el temps. Torna a executar la prova per a continuar.`);
        process.exit(2);
      }
      const t0 = performance.now(), e0 = motor.rnnt.tEnc, d0 = motor.rnnt.tDec, c0 = motor.rnnt.crides;
      t = await motor.asrTros(x, vadT[i], probs);
      t.segons = (performance.now() - t0) / 1000;
      t.perfil = { encoder: (motor.rnnt.tEnc - e0) / 1000, bucle: (motor.rnnt.tDec - d0) / 1000, crides: motor.rnnt.crides - c0 };
      console.log(`   tros ${i}: ${(vadT[i].fi - vadT[i].ini).toFixed(1)} s d'àudio en ${t.segons.toFixed(1)} s ` +
        `(encoder ${t.perfil.encoder.toFixed(1)} s, bucle ${t.perfil.bucle.toFixed(1)} s, ${t.perfil.crides} crides, ${t.rescat.length} rescat)`);
      writeFileSync(fc, JSON.stringify(t));
    }
    ajunta(r.paraules, t.paraules);
    r.trossos.push(t);
  }
  const segons = r.trossos.reduce((a, t) => a + t.segons, 0);
  r.temps = { rtf: (segons / (x.length / 16000)).toFixed(2) };
  const trossos = r.trossos.map((t, i) => igual([t.ids, t.trames, t.rescat], [ref.trossos[i]?.ids, ref.trossos[i]?.trames, ref.trossos[i]?.rescat]));
  const ps = igual(r.paraules.map((p) => [p.text, p.ini, p.fi]), ref.paraules.map((p) => [p.cru, p.ini, p.fi]));
  const be = ps && trossos.every(Boolean) && r.trossos.length === ref.trossos.length;
  n++; ok += be;
  const resc = r.trossos.filter((t) => t.rescat.length).length;
  console.log(`${nom.padEnd(22)} ${be ? "idèntic" : "DIFERENT"} · trossos ${trossos.map((t) => (t ? "=" : "X")).join("")} ` +
    `(${resc} amb rescat) · ${r.paraules.length} paraules · RTF ${r.temps.rtf}`);
  if (!ps) {
    const a = r.paraules.map((p) => `${p.text}@${p.ini}`), b = ref.paraules.map((p) => `${p.cru}@${p.ini}`);
    const i = a.findIndex((w, k) => w !== b[k]);
    console.log(`   primera paraula diferent (${i}): js ${a.slice(i, i + 4).join(" ")} | py ${b.slice(i, i + 4).join(" ")}`);
  }
}
console.log(`\n${ok}/${n} àudios idèntics a Python (tokens, rescat i paraules amb temps)`);
process.exit(ok === n ? 0 : 1);
