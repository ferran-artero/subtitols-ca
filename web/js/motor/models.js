// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// D'on es baixen els models i memòria cau (Cache API): la primera vegada es baixen (≈ 460 MB)
// amb progrés; després es lligen de la memòria cau del navegador.

export const CAU = "subtitols-ca-models-v1";

// Repositoris de Hugging Face i revisió (commit) de cadascun. La memòria cau va per adreça: amb
// la revisió fixada, una adreça no canvia mai de contingut. Per a canviar de model, es puja el
// nou, es canvia la revisió (o el nom del fitxer) i el navegador el baixarà sol.
const REVISIONS = {
  "ferran-artero/stt_ca-es_conformer_transducer_large-onnx": "6f048151bf6c0fd2dcd3679eb24b11d6f2359d35",
  "ferran-artero/fullstop-catalan-punctuation-prediction-onnx": "a88270cdba47319766817104fbfd2124219e7cf5",
  "UMUTeam/catalan_capitalization_punctuation_restoration_int8": "0e04b9fe962c2c48cb01a7f3686954139050b922",
};
const hf = (repo) => `https://huggingface.co/${repo}/resolve/${REVISIONS[repo]}/`;
const [CONFORMER, SOFTCATALA, UMU] = Object.keys(REVISIONS);

/** Origen de cada model: a Hugging Face i dins d'una carpeta local (models_onnx/). */
export const FONTS = {
  conformer: { hf: hf(CONFORMER), local: "conformer-ca-es/" },
  vad: { hf: hf(CONFORMER) + "silero-vad/", local: "silero-vad/" },
  softcatala: { hf: hf(SOFTCATALA), local: "softcatala/" },
  umu: { hf: hf(UMU), local: "umu-oficial/" },
};

/**
 * nom -> [font, camí a Hugging Face, mida aproximada en MB (per si el servidor no la diu),
 *         camí en local si és diferent].
 */
export const FITXERS = {
  encoder: ["conformer", "encoder.q8w.onnx", 191],
  decoder: ["conformer", "decoder_joint.onnx", 17],
  config: ["conformer", "config.json", 0],
  tokens: ["conformer", "tokens.txt", 0],
  melFb: ["conformer", "mel_fb.npy", 0.1],
  finestra: ["conformer", "finestra.npy", 0],
  vad: ["vad", "silero_vad.onnx", 2.3],
  scModel: ["softcatala", "onnx/model_q8pc.onnx", 127],
  scTok: ["softcatala", "tokenizer.json", 3.8],
  scConfig: ["softcatala", "config.json", 0],
  umuModel: ["umu", "model.onnx", 126, "onnx/model.onnx"],     // la UMU el té a l'arrel
  umuTok: ["umu", "tokenizer.json", 3.8],
  umuConfig: ["umu", "config.json", 0],
};

/** local: URL de la carpeta models_onnx/ (proves en local) o null (Hugging Face). */
export function adreces(local = null) {
  return Object.fromEntries(Object.entries(FITXERS).map(([k, [font, cami, , camiLocal]]) =>
    [k, local ? new URL(FONTS[font].local + (camiLocal || cami), local).href : FONTS[font].hf + cami]));
}

async function obriCau() {
  try { return await caches.open(CAU); } catch { return null; }      // sense Cache API: sense memòria cau
}

async function mida(url, aprox) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    const n = Number(r.headers.get("Content-Length"));
    if (n > 1000 || aprox < 0.5) return n || 0;
  } catch { /* sense mida: s'usa l'aproximada */ }
  return aprox * 1e6;
}

/**
 * Baixa (o llig de la memòria cau) tots els fitxers. progres({rebut, total, fitxer}) en bytes, només
 * per als que s'han de baixar; avis(text) si no es poden desar. Torna {fitxers: {nom: ArrayBuffer}, baixat}.
 */
export async function carregaModels(local = null, progres = () => {}, avis = () => {}) {
  const cau = await obriCau();
  const urls = adreces(local);
  const res = {}, falten = [];
  for (const [k, u] of Object.entries(urls)) {
    const r = cau && (await cau.match(u));
    if (r) res[k] = await r.arrayBuffer();
    else falten.push(k);
  }
  if (!falten.length) return { fitxers: res, baixat: 0 };
  const mides = await Promise.all(falten.map((k) => mida(urls[k], FITXERS[k][2])));
  const total = mides.reduce((a, b) => a + b, 0);
  let rebut = 0;
  for (const k of falten) {
    const r = await fetch(urls[k]);
    if (!r.ok) throw new Error(`No s'ha pogut baixar ${FITXERS[k][1]} (${r.status})`);
    const parts = [], lector = r.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      parts.push(value);
      rebut += value.length;
      progres({ rebut, total: Math.max(total, rebut), fitxer: FITXERS[k][1] });
    }
    const buf = await new Blob(parts).arrayBuffer();
    res[k] = buf;
    if (cau) {
      try { await cau.put(urls[k], new Response(buf, { headers: { "Content-Length": String(buf.byteLength) } })); }
      catch (e) {
        console.warn("No s'ha pogut desar a la memòria cau:", FITXERS[k][1], e);
        avis("El navegador no té prou espai per a guardar tots els models: la pròxima vegada es tornaran a baixar.");
      }
    }
  }
  return { fitxers: res, baixat: rebut };
}

/** Esborra els models de la memòria cau. */
export async function esborraModels() {
  try { return await caches.delete(CAU); } catch { return false; }
}
