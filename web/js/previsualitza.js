// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Previsualització: vídeo + JSON del motor -> subtítols segmentats en temps real.
// Cada canvi de paràmetre només torna a executar segmenta() (uns ms); no es transcriu de nou.
import * as S from "./subtitols.js";

const $ = (s) => document.querySelector(s);
const form = $("#params"), video = $("#video"), capa = $("#capa"), llista = $("#llista");
const CLAU = "subtitols-ca.params";

let paraules = null, nomBase = "subtitols", P = null, cues = [], finals = [], actiu = -1;

// ---------------------------------------------------------------- paràmetres

function omple(perfil, desats = {}) {
  const P0 = { ...S.PERFILS[perfil], ...desats };
  for (const el of form.elements) {
    if (!el.name || el.name === "perfil") continue;
    if (el.type === "checkbox") el.checked = el.name === "amb_color" ? !!P0.color
      : el.name === "amb_fons" ? !!P0.fons : !!P0[el.name];
    else if (el.type === "color") { if (P0[el.name]) el.value = P0[el.name].toLowerCase(); }
    else if (el.name in P0) el.value = P0[el.name];
  }
  form.perfil.value = perfil;
}

function llig() {
  const f = form.elements, num = (n) => (f[n].value === "" ? null : Number(f[n].value));
  return S.params(f.perfil.value, {
    max_car: num("max_car"), max_linies: num("max_linies"), max_paraules: num("max_paraules"),
    max_cps: num("max_cps"), durada_min: num("durada_min"), durada_max: num("durada_max"),
    desfas: num("desfas"), ressalta: f.ressalta.value,
    subratlla: f.subratlla.checked, negreta: f.negreta.checked, cursiva: f.cursiva.checked,
    color: f.amb_color.checked ? f.color.value.toUpperCase() : "",
    fons: f.amb_fons.checked ? f.fons.value.toUpperCase() : "",
  });
}

function desa() {
  try { localStorage.setItem(CLAU, JSON.stringify({ perfil: form.perfil.value, P })); } catch { /* sense memòria */ }
}

// ---------------------------------------------------------------- càlcul

function recalcula() {
  P = llig();
  desa();
  if (!paraules) return;
  const t0 = performance.now();
  cues = S.segmenta(paraules, P);
  finals = S.expandeix(cues, P);
  const ms = performance.now() - t0;
  $("#estat").textContent = `${paraules.length} paraules · ${cues.length} subtítols · calculat en ${ms.toFixed(0)} ms`;
  $("#avisos").textContent = [...S.avisos(P, "srt")].join(" ");
  pintaLlista();
  actiu = -1;
  pintaCapa();
}

let espera;
form.addEventListener("input", (e) => {
  if (e.target.name === "perfil") omple(e.target.value);
  clearTimeout(espera);
  espera = setTimeout(recalcula, paraules && paraules.length > 3000 ? 150 : 0);
});

// ---------------------------------------------------------------- llista

function fmt(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
}

function pintaLlista() {
  $("#nombre").textContent = `(${cues.length})`;
  const frag = document.createDocumentFragment();
  cues.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "sub";
    d.dataset.i = i;
    const car = S.text(c).replace("\n", " ").length, dur = c.fi - c.ini, cps = car / dur;
    const avis = [];
    if (cps > P.max_cps + 1e-9) avis.push(`${cps.toFixed(0)} car/s`);
    if (i + 1 < cues.length && S.esFuncional(c.paraules[c.paraules.length - 1])) avis.push("tall darrere de paraula funcional");
    d.innerHTML = `<small>${fmt(c.ini)} → ${fmt(c.fi)}${avis.length ? " · <b>" + avis.join(" · ") + "</b>" : ""}</small>`;
    d.append(S.text(c));
    frag.append(d);
  });
  llista.replaceChildren(frag);
}

llista.addEventListener("click", (e) => {
  const d = e.target.closest(".sub");
  if (d && video.src) { video.currentTime = cues[+d.dataset.i].ini + 0.001; video.play(); }
});

// ---------------------------------------------------------------- capa sobre el vídeo

