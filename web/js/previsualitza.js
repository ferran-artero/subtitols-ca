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
const spans = new Map();                  // paraula -> la seua <span> a la llista

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
  form.toggleAttribute("data-ressalta", !!P.ressalta);   // el CSS només mostra les marques si hi ha ressaltat
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
  spans.clear();
  cues.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "sub";
    d.dataset.i = i;
    d.innerHTML = `<small>${fmt(c.ini)} → ${fmt(c.fi)}</small><span class="text"></span>` +
      `<button type="button" class="mini llapis" aria-label="Corregeix aquest subtítol" title="Corregeix">${LLAPIS}</button>`;
    c.linies.forEach((lin, l) => {        // una <span> per paraula: en clicar-la, el vídeo hi salta
      if (l) d.children[1].append("\n");
      lin.forEach((p, k) => {
        const s = document.createElement("span");
        s.className = "p";
        s.dataset.t = p.ini;
        s.textContent = p.text + (p.punt || "");
        spans.set(p, s);
        d.children[1].append(k ? " " : "", s);
      });
    });
    frag.append(d);
  });
  llista.replaceChildren(frag);
  marcaCerca();
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
    apunta([canvia(paraules.indexOf(c.paraules[0]), c.paraules.length, paraulesNoves(text, c.paraules))]);
  };
  const tecla = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); acaba(true); }
    else if (e.key === "Escape") acaba(false);
  };
  caixa.addEventListener("keydown", tecla);
  caixa.addEventListener("blur", () => acaba(true), { once: true });
}

/** Canvia n paraules a partir de la i per les noves. Torna el que cal per a desfer-ho. */
const canvia = (i, n, noves) => ({ i, noves, velles: paraules.splice(i, n, ...noves) });

/** Apunta una correcció (un canvi o diversos, en l'ordre en què s'han fet) per a desfer-la sencera. */
function apunta(canvis) {
  desfets.push(canvis);
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

// ---------------------------------------------------------------- cerca i substitueix

// Com a qualsevol editor: es busca el text (dins d'una paraula o de diverses de seguides, sense
// distingir majúscules), es marca a la llista i es va d'una coincidència a l'altra; substituir és opcional.
const fCerca = $("#cerca");
let trobats = [], ara = 0;                // coincidències {i, n, a, b} i la que s'està mirant
const marcats = new Set();                // paraules amb el text marcat a la llista

/** Coincidències: n paraules des de la i; de la lletra a de la primera fins a la b de l'última. */
function coincidencies(text) {
  const t = text.toLowerCase().split(/\s+/).filter(Boolean), n = t.length, res = [];
  const w = (k) => paraules[k].text.toLowerCase();
  if (n === 1) {
    paraules.forEach((_, i) => {
      for (let a = w(i).indexOf(t[0]); a >= 0; a = w(i).indexOf(t[0], a + t[0].length)) res.push({ i, n, a, b: a + t[0].length });
    });
  } else if (n) {
    for (let i = 0; i + n <= paraules.length; i++) {
      if (!w(i).endsWith(t[0]) || !w(i + n - 1).startsWith(t[n - 1])) continue;
      if (t.slice(1, -1).some((x, k) => w(i + 1 + k) !== x)) continue;
      res.push({ i, n, a: w(i).length - t[0].length, b: t[n - 1].length });
      i += n - 1;                         // sense encavalcaments
    }
  }
  return res;
}

/** Torna a buscar i pinta les marques a la llista. mou: porta la llista i el vídeo a la coincidència. */
function marcaCerca(mou = false) {
  for (const p of marcats) spans.get(p)?.replaceChildren(p.text + (p.punt || ""));
  marcats.clear();
  trobats = !fCerca.hidden && paraules ? coincidencies(fCerca.que.value) : [];
  ara = trobats.length ? (ara + trobats.length) % trobats.length : 0;
  $("#cerca-n").textContent = trobats.length ? `${ara + 1} de ${trobats.length}` : fCerca.que.value.trim() ? "Cap" : "";
  const trossos = new Map();              // paraula -> [[de, fins, és l'actual]]
  trobats.forEach((m, j) => {
    for (let k = 0; k < m.n; k++) {
      const p = paraules[m.i + k];
      if (!trossos.has(p)) trossos.set(p, []);
      trossos.get(p).push([k ? 0 : m.a, k === m.n - 1 ? m.b : p.text.length, j === ara]);
    }
  });
  for (const [p, tr] of trossos) {
    const s = spans.get(p), parts = [];
    let fins = 0;
    for (const [a, b, actual] of tr) {
      const m = document.createElement("mark");
      m.textContent = p.text.slice(a, b);
      m.classList.toggle("ara", actual);
      parts.push(p.text.slice(fins, a), m);
      fins = b;
    }
    s.replaceChildren(...parts, p.text.slice(fins) + (p.punt || ""));
    marcats.add(p);
  }
  if (mou && trobats.length) {
    const p = paraules[trobats[ara].i];
    ensenya(spans.get(p).closest(".sub"));
    if (video.src) { video.pause(); video.currentTime = p.ini + 0.001; }
  }
}

/** Substitueix una coincidència pel text de «Substitueix per»; conserva la resta de la paraula,
 *  el signe de darrere i la majúscula inicial. */
function substitueix({ i, n, a, b }) {
  const velles = paraules.slice(i, i + n), primera = velles[0].text;
  let per = fCerca.per.value.trim();
  if (per && a === 0 && /^\p{Lu}/u.test(primera)) per = per[0].toUpperCase() + per.slice(1);
  let text = primera.slice(0, a) + per + velles[n - 1].text.slice(b);
  if (text && !SIGNES.includes(text.at(-1))) text += velles[n - 1].punt || "";
  return canvia(i, n, paraulesNoves(text, velles));
}

const ves = (pas) => { ara += pas; marcaCerca(true); };
$("#b-cerca").addEventListener("click", () => {
  fCerca.hidden = !fCerca.hidden;
  ara = 0;
  marcaCerca();
  if (!fCerca.hidden) fCerca.que.focus();
});
fCerca.que.addEventListener("input", () => { ara = 0; marcaCerca(true); });
$("#b-anterior").addEventListener("click", () => ves(-1));
$("#b-seguent").addEventListener("click", () => ves(1));
$("#b-substitueix").addEventListener("click", () => {
  if (!trobats.length) return;
  apunta([substitueix(trobats[ara])]);    // en repintar, la següent coincidència passa a ser l'actual
  marcaCerca(true);
});
$("#b-tots").addEventListener("click", () => {
  if (!trobats.length) return;
  const n = trobats.length;
  apunta(trobats.reverse().map(substitueix));       // de l'última a la primera: els índexs valen
  nota(`${n} ${n === 1 ? "canvi fet" : "canvis fets"}.`);
});
fCerca.addEventListener("submit", (e) => {          // Retorn: següent (o substitueix, des del segon camp)
  e.preventDefault();
  if (document.activeElement === fCerca.per) $("#b-substitueix").click(); else ves(1);
});
fCerca.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#b-cerca").click(); });

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

/** Fa visible un element de la llista movent només la llista, mai la pàgina. */
function ensenya(el) {
  const r = el.getBoundingClientRect(), R = llista.getBoundingClientRect();
  if (r.top < R.top) llista.scrollTop -= R.top - r.top + 8;
  else if (r.bottom > R.bottom) llista.scrollTop += r.bottom - R.bottom + 8;
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
    if (!video.paused && !llista.querySelector(".editant")) ensenya(d);
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
recalcula();

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
