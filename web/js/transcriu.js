// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Transcripció al navegador: models (worker) + lectura de l'àudio + progrés. Quan acaba, envia
// l'esdeveniment "transcripcio" amb les paraules, i previsualitza.js en fa els subtítols.
import { llegeixAudio, SR } from "./audio.js";
import { esborraModels } from "./motor/models.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
// Models: de Hugging Face; en local (eines/serveix.py), de /models_onnx/. ?models=hf força Hugging
// Face i ?models=<carpeta> fa servir una altra carpeta.
const LOCALHOST = ["localhost", "127.0.0.1"].includes(location.hostname);
const pm = params.get("models");
const LOCAL = pm === "hf" ? null : pm ? new URL(pm, location.href).href
  : LOCALHOST ? new URL("/models_onnx/", location.href).href : null;
// Opcions per a proves: ?fils=N (nombre de fils) i ?gpu=1 (encoder en WebGPU).
const FILS = Number(params.get("fils")) || null, GPU = params.get("gpu") === "1";

let worker = null, llest = null, fitxer = null, resultat = null;
const bTrans = $("#b-transcriu"), bCancel = $("#b-cancel"), barra = $("#barra"), pText = $("#p-text");

const mb = (b) => (b / 1e6).toFixed(0);
const temps = (s) => (s < 60 ? `${s.toFixed(0)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);
function mostra(text, f = null) {
  $("#progres").hidden = false;
  pText.textContent = text;
  if (f === null) barra.removeAttribute("value"); else barra.value = f;
}

/** Crea el worker i carrega els models (una sola vegada). */
function preparaMotor() {
  if (llest) return llest;
  // que el navegador no esborre els models quan vaja just d'espai (sense garantia: ho decideix ell)
  navigator.storage?.persist?.().catch(() => {});
  let avis = "";
  worker = new Worker(new URL("./motor/worker.js", import.meta.url), { type: "module" });
  llest = new Promise((resol, rebutja) => {
    worker.onmessage = ({ data: m }) => {
      if (m.tipus === "baixada") mostra(`Baixant els models (només la primera vegada): ${mb(m.rebut)} de ${mb(m.total)} MB`, m.total ? m.rebut / m.total : null);
      else if (m.tipus === "estat") mostra(m.text);
      else if (m.tipus === "avis") avis = m.text;
      else if (m.tipus === "llest") {
        $("#info-motor").textContent = `Motor a punt en ${m.segons.toFixed(1)} s · ${m.fils} ${m.fils === 1 ? "fil" : "fils"}` +
          (m.gpu ? " · GPU" : m.gpuDemanada ? " · sense GPU (el navegador no té WebGPU)" : "") +
          (m.aillat ? "" : " (el navegador no permet més fils: anirà més lent)") + (avis ? `. ${avis}` : "");
        resol(m);
      } else if (m.tipus === "error") rebutja(new Error(m.missatge));
    };
    worker.onerror = (e) => rebutja(new Error(e.message || "Error en el motor"));
  });
  worker.postMessage({ tipus: "carrega", local: LOCAL, fils: FILS, gpu: GPU });
  llest.catch(() => { worker?.terminate(); worker = null; llest = null; });
  return llest;
}

function atura() {
  worker?.terminate();
  worker = null; llest = null;
  bCancel.hidden = true;
  bTrans.disabled = !fitxer;
}

async function transcriu() {
  bTrans.disabled = true;
  bCancel.hidden = false;
  const t0 = performance.now();
  try {
    mostra("Preparant el motor…");
    await preparaMotor();
    mostra("Llegint l'àudio…");
    const tA = performance.now();
    const pcm = await llegeixAudio(fitxer);
    const durada = pcm.length / SR;
    const t1 = performance.now();
    resultat = await new Promise((resol, rebutja) => {
      worker.onmessage = ({ data: m }) => {
        if (m.tipus === "progres") {
          const g = m.fase === "vad" ? 0.03 * m.f : m.fase === "asr" ? 0.03 + 0.92 * m.f : 0.97;
          const passat = (performance.now() - t1) / 1000;
          const falta = g > 0.08 ? passat * (1 - g) / g : null;
          const nom = { vad: "Detectant la veu", asr: "Transcrivint", puntuacio: "Posant signes i majúscules" }[m.fase];
          mostra(`${nom}… ${(100 * g).toFixed(0)} %${falta !== null ? ` · falten uns ${temps(falta)}` : ""}`, g);
        } else if (m.tipus === "resultat") resol(m.resultat);
        else if (m.tipus === "error") rebutja(new Error(m.missatge));
      };
      worker.postMessage({ tipus: "transcriu", pcm }, [pcm.buffer]);
    });
    const s = (performance.now() - t1) / 1000;
    mostra(`Fet: ${temps(durada)} d'àudio en ${temps(s)} (${resultat.paraules.length} paraules; ` +
      `RTF ${(s / durada).toFixed(2)}; lectura de l'àudio ${((t1 - tA) / 1000).toFixed(1)} s).`, 1);
    document.dispatchEvent(new CustomEvent("transcripcio", {
      detail: { paraules: resultat.paraules, nom: fitxer.name.replace(/\.[^.]+$/, "") },
    }));
    $("#b-json").disabled = false;
    console.info("transcripció", { durada, segons: s, total: (performance.now() - t0) / 1000, rtf: s / durada, temps: resultat.temps });
  } catch (e) {
    mostra(`Error: ${e.message}`, 0);
    console.error(e);
    atura();
  } finally {
    bCancel.hidden = true;
    bTrans.disabled = !fitxer;
  }
}

$("#f-video").addEventListener("change", (e) => {
  fitxer = e.target.files[0] || null;
  bTrans.disabled = !fitxer;
  if (fitxer) preparaMotor().catch((err) => mostra(`Error: ${err.message}`, 0));   // es comença a baixar ja
});
bTrans.addEventListener("click", transcriu);
bCancel.addEventListener("click", () => { atura(); mostra("Cancel·lat.", 0); });
$("#b-json").addEventListener("click", () => {
  if (!resultat) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(resultat, null, 1)], { type: "application/json" }));
  a.download = `${fitxer ? fitxer.name.replace(/\.[^.]+$/, "") : "transcripcio"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#b-esborra").addEventListener("click", async () => {
  atura();
  await esborraModels();
  $("#info-motor").textContent = "Models esborrats de la memòria cau.";
});
