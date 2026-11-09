// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Fitxers dels models i baixada amb memòria cau (Cache API): la primera vegada es baixen
// (≈ 460 MB) amb progrés; després es lligen de la memòria cau del navegador.

export const CAU = "subtitols-ca-models-v1";

/** nom -> camí dins de la carpeta dels models. */
export const FITXERS = {
  encoder: "conformer-ca-es/encoder.q8w.onnx",
  decoder: "conformer-ca-es/decoder_joint.onnx",
  config: "conformer-ca-es/config.json",
  tokens: "conformer-ca-es/tokens.txt",
  melFb: "conformer-ca-es/mel_fb.npy",
  finestra: "conformer-ca-es/finestra.npy",
  vad: "silero-vad/silero_vad.onnx",
  scModel: "softcatala/onnx/model_q8pc.onnx",
  scTok: "softcatala/tokenizer.json",
  scConfig: "softcatala/config.json",
  umuModel: "umu-oficial/onnx/model.onnx",
  umuTok: "umu-oficial/tokenizer.json",
  umuConfig: "umu-oficial/config.json",
};

async function obriCau() {
  try { return await caches.open(CAU); } catch { return null; }      // sense Cache API: sense memòria cau
}

async function mida(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return Number(r.headers.get("Content-Length")) || 0;
  } catch { return 0; }
}

/**
 * Baixa (o llig de la memòria cau) tots els fitxers. base: URL de la carpeta dels models.
 * progres({rebut, total, fitxer}) en bytes, només per als que s'han de baixar.
 * Torna {nom: ArrayBuffer}.
 */
export async function carregaModels(base, progres = () => {}) {
  const cau = await obriCau();
  const urls = Object.fromEntries(Object.entries(FITXERS).map(([k, c]) => [k, new URL(c, base).href]));
  const res = {}, falten = [];
  for (const [k, u] of Object.entries(urls)) {
    const r = cau && (await cau.match(u));
    if (r) res[k] = await r.arrayBuffer();
    else falten.push(k);
  }
  if (!falten.length) return { fitxers: res, baixat: 0 };
  const mides = await Promise.all(falten.map((k) => mida(urls[k])));
  const total = mides.reduce((a, b) => a + b, 0);
  let rebut = 0;
  for (const k of falten) {
    const r = await fetch(urls[k]);
    if (!r.ok) throw new Error(`No s'ha pogut baixar ${FITXERS[k]} (${r.status})`);
    const parts = [], lector = r.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      parts.push(value);
      rebut += value.length;
      progres({ rebut, total, fitxer: FITXERS[k] });
    }
    const buf = await new Blob(parts).arrayBuffer();
    res[k] = buf;
    if (cau) {
      try { await cau.put(urls[k], new Response(buf, { headers: { "Content-Length": String(buf.byteLength) } })); }
      catch (e) { console.warn("No s'ha pogut desar a la memòria cau:", FITXERS[k], e); }
    }
  }
  return { fitxers: res, baixat: rebut };
}

/** Esborra els models de la memòria cau. */
export async function esborraModels() {
  try { return await caches.delete(CAU); } catch { return false; }
}
