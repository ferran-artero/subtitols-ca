// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Previsualització: vídeo + JSON del motor -> subtítols segmentats en temps real, correccions i
// baixades. Cada canvi de paràmetre només torna a executar segmenta() (uns ms); no es transcriu de nou.
import * as S from "./subtitols.js";
import { nota } from "./interficie.js";

const $ = (s) => document.querySelector(s);
const form = $("#params"), video = $("#video"), capa = $("#capa"), llista = $("#llista");
const CLAU = "subtitols-ca.params", CLAU_SESSIO = "subtitols-ca.sessio";

// doc: el JSON del motor sencer (és el que es baixa i es desa); paraules = doc.paraules
let doc = null, paraules = null, nomBase = "", P = null, cues = [], finals = [], actiu = -1;
const desfets = [];                       // correccions fetes, per a desfer-les

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
  cues = S.segmenta(paraules, P);
  finals = S.expandeix(cues, P);
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
  $("#nombre").textContent = cues.length ? `(${cues.length})` : "";
  $("#b-desfes").hidden = !desfets.length;
  const frag = document.createDocumentFragment();
  cues.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "sub";
    d.dataset.i = i;
    d.innerHTML = `<small>${fmt(c.ini)} → ${fmt(c.fi)}</small><span class="text"></span>` +
      `<button type="button" class="llapis" aria-label="Corregeix aquest subtítol" title="Corregeix">${LLAPIS}</button>`;
    c.linies.forEach((lin, l) => {        // una <span> per paraula: en clicar-la, el vídeo hi salta
      if (l) d.children[1].append("\n");
      lin.forEach((p, k) => {
        const s = document.createElement("span");
        s.className = "p";
        s.dataset.t = p.ini;
        s.textContent = p.text + (p.punt || "");
        d.children[1].append(k ? " " : "", s);
      });
    });
    frag.append(d);
  });
  llista.replaceChildren(frag);
  document.dispatchEvent(new CustomEvent("subtitols", { detail: { nombre: cues.length, nom: nomBase } }));   // per a interficie.js
}

llista.addEventListener("click", (e) => {
  const d = e.target.closest(".sub");
  if (!d || d.classList.contains("editant")) return;
  if (e.target.closest(".llapis")) edita(d);
  else if (video.src) {
    video.currentTime = +(e.target.closest(".p")?.dataset.t ?? cues[+d.dataset.i].ini) + 0.001;
    video.play();
  }
});

// ---------------------------------------------------------------- correccions

