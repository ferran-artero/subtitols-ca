// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Web Worker amb el motor: la pàgina no es bloqueja mentre es transcriu.
// Missatges que rep:   {tipus: "carrega", local, fils, gpu} -> baixa/obri els models i crea les sessions
//                      {tipus: "transcriu", pcm}       -> Float32Array a 16 kHz (transferit)
// Missatges que envia: baixada, avis, estat, llest, progres, resultat, error.
import { carregaModels } from "./models.js";
import { llegeixNpy } from "./npy.js";
import { Mel } from "./mel.js";
import { VAD } from "./vad.js";
import { RNNT } from "./rnnt.js";
import { Motor } from "./motor.js";
import { ModelEtiquetes, Puntuador } from "./puntua.js";

const post = (tipus, d = {}, transferir = []) => postMessage({ tipus, ...d }, transferir);
let motor = null;

onmessage = async ({ data: m }) => {
  try {
    if (m.tipus === "carrega") await carrega(m);
    else if (m.tipus === "transcriu") await transcriu(m.pcm);
  } catch (e) {
    post("error", { missatge: (e && e.message) || String(e), pila: e && e.stack });
  }
};

/**
 * local: carpeta local dels models o null (Hugging Face). fils: nombre de fils (per defecte, tots
 * els nuclis). gpu: l'encoder en WebGPU (paquet ort.webgpu, que també admet el MatMulNBits de
 * 8 bits); la resta continua en WASM. Si no hi ha WebGPU, es fa tot en WASM.
 */
async function carrega({ local, fils: filsDemanats, gpu: volGpu }) {
  const t0 = performance.now();
  const gpu = !!volGpu && !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
  const ort = await import(gpu ? "../vendor/ort/ort.webgpu.min.mjs" : "../vendor/ort/ort.wasm.min.mjs");
  ort.env.wasm.wasmPaths = new URL("../vendor/ort/", import.meta.url).href;
  // tots els nuclis si la pàgina està aïllada (COOP/COEP); si no, onnxruntime només pot fer-ne servir 1
  const fils = !self.crossOriginIsolated ? 1
    : Math.max(1, Math.min(filsDemanats || navigator.hardwareConcurrency || 4, 16));
  ort.env.wasm.numThreads = fils;
  const { fitxers: f, baixat } = await carregaModels(local, (p) => post("baixada", p), (text) => post("avis", { text }));
  post("estat", { text: "Preparant els models…" });
  const txt = (b) => new TextDecoder().decode(b), json = (b) => JSON.parse(txt(b));
  const sessio = (b, ep = "wasm") => ort.InferenceSession.create(new Uint8Array(b), { executionProviders: [ep], graphOptimizationLevel: "all" });
  const conf = json(f.config);
  const rnnt = new RNNT(ort, await sessio(f.encoder, gpu ? "webgpu" : "wasm"), await sessio(f.decoder), conf, txt(f.tokens).split("\n"));
  const vad = new VAD(ort, await sessio(f.vad));
  const mel = new Mel(llegeixNpy(f.melFb).dades, llegeixNpy(f.finestra).dades);
  const puntuador = new Puntuador(
    new ModelEtiquetes(ort, await sessio(f.scModel), json(f.scTok), json(f.scConfig)),
    new ModelEtiquetes(ort, await sessio(f.umuModel), json(f.umuTok), json(f.umuConfig)));
  motor = new Motor({ mel, vad, rnnt, puntuador });
  post("llest", { fils, gpu, gpuDemanada: !!volGpu, aillat: !!self.crossOriginIsolated, baixat, segons: (performance.now() - t0) / 1000 });
}

async function transcriu(pcm) {
  if (!motor) throw new Error("Els models no estan carregats");
  const durada = pcm.length / 16000;
  const r = await motor.transcriu(pcm, (fase, f, tros) =>
    post("progres", { fase, f: fase === "asr" && tros ? Math.min(1, tros.ini / durada) : f }));
  post("resultat", { resultat: r });
}
