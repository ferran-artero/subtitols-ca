// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Banc de proves del motor JS (web/js/motor) a Node: resultat idèntic a Python i temps per etapa.
//   node proves/banc/banc.mjs --models ruta/models_onnx --etiqueta base [--nomes a,b] [--temps 150] [--fils 1]
// Cada tros es desa a resultats/banc/node/<etiqueta>/<àudio>/tros_i.json: si s'acaba --temps (s),
// s'atura (codi 2) i, executant-lo de nou, continua. Quan tot està fet, imprimeix el resum.
// Referències (de proves/referencia_motor.py): resultats/proves/motor.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (nom, def) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : def; };
const ARREL = fileURLToPath(new URL("../..", import.meta.url));
const dirMotor = arg("--motor", "../../web/js/motor/");
const { llegeixNpy } = await import(new URL(dirMotor + "npy.js", import.meta.url));
const { Mel } = await import(new URL(dirMotor + "mel.js", import.meta.url));
const { RNNT } = await import(new URL(dirMotor + "rnnt.js", import.meta.url));
const { VAD } = await import(new URL(dirMotor + "vad.js", import.meta.url));
const { Motor, ajunta } = await import(new URL(dirMotor + "motor.js", import.meta.url));

const models = arg("--models", join(ARREL, "models_onnx"));
const refs = arg("--refs", join(ARREL, "resultats", "proves", "motor"));
const etiqueta = arg("--etiqueta", "base");
const nomes = arg("--nomes", "") ? new Set(arg("--nomes").split(",")) : null;
const pressupost = Number(arg("--temps", 1e9)) * 1000, inici = performance.now();
const cache = join(ARREL, "resultats", "banc", "node", etiqueta);
const ort = await import(process.env.ORT_WEB || "onnxruntime-web");
ort.env.wasm.numThreads = Number(arg("--fils", 1));