// Es corregeix la llista de paraules, no el text del subtítol: així les correccions es mantenen
// quan es canvia un paràmetre i es torna a segmentar.
const LLAPIS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>`;
const SIGNES = ".,?!:;…";

/** Text corregit d'un subtítol -> paraules. Amb les mateixes paraules, cadascuna conserva els seus
 *  temps; si n'hi ha més o menys, el temps del subtítol es reparteix segons els caràcters. */
function paraulesNoves(text, velles) {
  const noves = [];
  for (const tros of text.split(/\s+/).filter(Boolean)) {
    const punt = SIGNES.includes(tros.at(-1)) ? tros.at(-1) : "";
    const t = punt ? tros.slice(0, -1) : tros;
    if (t) noves.push({ text: t, punt: punt || null });
    else if (noves.length) noves.at(-1).punt = punt;         // un signe solt va amb la paraula d'abans
  }
  if (noves.length === velles.length) {
    return noves.map((n, k) => (n.text === velles[k].text && (n.punt || "") === (velles[k].punt || "")
      ? velles[k] : { ...velles[k], ...n, corregida: true }));
  }
  const a = velles[0].ini, b = velles.at(-1).fi;
  const pes = noves.map((n) => [...n.text].length + 1), total = pes.reduce((x, y) => x + y, 0);
  let t = a;
  return noves.map((n, k) => {
    const ini = t;
    t += (b - a) * pes[k] / total;
    return { ...n, ini: +ini.toFixed(3), fi: +(k === noves.length - 1 ? b : t).toFixed(3), corregida: true };
  });
}

function edita(d) {
  const c = cues[+d.dataset.i], caixa = d.querySelector(".text"), abans = caixa.textContent;
  video.pause();
  d.classList.add("editant");
  caixa.contentEditable = "plaintext-only";
  if (caixa.contentEditable !== "plaintext-only") caixa.contentEditable = "true";
  caixa.focus();
  getSelection().selectAllChildren(caixa);
  getSelection().collapseToEnd();
  let fet = false;
  const acaba = (desa) => {
    if (fet) return;
    fet = true;
    caixa.removeEventListener("keydown", tecla);
    const text = caixa.innerText.trim();
    caixa.contentEditable = "false";
    d.classList.remove("editant");
    if (!desa || text.replace(/\s+/g, " ") === abans.replace(/\s+/g, " ")) { recalcula(); return; }
    corregeix([{ i: paraules.indexOf(c.paraules[0]), n: c.paraules.length, noves: paraulesNoves(text, c.paraules) }]);
  };
  const tecla = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); acaba(true); }
    else if (e.key === "Escape") acaba(false);
  };
  caixa.addEventListener("keydown", tecla);
  caixa.addEventListener("blur", () => acaba(true), { once: true });
}

/** Aplica els canvis [{i, n, noves}] (de l'últim al primer, perquè els índexs valguen) i els
 *  apunta junts per a desfer-los d'una vegada. */
function corregeix(canvis) {
  desfets.push(canvis.map(({ i, n, noves }) => ({ i, noves, velles: paraules.splice(i, n, ...noves) })));
  actualitza();
}

function actualitza() {
  doc.text = S.txt(paraules).trimEnd();   // el text sencer del JSON, amb les correccions
  recalcula();
  desaSessio();
}

$("#b-desfes").addEventListener("click", () => {
  for (const u of (desfets.pop() || []).reverse()) paraules.splice(u.i, u.noves.length, ...u.velles);
  actualitza();
});

// Cerca i substitueix: paraules senceres (una o diverses de seguides), sense distingir majúscules.
// Es conserven el signe de darrere i la majúscula inicial del que se substitueix.
const fCerca = $("#cerca");
$("#b-cerca").addEventListener("click", () => {
  fCerca.hidden = !fCerca.hidden;
  if (!fCerca.hidden) fCerca.que.focus();
});
fCerca.addEventListener("submit", (e) => {
  e.preventDefault();
  const que = fCerca.que.value.toLowerCase().split(/\s+/).filter(Boolean), n = que.length;
  if (!paraules || !n) return;
  const canvis = [];
  for (let i = paraules.length - n; i >= 0; i--) {
    if (!que.every((q, k) => paraules[i + k].text.toLowerCase() === q)) continue;
    const velles = paraules.slice(i, i + n);
    let per = fCerca.per.value.trim();
    if (per && /^\p{Lu}/u.test(velles[0].text)) per = per[0].toUpperCase() + per.slice(1);
    if (per && !SIGNES.includes(per.at(-1))) per += velles.at(-1).punt || "";
    const noves = paraulesNoves(per, velles);
    if (noves.length === n && noves.every((p, k) => p === velles[k])) continue;      // ja era igual
    canvis.push({ i, n, noves });
    i -= n - 1;
  }
  if (canvis.length) corregeix(canvis);
  nota(canvis.length ? `${canvis.length} ${canvis.length === 1 ? "canvi fet" : "canvis fets"}.` : `No he trobat «${fCerca.que.value.trim()}».`);
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
  if (d) {
    d.classList.add("actiu");
    if (!video.paused && !llista.querySelector(".editant")) {   // es mou la llista, mai la pàgina
      const r = d.getBoundingClientRect(), R = llista.getBoundingClientRect();
      if (r.top < R.top) llista.scrollTop -= R.top - r.top + 8;
      else if (r.bottom > R.bottom) llista.scrollTop += r.bottom - R.bottom + 8;
    }
  }
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
video.addEventListener("loadedmetadata", () => {
  midaLletra();
  if (!video.videoWidth) return;          // àudio sol
  // el format es tria sol: vídeo vertical -> perfil vertical (i a l'inrevés)
  const vertical = video.videoHeight > video.videoWidth;
  if (vertical === (form.perfil.value === "vertical")) return;
  form.perfil.value = vertical ? "vertical" : "horitzontal";
  form.perfil.dispatchEvent(new Event("input", { bubbles: true }));
});
video.addEventListener("seeked", pintaCapa);

// ---------------------------------------------------------------- fitxers i baixades

$("#f-video").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!video.hidden) neteja();            // un altre vídeo: els subtítols de l'anterior ja no valen
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
    carrega(d, f.name.replace(/\.json$/i, "").replace(/^subtitols_/, ""));
  } catch (err) {
    nota(`No he pogut llegir el JSON: ${err.message}`);
  }
});

/** Subtítols nous: d'una transcripció acabada de fer, d'un JSON o de la sessió desada. */
function carrega(d, nom) {
  doc = d; paraules = d.paraules; nomBase = nom;
  desfets.length = 0;
  recalcula();
  desaSessio();
}

// La transcripció (amb les correccions) es desa al navegador: si es tanca la pestanya, es pot
// continuar. El vídeo no es desa: cal tornar-lo a afegir.
function desaSessio() {
  try { localStorage.setItem(CLAU_SESSIO, JSON.stringify({ nom: nomBase, doc })); } catch { /* sense memòria o massa gran */ }
}

function neteja() {
  doc = null; paraules = null; cues = []; finals = []; actiu = -1; desfets.length = 0;
  capa.innerHTML = "";
  $("#avisos").textContent = "";
  pintaLlista();
}

// transcripció feta al navegador (transcriu.js)
document.addEventListener("transcripcio", (e) => carrega(e.detail.resultat, e.detail.nom));

document.querySelectorAll("[data-baixa]").forEach((b) => b.addEventListener("click", () => {
  if (!paraules) return;
  const fmt = b.dataset.baixa;
  const cont = fmt === "srt" ? S.srt(finals, P) : fmt === "vtt" ? S.vtt(finals, P)
    : fmt === "txt" ? S.txt(paraules) : JSON.stringify(doc, null, 1);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([cont], { type: "text/plain;charset=utf-8" }));
  a.download = `subtitols_${nomBase}.${fmt}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}));

// ---------------------------------------------------------------- inici

let desats = null;
try { desats = JSON.parse(localStorage.getItem(CLAU) || "null"); } catch { /* sense memòria */ }
omple(desats?.perfil || "horitzontal", desats?.P || {});
P = llig();

let sessio = null;
try { sessio = JSON.parse(localStorage.getItem(CLAU_SESSIO) || "null"); } catch { /* sense memòria */ }
if (sessio?.doc?.paraules?.length) {
  $("#sessio-nom").textContent = sessio.nom;
  $("#sessio").hidden = false;
  $("#b-recupera").addEventListener("click", () => carrega(sessio.doc, sessio.nom));
  $("#b-descarta").addEventListener("click", () => {
    try { localStorage.removeItem(CLAU_SESSIO); } catch { /* sense memòria */ }
    $("#sessio").hidden = true;
  });
}
