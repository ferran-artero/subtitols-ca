// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Segmentació de subtítols: paraules del motor ({text, ini, fi, punt}) -> SRT / VTT / TXT.
// Port línia a línia de eines/motor_ref/subtitols.py: ha de donar exactament el mateix resultat
// (es comprova amb eines/proves/compara_subtitols.mjs). Explicació dels paràmetres i de
// l'algorisme: vegeu el fitxer de Python.

const FINAL = new Set([".", "?", "!", "…"]);
const FEBLE = new Set([",", ":", ";", "-"]);

// Paraules després de les quals no s'ha de tallar (inclou l'article salat balear).
const FUNCIONALS = new Set(`
el la els les lo los l un una uns unes es sa ses so s en na n
de del dels d a al als ab amb per pel pels pera sense sobre sota fins cap contra entre segons
des dins devers vers envers davant darrere damunt devall baix
i o ni però que perquè si com quan on mentre doncs ja ben molt més menys tan tant
em et es ens us li hi ho me te se mos vos
meu meva teu teva seu seva nostre nostra vostre vostra mon ma ton ta son sa mos tos sos
aquest aquesta aquests aquestes aquell aquella aquells aquelles este esta estos estes
aqueix aqueixa cada tot tota tots totes altre altra altres qualque qualsevol alguns algunes
no és era va van vaig vam vau varen ha han he hem heu havia hauria pot poden
`.split(/\s+/).filter(Boolean));

const NUMERALS = new Set(`
zero u un una dos dues tres quatre cinc sis set vuit nou deu onze dotze tretze catorze quinze
setze disset desset dèsset divuit devuit dinou dènou dinòu vint trenta quaranta cinquanta seixanta
setanta vuitanta huitanta noranta cent cents centes mil milió milions bilió bilions i
`.split(/\s+/).filter(Boolean));

export const PER_DEFECTE = Object.freeze({
  max_car: 42, max_linies: 2, max_paraules: 0, max_cps: 17.0,
  durada_min: 1.0, durada_max: 7.0, separacio: 0.08, enganxa: 0.5, cua: 0.3, pausa: 0.5,
  desfas: 0.0,
  ressalta: "",          // "", "paraula", "progres", "acumula"
  subratlla: false, negreta: false, cursiva: false, color: "", fons: "",
  marca: null,           // [obre, tanca], p. ex. ["<b>", "</b>"]
});

export const PERFILS = Object.freeze({
  horitzontal: { ...PER_DEFECTE },
  vertical: { ...PER_DEFECTE, max_car: 22, max_linies: 1, max_cps: 22.0, durada_min: 0.5,
              durada_max: 3.0, separacio: 0.0, enganxa: 1.0, cua: 0.2 },
  accessibilitat: { ...PER_DEFECTE, max_car: 37, max_linies: 2, max_cps: 13.0, durada_min: 1.5,
                    durada_max: 7.0, enganxa: 0.8, cua: 0.6 },
});

/** Perfil predefinit amb els canvis indicats (els null/undefined s'ignoren). */
export function params(perfil = "horitzontal", canvis = {}) {
  const P = { ...PERFILS[perfil] };
  for (const [k, v] of Object.entries(canvis)) if (v !== null && v !== undefined) P[k] = v;
  return P;
}

// ---------------------------------------------------------------- utilitats

const forma = (p) => p.text + (p.punt || "");
const llarg = (s) => [...s].length;                    // caràcters (com len() de Python)

