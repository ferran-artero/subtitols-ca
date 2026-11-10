// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Interfície: tema clar o fosc, triar o arrossegar el fitxer, estat de la pàgina i desplegables.
// No transcriu ni segmenta: posa el fitxer a #f-video o #f-json i envia "change", que és el que
// escolten transcriu.js i previsualitza.js.

const $ = (s) => document.querySelector(s);
const arrel = document.documentElement, cos = document.body;
const fVideo = $("#f-video"), fJson = $("#f-json"), form = $("#params"), capa = $("#capa");

/** Llig i desa a la memòria del navegador (si n'hi ha). */
const memoria = {
  llig(clau) { try { return localStorage.getItem(clau); } catch { return null; } },
  desa(clau, valor) {
    try { if (valor === null) localStorage.removeItem(clau); else localStorage.setItem(clau, valor); } catch { /* sense memòria */ }
  },
};

/** Missatge breu a baix de la pantalla. */
let esperaNota;
export function nota(text) {
  const n = $("#nota");
  n.textContent = text;
  n.hidden = false;
  clearTimeout(esperaNota);
  esperaNota = setTimeout(() => { n.hidden = true; }, 4000);
}

// ---------------------------------------------------------------- tema

// El tema inicial el posa index.html abans de pintar la pàgina. Si el que tria l'usuari coincideix
// amb el del sistema, no es desa: així el continua seguint.
const CLAU_TEMA = "subtitols-ca.tema";
const sistemaFosc = matchMedia("(prefers-color-scheme: dark)");
const temaSistema = () => (sistemaFosc.matches ? "fosc" : "clar");

$("#b-tema").addEventListener("click", () => {
  const nou = arrel.dataset.tema === "fosc" ? "clar" : "fosc";
  arrel.dataset.tema = nou;
  memoria.desa(CLAU_TEMA, nou === temaSistema() ? null : nou);
});
sistemaFosc.addEventListener("change", () => {
  if (!memoria.llig(CLAU_TEMA)) arrel.dataset.tema = temaSistema();
});

// ---------------------------------------------------------------- fitxers: triar i arrossegar

const EXT_MEDIA = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i;
const esJson = (f) => /\.json$/i.test(f.name) || f.type === "application/json";
const esMedia = (f) => /^(video|audio)\//.test(f.type) || EXT_MEDIA.test(f.name);
const ocupat = () => !$("#b-cancel").hidden;          // transcriu.js mostra «Cancel·la» mentre transcriu

document.querySelectorAll("[data-tria]").forEach((b) =>
  b.addEventListener("click", () => $(`#${b.dataset.tria}`).click()));

/** Posa un fitxer arrossegat a l'<input> i avisa com si l'usuari l'hagués triat. */
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
  else if (ocupat()) nota("Espera que acabi la transcripció o cancel·la-la abans de canviar de fitxer.");
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

// body[data-estat]: "inici" (cap fitxer), "taller" (fitxer triat: botó «Transcriu») i "fet" (hi ha
// subtítols: el botó passa a ser «Baixa»). previsualitza.js avisa amb "subtitols" cada vegada que
// pinta la llista (detail = {nombre, nom}).
const mida = (b) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} kB` : b < 1e9 ? `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB` : `${(b / 1e9).toFixed(2)} GB`);
const fitxa = (nom, detall) => { $("#nom-fitxer").textContent = nom; $("#mida-fitxer").textContent = detall; };

document.addEventListener("subtitols", ({ detail: d }) => {
  cos.dataset.estat = d.nombre ? "fet" : "taller";
  if (d.nombre && !fVideo.files[0]) fitxa(d.nom, "Transcripció sense vídeo");
});
fVideo.addEventListener("change", () => {
  const f = fVideo.files[0];
  if (!f) return;
  if (cos.dataset.estat === "inici") cos.dataset.estat = "taller";
  fitxa(f.name, mida(f.size));
  $("#escena").classList.toggle("audio", f.type.startsWith("audio/"));
});

// les marques del ressaltat només es mostren si hi ha ressaltat
const marques = () => form.toggleAttribute("data-ressalta", !!form.ressalta.value);
form.addEventListener("input", marques);
marques();

// ---------------------------------------------------------------- aspecte de la previsualització

const CLAU_VISTA = "subtitols-ca.vista", vMida = $("#v-mida"), vFons = $("#v-fons");
function vista() {
  capa.style.setProperty("--escala", vMida.value);
  capa.classList.toggle("sense-fons", vFons.value === "no");
}
try {
  const v = JSON.parse(memoria.llig(CLAU_VISTA) || "{}");
  if (v.mida) vMida.value = v.mida;
  if (v.fons) vFons.value = v.fons;
} catch { /* dades desades malmeses */ }
for (const el of [vMida, vFons]) el.addEventListener("change", () => {
  vista();
  memoria.desa(CLAU_VISTA, JSON.stringify({ mida: vMida.value, fons: vFons.value }));
});
vista();

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
