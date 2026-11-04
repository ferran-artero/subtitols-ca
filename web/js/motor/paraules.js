// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Tokens -> paraules amb temps. Port de eines/motor_ref/paraules.py (l'explicació és allà):
// cada peça que comença per "▁" obri paraula; inici = trama del primer token, fi = darrer + 1;
// s'ajunten les elisions ("l'" + "actor") i es reparen les lletres soltes ("l hotel" -> "l'hotel").
import { roundPy } from "./comu.js";

const ELISIO = ["'", "’", "-"];
const SOLES = new Set(["l", "d", "m", "t", "s", "n"]);
const ENCLITICS = new Set(["l", "m", "t", "s", "n"]);
const NO_APOSTROFEN = new Set(["a", "i", "o", "u", "e"]);
const INICI_VOCAL = [..."aeiouàèéíïòóúüh"];
const FINAL_VOCAL = [..."aeiouàèéíïòóúü"];
const comenca = (w, xs) => xs.some((c) => w.startsWith(c));
const acaba = (w, xs) => xs.some((c) => w.endsWith(c));

/** Paraules -> [text, primera, última] amb les elisions refetes. */
export function agrupaElisions(textos) {
  const res = [];
  let i = 0;
  while (i < textos.length) {
    const w = textos[i];
    if (SOLES.has(w) && i + 1 < textos.length && comenca(textos[i + 1], INICI_VOCAL) && !NO_APOSTROFEN.has(textos[i + 1])) {
      res.push([`${w}'${textos[i + 1]}`, i, i + 1]);
      i += 2;
      continue;
    }
    if (ENCLITICS.has(w) && res.length && acaba(res[res.length - 1][0], FINAL_VOCAL)) {
      const [t, a] = res[res.length - 1];
      res[res.length - 1] = [`${t}'${w}`, a, i];
      i++;
      continue;
    }
    res.push([w, i, i]);
    i++;
  }
  return res;
}

/** Com neteja() de Python: minúscules, sense signes, apòstrofs i l·l unificats. */
export function neteja(w) {
  let t = w.normalize("NFC").toLowerCase();
  t = t.replaceAll("’", "'").replaceAll("‘", "'").replaceAll("`", "'").replaceAll("´", "'");
  t = t.replaceAll("ŀl", "l·l").replaceAll("l.l", "l·l").replaceAll("l•l", "l·l").replaceAll("l∙l", "l·l");
  t = t.replace(/[^\p{L}\p{N}_\s'·-]/gu, " ");
  t = t.replace(/(?<![\p{L}\p{N}_])['-]|['-](?![\p{L}\p{N}_])/gu, " ");
  t = t.replace(/(?<!l)·|·(?!l)/gu, " ");
  return t.replace(/\s+/gu, " ").trim();
}

export function aParaules(ids, trames, peces, iniciTros, segTrama) {
  const brutes = [];                               // [text, primera trama, última trama]
  ids.forEach((id, k) => {
    const p = peces[id], t = trames[k];
    if (p === "<unk>") return;
    if (p.startsWith("▁") || !brutes.length) brutes.push([p.replace(/^▁+/, ""), t, t]);
    else { const b = brutes[brutes.length - 1]; b[0] += p; b[2] = t; }
  });
  const unides = [];
  for (const b of brutes) {
    const u = unides[unides.length - 1];
    if (u && b[0] && u[0] && (acaba(u[0], ELISIO) || comenca(b[0], ELISIO))) { u[0] += b[0]; u[2] = b[2]; }
    else unides.push(b);
  }
  const netes = [];
  for (const [text, t0, t1] of unides) for (const w of neteja(text).split(" ").filter(Boolean)) netes.push([w, t0, t1]);
  return agrupaElisions(netes.map((n) => n[0])).map(([text, a, b]) => ({
    text,
    ini: roundPy(iniciTros + netes[a][1] * segTrama, 3),
    fi: roundPy(iniciTros + (netes[b][2] + 1) * segTrama, 3),
  }));
}
