// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Worker de banc.html: carrega els models amb una configuració (backend de l'encoder, fils,
// variant), transcriu els àudios de referència tros a tros (sense puntuació), mesura cada etapa,
// ho compara amb Python i desa el resultat a resultats/banc/navegador/<etiqueta>/ (via eines/serveix.py).
// Una configuració per worker: numThreads només es pot fixar abans de la primera sessió.
// Paquets: ort.wasm (només CPU) i ort.webgpu (EP WebGPU nou: accepta MatMulNBits de 8 bits; el
// d'ort.all/JSEP només 2 i 4 bits). El decoder i el VAD van sempre en WASM.
import { llegeixNpy } from "/js/motor/npy.js";
import { Mel } from "/js/motor/mel.js";
import { RNNT } from "/js/motor/rnnt.js";
import { VAD } from "/js/motor/vad.js";
import { Motor, ajunta } from "/js/motor/motor.js";

const MODELS = new URL("/models_onnx/", self.location.origin);
const REFS = new URL("/referencies/", self.location.origin);
const post = (tipus, d = {}) => postMessage({ tipus, ...d });
const baixa = async (url, com = "arrayBuffer") => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} en baixar ${url}`);
  return r[com]();
};
const npy = async (url) => llegeixNpy(await baixa(url));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Distància d'edició entre dues llistes de paraules. */
function distancia(a, b) {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const act = [i];
    for (let j = 1; j <= b.length; j++) act[j] = Math.min(ant[j] + 1, act[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = act;
  }
  return ant[b.length];
}

// font "navegador": l'àudio el descodifica la pàgina (decodeAudioData no existeix als workers)
let respon = null;
const demana = (a) => new Promise((resol) => { respon = resol; post("demana", { nom: a }); });
onmessage = async ({ data: m }) => {
  if (m.tipus === "pcm") { respon(m); return; }
  try { await executa(m); } catch (e) { post("error", { missatge: String((e && e.stack) || e) }); }
};

async function executa(cfg) {
  const ort = await import(`/js/vendor/ort/${cfg.lib}`);
  ort.env.wasm.wasmPaths = new URL("/js/vendor/ort/", self.location.origin).href;
  ort.env.wasm.numThreads = cfg.fils;
  const conf = new URL("conformer-ca-es/", MODELS);
  const opc = (ep) => ({ executionProviders: [ep], graphOptimizationLevel: "all" });
  const t0 = performance.now();
  post("estat", { text: `baixant ${cfg.encoder}…` });
  const encBuf = new Uint8Array(await baixa(new URL(cfg.encoder, conf)));
  post("estat", { text: `creant la sessió de l'encoder (${cfg.ep})…` });
  const t1 = performance.now();
  const enc = await ort.InferenceSession.create(encBuf, opc(cfg.ep));
  const tSessio = (performance.now() - t1) / 1000;
  const dec = await ort.InferenceSession.create(new Uint8Array(await baixa(new URL("decoder_joint.onnx", conf))), opc("wasm"));
  const sVad = await ort.InferenceSession.create(new Uint8Array(await baixa(new URL("silero-vad/silero_vad.onnx", MODELS))), opc("wasm"));
  const rnnt = new RNNT(ort, enc, dec, await baixa(new URL("config.json", conf), "json"),
    (await baixa(new URL("tokens.txt", conf), "text")).split("\n"));
  const motor = new Motor({
    mel: new Mel((await npy(new URL("mel_fb.npy", conf))).dades, (await npy(new URL("finestra.npy", conf))).dades),
    vad: new VAD(ort, sVad), rnnt,
  });
  // temps de l'etapa 2 del rescat (finestres) separat de la resta
  const fin = { enc: 0, dec: 0 }, finestraOrig = motor.finestra.bind(motor);
  motor.finestra = async (...a) => {
    const e0 = rnnt.tEnc, d0 = rnnt.tDec;
    try { return await finestraOrig(...a); } finally { fin.enc += rnnt.tEnc - e0; fin.dec += rnnt.tDec - d0; }
  };
  // escalfament (WebGPU compila els shaders la primera vegada)
  const t2 = performance.now();
  const soroll = new Float32Array(16000 * 4).map(() => (Math.random() - 0.5) * 0.01);
  await motor.enc(soroll);
  const tEscalfa = (performance.now() - t2) / 1000;
  rnnt.tEnc = 0; rnnt.tDec = 0; rnnt.crides = 0;
  post("preparat", { carrega: (performance.now() - t0) / 1000, sessio: tSessio, escalfa: tEscalfa });

  for (const nom of cfg.audios) {
    const dir = new URL(encodeURIComponent(nom) + "/", REFS);
    const ref = await baixa(new URL("motor.json", dir), "json");
    let x;
    if (cfg.font === "navegador") {
      const r = await demana(nom);
      if (r.error) { post("audio", { fila: { nom, error: r.error } }); continue; }
      x = r.pcm;
    } else x = (await npy(new URL("pcm.npy", dir))).dades;
    const dur = x.length / 16000;
    const tv = performance.now();
    const { trossos: vadT, probs } = await motor.vad.trossos(x);
    const tVad = (performance.now() - tv) / 1000;
    const r = { trossos: [], paraules: [] };
    const s = { total: 0, encoder: 0, bucle: 0, fin_encoder: 0, fin_bucle: 0, crides: 0 };
    for (let i = 0; i < vadT.length; i++) {
      post("estat", { text: `${nom}: tros ${i + 1}/${vadT.length}` });
      const ta = performance.now(), e0 = rnnt.tEnc, d0 = rnnt.tDec, c0 = rnnt.crides, fe0 = fin.enc, fd0 = fin.dec;
      const t = await motor.asrTros(x, vadT[i], probs);
      const fe = (fin.enc - fe0) / 1000, fd = (fin.dec - fd0) / 1000;
      t.perfil = { total: (performance.now() - ta) / 1000, encoder: (rnnt.tEnc - e0) / 1000 - fe, bucle: (rnnt.tDec - d0) / 1000 - fd,
                   fin_encoder: fe, fin_bucle: fd, crides: rnnt.crides - c0 };
      for (const k in s) s[k] += t.perfil[k];
      ajunta(r.paraules, t.paraules);
      r.trossos.push(t);
    }
    const trossosIguals = r.trossos.map((t, i) => igual([t.ids, t.trames, t.rescat], [ref.trossos[i]?.ids, ref.trossos[i]?.trames, ref.trossos[i]?.rescat]));
    const identic = r.trossos.length === ref.trossos.length && trossosIguals.every(Boolean) &&
      igual(r.paraules.map((p) => [p.text, p.ini, p.fi]), ref.paraules.map((p) => [p.cru, p.ini, p.fi]));
    const dif = distancia(r.paraules.map((p) => p.text), ref.paraules.map((p) => p.cru));
    const fila = { nom, dur, vad: tVad, ...s, identic, dif, nParaules: ref.paraules.length,
                   trossos: trossosIguals.map((b) => (b ? "=" : "X")).join("") };
    await fetch(`/desa/${encodeURIComponent(cfg.etiqueta)}/${encodeURIComponent(nom)}.json`, {
      method: "POST", body: JSON.stringify({ cfg, fila, trossos: r.trossos, paraules: r.paraules }),
    }).catch(() => {});
    post("audio", { fila });
  }
  post("fet");
}
