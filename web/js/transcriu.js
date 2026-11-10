// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Transcripció al navegador: models (worker) + lectura de l'àudio + progrés. Quan acaba, envia
// l'esdeveniment "transcripcio" amb el resultat, i previsualitza.js en fa els subtítols.
import { llegeixAudio, SR } from "./audio.js";
import { esborraModels, modelsDesats } from "./motor/models.js";

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
const MOBIL = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

let worker = null, llest = null, fitxer = null;
const bTrans = $("#b-transcriu"), bCancel = $("#b-cancel"), barra = $("#barra"), pText = $("#p-text");
const info = $("#info-motor");

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
        console.info("motor a punt", m);            // segons, fils, GPU: detalls tècnics
        // a la pàgina, només el que l'usuari ha de saber
        info.textContent = [
          m.aillat ? "" : "Aquest navegador no deixa fer servir tots els nuclis: anirà més lent.", avis,
          MOBIL ? "Al mòbil, transcriure tarda aproximadament el que dura el vídeo." : "",
        ].filter(Boolean).join(" ");
        mostra("Motor a punt.", 1);
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
    const resultat = await new Promise((resol, rebutja) => {
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
    mostra(resultat.paraules.length ? `Fet: ${temps(durada)} d'àudio en ${temps(s)}.`
      : "No s'ha trobat veu en aquest fitxer.", 1);
    document.dispatchEvent(new CustomEvent("transcripcio", {
      detail: { resultat, nom: fitxer.name.replace(/\.[^.]+$/, "") },
    }));
    console.info("transcripció", { durada, segons: s, lectura: (t1 - tA) / 1000, total: (performance.now() - t0) / 1000, rtf: s / durada, temps: resultat.temps });
  } catch (e) {
    mostra(`Error: ${e.message}`, 0);
    console.error(e);
    atura();
  } finally {
    bCancel.hidden = true;
    bTrans.disabled = !fitxer;
  }
}

$("#f-video").addEventListener("change", async (e) => {
  fitxer = e.target.files[0] || null;
  bTrans.disabled = !fitxer;
  $("#progres").hidden = true;            // el missatge del fitxer anterior ja no val
  if (!fitxer || llest) return;
  // Si els models ja són al navegador, el motor es prepara mentre l'usuari mira el vídeo. Si no,
  // no es baixa res (≈ 460 MB) fins que prem «Transcriu».
  if (await modelsDesats(LOCAL)) preparaMotor().catch((err) => mostra(`Error: ${err.message}`, 0));
  else info.textContent = "La primera vegada, en prémer «Transcriu» es baixen els models (≈ 460 MB" +
    (MOBIL ? "; millor amb wifi" : "") + "). Després queden al navegador.";
});
bTrans.addEventListener("click", transcriu);
bCancel.addEventListener("click", () => { atura(); mostra("Cancel·lat.", 0); });
$("#b-esborra").addEventListener("click", async () => {
  atura();
  await esborraModels();
  info.textContent = "Models esborrats del navegador.";
});