function strip(s, chars) {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

export function nu(p) {
  const t = strip(p.text.toLowerCase(), "'’-").split("'");
  return t[t.length - 1].split("’").pop();
}

export function esFuncional(p) {
  return !p.punt && (FUNCIONALS.has(nu(p)) || p.text.endsWith("'") || p.text.endsWith("’"));
}

function esNumeral(p) {
  const t = p.text.toLowerCase();
  return /^\d+$/.test(t.replaceAll(",", "").replaceAll(".", "")) ||
    (t !== "i" && t.split("-").every((x) => NUMERALS.has(x)));
}

const esMajuscula = (c) => c !== undefined && c !== c.toLowerCase() && c === c.toUpperCase();

/** p i seg formen una unitat que no s'ha de partir: un número o un nom propi. */
function unitat(p, seg) {
  if (p.punt) return false;
  if (esNumeral(p) && (esNumeral(seg) || seg.text.toLowerCase() === "i")) return true;
  return esMajuscula([...p.text][0]) && esMajuscula([...seg.text][0]);
}

/** Cost de tallar (subtítol o línia) just després de la paraula p. */
function costTall(p, seg, P) {
  if (!seg) return 0.0;
  const punt = p.punt || "";
  let c = FINAL.has(punt) ? 0.0 : FEBLE.has(punt) ? 0.6 : 2.0;
  if (esFuncional(p)) c += 3.0;
  else if (unitat(p, seg)) c += 2.5;
  const pausa = seg.ini - p.fi;
  c -= 1.5 * Math.min(Math.max(pausa, 0.0) / P.pausa, 1.0);
  return c;
}

// ---------------------------------------------------------------- línies

/** Reparteix les paraules d'un subtítol en línies: [línies, cost] o null si no cap. */
export function linies(ws, P, L = null) {
  L = L || ws.map((p) => llarg(forma(p)));
  const total = L.reduce((a, b) => a + b, 0) + L.length - 1;
  if (total <= P.max_car) return [[ws], 0.0];
  if (P.max_linies < 2) return ws.length === 1 ? [[ws], 50.0] : null;
  let millor = null;
  let ll = 0;
  for (let k = 1; k < ws.length; k++) {
    ll += L[k - 1] + (k > 1 ? 1 : 0);
    const l1 = ll, l2 = total - ll - 1;
    if (l1 > P.max_car || l2 > P.max_car) continue;
    let c = costTall(ws[k - 1], ws[k], P) + 1.5 * Math.abs(l1 - l2) / P.max_car;
    if (l1 > l2) c += 0.2 * (l1 - l2) / P.max_car;
    if (millor === null || c < millor[1]) millor = [[ws.slice(0, k), ws.slice(k)], c];
  }
  if (millor === null && ws.length === 1) return [[ws], 50.0];
  return millor;
}

// ---------------------------------------------------------------- segmentació

function costSubtitol(ws, seguent, P, L) {
  const lin = linies(ws, P, L);
  if (lin === null) return null;
  const [parts, cLin] = lin;
  const parla = ws[ws.length - 1].fi - ws[0].ini;
  if (ws.length > 1 && parla > P.durada_max) return null;
  let c = 1.0 + cLin;
  c += costTall(ws[ws.length - 1], seguent, P);
  for (let k = 0; k + 1 < ws.length; k++) {
    const a = ws[k], b = ws[k + 1];
    if (FINAL.has(a.punt || "")) c += 1.2;
    if (b.ini - a.fi >= P.pausa) c += 1.5;
  }
  const car = L.reduce((a, b) => a + b, 0) + L.length - 1;
  const curt = 0.35 * P.max_car * P.max_linies;
  if (car < curt && !ws[ws.length - 1].punt && seguent) c += 1.0 * (curt - car) / curt;
  let pantalla = Math.max(parla + P.cua, 0.3);
  if (seguent) pantalla = Math.min(pantalla, Math.max(seguent.ini - ws[0].ini, 0.3));
  const cps = car / pantalla;
  if (cps > P.max_cps) c += 0.4 * (cps - P.max_cps);
  if (pantalla < P.durada_min && seguent) c += 1.0 * (P.durada_min - pantalla) / P.durada_min;
  return [c, parts];
}

/** Paraules -> subtítols [{ini, fi, linies: [[paraula…]…], paraules}]. */
export function segmenta(paraules, P) {
  const n = paraules.length;
  if (n === 0) return [];
  const L = paraules.map((p) => llarg(forma(p)));
  const millor = new Array(n + 1).fill(Infinity);
  const tria = new Array(n + 1).fill(null);
  millor[0] = 0.0;
  for (let i = 0; i < n; i++) {
    if (millor[i] === Infinity) continue;
    let car = -1;
    for (let j = i + 1; j <= n; j++) {
      car += L[j - 1] + 1;
      if (j - i > 1 && (car > P.max_car * P.max_linies || (P.max_paraules && j - i > P.max_paraules) ||
                        paraules[j - 1].fi - paraules[i].ini > P.durada_max)) break;
      const r = costSubtitol(paraules.slice(i, j), j < n ? paraules[j] : null, P, L.slice(i, j));
      if (r === null) continue;
      const c = millor[i] + r[0];
      if (c < millor[j]) { millor[j] = c; tria[j] = [i, r[1]]; }
    }
  }
  const trossos = [];
  for (let j = n; j > 0;) {
    const [i, parts] = tria[j];
    trossos.push([i, j, parts]);
    j = i;
  }
  trossos.reverse();
  const cues = trossos.map(([i, j, parts]) => {
    const ws = paraules.slice(i, j);
    return { ini: ws[0].ini + P.desfas, fi: ws[ws.length - 1].fi + P.desfas, linies: parts, paraules: ws };
  });
  return temps(cues, P);
}

/** Ajusta l'inici i la fi de cada subtítol (cua, durada mínima, enganxa, separació). */
export function temps(cues, P) {
  cues.forEach((c, k) => {
    c.ini = Math.max(c.ini, 0.0);
    let fi = Math.max(c.fi + P.cua, c.ini + P.durada_min);
    if (k + 1 < cues.length) {
      const seg = Math.max(cues[k + 1].ini, 0.0);
      if (seg - fi < P.enganxa) fi = seg - P.separacio;
      fi = Math.min(fi, seg - P.separacio);
    }
    c.fi = Math.max(fi, c.ini + 0.04);
  });
  return cues;
}

// ---------------------------------------------------------------- ressaltat

export const COLORS = Object.freeze({
  groc: "#FFFF00", verd: "#00E676", roig: "#FF3B30", vermell: "#FF3B30", blau: "#2F9BFF",
  cian: "#00FFFF", taronja: "#FF9500", rosa: "#FF4FC3", lila: "#B266FF", blanc: "#FFFFFF",
  negre: "#000000",
});

/** Nom o codi de color -> "#RRGGBB" ("" si no n'hi ha). */
export function colorHex(c) {
  if (!c) return "";
  c = COLORS[c.trim().toLowerCase()] || c.trim();
  if (!c.startsWith("#")) c = "#" + c;
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
    throw new Error(`Color no vàlid: ${c} (usa #RRGGBB o ${Object.keys(COLORS).join(", ")})`);
  }
  return c.toUpperCase();
}

