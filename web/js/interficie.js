// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Interfície: tema clar o fosc, triar o arrossegar el fitxer, desplegables i estat de la pàgina.
// No transcriu ni segmenta: posa el fitxer a #f-video o #f-json i envia "change", que és el que
// escolten transcriu.js i previsualitza.js.

const $ = (s) => document.querySelector(s);
const arrel = document.documentElement, cos = document.body;
const fVideo = $("#f-video"), fJson = $("#f-json"), llista = $("#llista"), form = $("#params");

// ---------------------------------------------------------------- tema

const CLAU_TEMA = "subtitols-ca.tema";
const sistemaFosc = matchMedia("(prefers-color-scheme: dark)");
const temaSistema = () => (sistemaFosc.matches ? "fosc" : "clar");

$("#b-tema").addEventListener("click", () => {
  const nou = arrel.dataset.tema === "fosc" ? "clar" : "fosc";
  arrel.dataset.tema = nou;
  try {                                   // si coincideix amb el sistema, no es desa: el seguirà
    if (nou === temaSistema()) localStorage.removeItem(CLAU_TEMA); else localStorage.setItem(CLAU_TEMA, nou);
  } catch { /* sense memòria */ }
});
sistemaFosc.addEventListener("change", () => {
  let desat = null;
  try { desat = localStorage.getItem(CLAU_TEMA); } catch { /* sense memòria */ }
  if (!desat) arrel.dataset.tema = temaSistema();
});

// ---------------------------------------------------------------- nota breu

let esperaNota;
function nota(text) {
  const n = $("#nota");
  n.textContent = text;
  n.hidden = false;
  clearTimeout(esperaNota);
  esperaNota = setTimeout(() => { n.hidden = true; }, 4000);
}

// ---------------------------------------------------------------- fitxers: triar i arrossegar

const EXT_MEDIA = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i;
const esJson = (f) => /\.json$/i.test(f.name) || f.type === "application/json";
const esMedia = (f) => /^(video|audio)\//.test(f.type) || EXT_MEDIA.test(f.name);
const ocupat = () => !$("#b-cancel").hidden;          // s'està transcrivint

document.querySelectorAll("[data-tria]").forEach((b) =>
  b.addEventListener("click", () => $(`#${b.dataset.tria}`).click()));

/** Posa un fitxer arrossegat a l'<input> i avisa com si l'usuari l'haguera triat. */
function posa(input, fitxer) {
  const dt = new DataTransfer();
  dt.items.add(fitxer);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function rep(fitxer) {
  if (!fitxer) return;
  if (esJson(fitxer)) posa(fJson, fitxer);
  else if (!esMedia(fitxer)) nota("Aquest fitxer no és ni un vídeo ni un àudio.");
  else if (ocupat()) nota("Espera que acabe la transcripció o cancel·la-la abans de canviar de fitxer.");
  else posa(fVideo, fitxer);
}

const solta = $("#solta");
const portaFitxers = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
let dins = 0;                                         // dragenter i dragleave arriben per cada element
addEventListener("dragenter", (e) => { if (portaFitxers(e)) { e.preventDefault(); dins++; solta.hidden = false; } });
addEventListener("dragover", (e) => { if (portaFitxers(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
addEventListener("dragleave", (e) => { if (portaFitxers(e) && --dins <= 0) { dins = 0; solta.hidden = true; } });
addEventListener("drop", (e) => {
  if (!portaFitxers(e)) return;
  e.preventDefault();
  dins = 0; solta.hidden = true;
  rep(e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------- estat de la pàgina

const mida = (b) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} kB` : b < 1e9 ? `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB` : `${(b / 1e9).toFixed(2)} GB`);

fVideo.addEventListener("change", () => {
  const f = fVideo.files[0];
  if (!f) return;
  cos.dataset.estat = "taller";
  $("#nom-fitxer").textContent = f.name;
  $("#mida-fitxer").textContent = mida(f.size);
  $("#escena").classList.toggle("audio", f.type.startsWith("audio/"));
});
fJson.addEventListener("change", () => {
  const f = fJson.files[0];
  if (!f) return;
  cos.dataset.estat = "taller";
  if (!fVideo.files[0]) { $("#nom-fitxer").textContent = f.name; $("#mida-fitxer").textContent = "Transcripció carregada"; }
});

// mentre es transcriu no es pot canviar de fitxer (transcriu.js mostra «Cancel·la» mentre dura)
new MutationObserver(() => { $("#b-canvia").disabled = ocupat(); })
  .observe($("#b-cancel"), { attributes: true, attributeFilter: ["hidden"] });

// les baixades s'activen quan hi ha subtítols a la llista
const baixades = document.querySelectorAll(".baixa [data-baixa], .baixa [data-menu]");
new MutationObserver(() => { baixades.forEach((b) => { b.disabled = !llista.children.length; }); })
  .observe(llista, { childList: true });

// les marques del ressaltat només es mostren si hi ha ressaltat
const marques = () => { form.toggleAttribute("data-ressalta", !!form.ressalta.value); };
form.addEventListener("input", marques);
marques();

// ---------------------------------------------------------------- desplegables

function tanca(excepte = null) {
  document.querySelectorAll("[data-menu]").forEach((b) => {
    if (b === excepte) return;
    $(`#${b.dataset.menu}`).hidden = true;
    b.setAttribute("aria-expanded", "false");
  });
}
document.querySelectorAll("[data-menu]").forEach((b) => b.addEventListener("click", (e) => {
  e.stopPropagation();
  const m = $(`#${b.dataset.menu}`);
  tanca(b);
  m.hidden = !m.hidden;
  b.setAttribute("aria-expanded", String(!m.hidden));
}));
addEventListener("click", () => tanca());             // també en triar una opció del desplegable
addEventListener("keydown", (e) => { if (e.key === "Escape") tanca(); });