const npy = (ruta) => { const b = readFileSync(ruta); return llegeixNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const sessio = (r) => ort.InferenceSession.create(readFileSync(r));
const conf = join(models, "conformer-ca-es");
const motor = new Motor({
  mel: new Mel(npy(join(conf, "mel_fb.npy")).dades, npy(join(conf, "finestra.npy")).dades),
  vad: new VAD(ort, await sessio(join(models, "silero-vad", "silero_vad.onnx"))),
  rnnt: new RNNT(ort, await sessio(join(conf, "encoder.q8w.onnx")), await sessio(join(conf, "decoder_joint.onnx")),
    JSON.parse(readFileSync(join(conf, "config.json"), "utf-8")), readFileSync(join(conf, "tokens.txt"), "utf-8").split("\n")),
});

// perfil: temps dins de l'etapa 2 del rescat (finestres) separat de la resta
const rn = motor.rnnt, fin = { enc: 0, dec: 0 };
const finestraOrig = motor.finestra.bind(motor);
motor.finestra = async (...a) => {
  const e0 = rn.tEnc, d0 = rn.tDec;
  try { return await finestraOrig(...a); } finally { fin.enc += rn.tEnc - e0; fin.dec += rn.tDec - d0; }
};

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const files = [];
let n = 0, ok = 0, pendents = false;
for (const nom of readdirSync(refs).sort()) {
  const d = join(refs, nom);
  if (!existsSync(join(d, "motor.json")) || (nomes && !nomes.has(nom))) continue;
  const ref = JSON.parse(readFileSync(join(d, "motor.json"), "utf-8"));
  const x = npy(join(d, "pcm.npy")).dades;
  mkdirSync(join(cache, nom), { recursive: true });
  const fv = join(cache, nom, "vad.json");
  let vadT, probs, tVad;
  if (existsSync(fv)) ({ vadT, probs, tVad } = JSON.parse(readFileSync(fv, "utf-8")));
  else {
    if (performance.now() - inici > pressupost) { pendents = true; break; }
    const t0 = performance.now();
    ({ trossos: vadT, probs } = await motor.vad.trossos(x));
    tVad = (performance.now() - t0) / 1000;
    probs = Array.from(probs);
    writeFileSync(fv, JSON.stringify({ vadT, probs, tVad }));
  }
  const r = { trossos: [], paraules: [] };
  let acabat = true;
  for (let i = 0; i < vadT.length; i++) {
    const fc = join(cache, nom, `tros_${i}.json`);
    let t;
    if (existsSync(fc)) t = JSON.parse(readFileSync(fc, "utf-8"));
    else {
      if (performance.now() - inici > pressupost) { acabat = false; break; }
      const t0 = performance.now(), e0 = rn.tEnc, d0 = rn.tDec, c0 = rn.crides, fe0 = fin.enc, fd0 = fin.dec;
      t = await motor.asrTros(x, vadT[i], probs);
      const enc = (rn.tEnc - e0) / 1000, dec = (rn.tDec - d0) / 1000, fe = (fin.enc - fe0) / 1000, fd = (fin.dec - fd0) / 1000;
      t.perfil = { total: (performance.now() - t0) / 1000, encoder: enc - fe, bucle: dec - fd, fin_encoder: fe, fin_bucle: fd, crides: rn.crides - c0 };
      console.log(`   ${nom} tros ${i}: ${(vadT[i].fi - vadT[i].ini).toFixed(1)} s en ${t.perfil.total.toFixed(1)} s ` +
        `(enc ${t.perfil.encoder.toFixed(1)} + fin ${fe.toFixed(1)}, bucle ${t.perfil.bucle.toFixed(1)} + fin ${fd.toFixed(1)}, ${t.perfil.crides} crides)`);
      writeFileSync(fc, JSON.stringify(t));
    }
    ajunta(r.paraules, t.paraules);
    r.trossos.push(t);
  }
  if (!acabat) { pendents = true; break; }
  const trossos = r.trossos.map((t, i) => igual([t.ids, t.trames, t.rescat], [ref.trossos[i]?.ids, ref.trossos[i]?.trames, ref.trossos[i]?.rescat]));
  const ps = igual(r.paraules.map((p) => [p.text, p.ini, p.fi]), ref.paraules.map((p) => [p.cru, p.ini, p.fi]));
  const be = ps && trossos.every(Boolean) && r.trossos.length === ref.trossos.length;
  n++; ok += be;
  const s = (k) => r.trossos.reduce((a, t) => a + t.perfil[k], 0);
  files.push({ nom, be, dur: x.length / 16000, vad: tVad, total: s("total"), encoder: s("encoder"), bucle: s("bucle"),
               fin_encoder: s("fin_encoder"), fin_bucle: s("fin_bucle"), crides: s("crides"), resc: r.trossos.filter((t) => t.rescat.length).length });
  if (!be) console.log(`${nom}: DIFERENT · trossos ${trossos.map((t) => (t ? "=" : "X")).join("")}`);
}
if (pendents) { console.log(`\nS'ha acabat el temps (${etiqueta}). Torna a executar per a continuar.`); process.exit(2); }

// resum: clips agrupats, vídeos un per un
const grups = {};
for (const f of files) { const g = f.nom.match(/^(ba|va|comu)_/) ? "38 clips" : f.nom; (grups[g] ??= []).push(f); }
const k = ["dur", "vad", "encoder", "fin_encoder", "bucle", "fin_bucle", "total", "crides"];
console.log(`\n[${etiqueta}] àudio | vad | encoder | enc finestres | bucle | bucle finestres | total ASR | RTF | crides`);
for (const [g, fs] of Object.entries(grups)) {
  const s = Object.fromEntries(k.map((c) => [c, fs.reduce((a, f) => a + f[c], 0)]));
  console.log(`${g.padEnd(22)} ${s.dur.toFixed(0).padStart(4)} s | ${s.vad.toFixed(1)} | ${s.encoder.toFixed(1)} | ${s.fin_encoder.toFixed(1)} | ` +
    `${s.bucle.toFixed(1)} | ${s.fin_bucle.toFixed(1)} | ${s.total.toFixed(1)} | ${((s.total + s.vad) / s.dur).toFixed(2)} | ${s.crides}`);
}
writeFileSync(join(cache, "resum.json"), JSON.stringify(files, null, 1));
console.log(`\n${ok}/${n} àudios idèntics a Python (tokens, rescat i paraules amb temps)`);
process.exit(ok === n ? 0 : 1);