const ambEstil = (P) => !!(P.marca || P.subratlla || P.negreta || P.cursiva || P.color || P.fons);

/** Etiquetes d'obrir i tancar per a una paraula marcada. */
export function etiquetes(P, fmt = "srt") {
  if (P.marca) return P.marca;
  if (!ambEstil(P)) P = { ...P, subratlla: true };
  const obre = [];
  if (P.negreta) obre.push("b");
  if (P.cursiva) obre.push("i");
  if (P.subratlla) obre.push("u");
  let a = obre.map((x) => `<${x}>`).join("");
  let z = [...obre].reverse().map((x) => `</${x}>`).join("");
  if (fmt === "srt" && P.color) { a += `<font color="${colorHex(P.color)}">`; z = "</font>" + z; }
  if (fmt === "vtt" && (P.color || P.fons)) { a += "<c.r>"; z = "</c>" + z; }
  return [a, z];
}

export function avisos(P, fmt) {
  const res = [];
  if (P.ressalta && P.fons && !P.marca && fmt === "srt") {
    res.push("El SRT no admet color de fons: el fons només s'aplica al VTT.");
  }
  return res;
}

/** Text d'un subtítol. marcades: índexs ressaltats; fins: només fins a aquesta paraula. */
export function text(c, marcades = new Set(), fins = null, P = null, fmt = "srt") {
  const [a, z] = marcades.size ? etiquetes(P, fmt) : ["", ""];
  const res = [];
  let k = 0;
  for (const lin of c.linies) {
    let out = "", dins = false;
    for (const p of lin) {
      if (fins !== null && k > fins) { k++; continue; }
      const m = marcades.has(k);
      if (m && !dins) out += (out ? " " : "") + a;
      else if (dins && !m) out += z + " ";
      else if (out) out += " ";
      out += forma(p);
      dins = m;
      k++;
    }
    if (dins) out += z;
    if (out) res.push(out);
  }
  return res.join("\n");
}

/** Subtítols finals: un per subtítol o, amb el ressaltat, un per paraula. */
export function expandeix(cues, P) {
  const res = [];
  for (const c of cues) {
    const ws = c.paraules;
    if (!P.ressalta) {
      res.push({ ini: c.ini, fi: c.fi, cue: c, marcades: new Set(), fins: null });
      continue;
    }
    ws.forEach((p, k) => {
      const ini = k === 0 ? c.ini : Math.max(p.ini + P.desfas, res[res.length - 1].ini + 0.04);
      let fi = k === ws.length - 1 ? c.fi : ws[k + 1].ini + P.desfas;
      fi = Math.min(Math.max(fi, ini + 0.04), c.fi);
      let marc, fins = null;
      if (P.ressalta === "paraula") marc = new Set([k]);
      else if (P.ressalta === "progres") marc = new Set(Array.from({ length: k + 1 }, (_, i) => i));
      else { marc = ambEstil(P) ? new Set([k]) : new Set(); fins = k; }   // acumula
      res.push({ ini, fi, cue: c, marcades: marc, fins });
    });
  }
  return res;
}

export function subtitols(paraules, P = PERFILS.horitzontal) {
  return expandeix(segmenta(paraules, P), P);
}

// ---------------------------------------------------------------- escriptura

// round() de Python: arrodoneix els empats al parell (banker's rounding)
function roundPy(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function hora(s, sep) {
  let ms = roundPy(Math.max(s, 0) * 1000);
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const ss = Math.floor(ms / 1000); ms -= ss * 1000;
  const d2 = (x) => String(x).padStart(2, "0");
  return `${d2(h)}:${d2(m)}:${d2(ss)}${sep}${String(ms).padStart(3, "0")}`;
}

export function srt(cues, P = PER_DEFECTE) {
  return cues.map((c, i) =>
    `${i + 1}\n${hora(c.ini, ",")} --> ${hora(c.fi, ",")}\n${text(c.cue, c.marcades, c.fins, P, "srt")}\n`).join("\n");
}

export function vtt(cues, P = PER_DEFECTE) {
  let cap = "WEBVTT\n\n";
  if (P.ressalta && !P.marca && (P.color || P.fons)) {
    const css = (P.color ? `color: ${colorHex(P.color)}; ` : "") +
                (P.fons ? `background-color: ${colorHex(P.fons)}; ` : "");
    cap += "STYLE\n::cue(.r) { " + css + "}\n\n";
  }
  return cap + cues.map((c) =>
    `${hora(c.ini, ".")} --> ${hora(c.fi, ".")}\n${text(c.cue, c.marcades, c.fins, P, "vtt")}\n`).join("\n");
}

export function txt(paraules) {
  return paraules.map(forma).join(" ") + "\n";
}