function cerca(t) {                       // darrer subtítol amb ini <= t (cerca binària)
  let a = 0, b = finals.length - 1, r = -1;
  while (a <= b) { const m = (a + b) >> 1; if (finals[m].ini <= t) { r = m; a = m + 1; } else b = m - 1; }
  return r >= 0 && t < finals[r].fi ? r : -1;
}

function estilMarca() {
  const e = [];
  const sense = !(P.subratlla || P.negreta || P.cursiva || P.color || P.fons);
  if (P.subratlla || sense) e.push("text-decoration: underline");
  if (P.negreta) e.push("font-weight: 800");
  if (P.cursiva) e.push("font-style: italic");
  if (P.color) e.push(`color: ${P.color}`);
  if (P.fons) e.push(`background: ${P.fons}`);
  return e.join(";");
}

function htmlEntrada(e) {               // com S.text(), però amb <span> per a la pantalla
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const estil = estilMarca(), res = [];
  let k = 0;
  for (const lin of e.cue.linies) {
    let out = "", dins = false;          // les paraules marcades seguides van dins del mateix <span>
    for (const p of lin) {
      if (e.fins === null || k <= e.fins) {
        const m = e.marcades.has(k);
        if (m && !dins) out += (out ? " " : "") + `<span style="${estil}">`;
        else if (dins && !m) out += "</span> ";
        else if (out) out += " ";
        out += esc(p.text + (p.punt || ""));
        dins = m;
      }
      k++;
    }
    if (dins) out += "</span>";
    if (out) res.push(`<span class="linia">${out}</span>`);
  }
  return res.join("<br>");
}

function pintaCapa() {
  const i = finals.length ? cerca(video.currentTime) : -1;
  if (i === actiu) return;
  actiu = i;
  capa.innerHTML = i >= 0 ? htmlEntrada(finals[i]) : "";
  const c = i >= 0 ? cues.indexOf(finals[i].cue) : -1;
  llista.querySelector(".sub.actiu")?.classList.remove("actiu");
  const d = c >= 0 ? llista.children[c] : null;
  if (d) { d.classList.add("actiu"); if (!video.paused) d.scrollIntoView({ block: "nearest" }); }
}

function bucle() {
  pintaCapa();
  if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(bucle);
  else requestAnimationFrame(bucle);
}

function midaLletra() {
  const h = video.clientHeight || 360;
  const vertical = video.videoHeight > video.videoWidth;
  capa.classList.toggle("vertical", vertical);
  capa.style.fontSize = `${Math.max(12, h * (vertical ? 0.045 : 0.055))}px`;
}
new ResizeObserver(midaLletra).observe(video);
video.addEventListener("loadedmetadata", midaLletra);
video.addEventListener("seeked", pintaCapa);

// ---------------------------------------------------------------- fitxers i baixades

$("#f-video").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  video.src = URL.createObjectURL(f);
  video.hidden = false;
  $("#buit").hidden = true;
  bucle();
});

$("#f-json").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.paraules)) throw new Error("no té el camp «paraules»");
    paraules = d.paraules;
    nomBase = f.name.replace(/\.json$/i, "");
    recalcula();
  } catch (err) {
    $("#estat").textContent = `No he pogut llegir el JSON: ${err.message}`;
  }
});

// transcripció feta al navegador (transcriu.js)
document.addEventListener("transcripcio", (e) => {
  paraules = e.detail.paraules;
  nomBase = e.detail.nom;
  recalcula();
});

document.querySelectorAll("[data-baixa]").forEach((b) => b.addEventListener("click", () => {
  if (!paraules) return;
  const fmt = b.dataset.baixa;
  const cont = fmt === "srt" ? S.srt(finals, P) : fmt === "vtt" ? S.vtt(finals, P) : S.txt(paraules);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([cont], { type: "text/plain;charset=utf-8" }));
  a.download = `${nomBase}.${form.perfil.value}${P.ressalta ? "." + P.ressalta : ""}.${fmt}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}));

// ---------------------------------------------------------------- inici

let desats = null;
try { desats = JSON.parse(localStorage.getItem(CLAU) || "null"); } catch { /* sense memòria */ }
omple(desats?.perfil || "horitzontal", desats?.P || {});
P = llig();
