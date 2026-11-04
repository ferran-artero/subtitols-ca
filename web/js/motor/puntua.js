// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Puntuació (Softcatalà) + majúscules (UMU). Port de eines/motor_ref/puntua.py: finestres de
// 120 paraules que avancen de 100 en 100; ids = [<s>] + tokens(" paraula")… + [</s>]; de cada
// paraula s'agafa l'etiqueta del primer token. Els signes són de Softcatalà; de la UMU, només les
// majúscules de dins de frase (i dels noms que la UMU escriu en majúscula a mig de frase).
import { TokenitzadorBPE } from "./bpe.js";

const FINAL_FRASE = new Set([".", "?", "!"]);
const SIGNES = ",.?!:;";

export function finestres(n, mida = 120, solap = 20) {
  if (n <= mida) return [[0, n, 0, n]];
  const pas = mida - solap, vora = Math.floor(solap / 2);
  const inicis = [];
  for (let s = 0; s < n - mida; s += pas) inicis.push(s);
  inicis.push(n - mida);
  const res = [];
  inicis.forEach((s, k) => {
    const desDe = k === 0 ? 0 : res[res.length - 1][3];
    const finsA = k === inicis.length - 1 ? n : s + mida - vora;
    res.push([s, s + mida, desDe, finsA]);
  });
  return res;
}

/** '?u' -> ['?', true]; 'l' -> [null, false]; '.' -> ['.', null]; '0' -> [null, null] */
export function etiqueta(et) {
  const punt = [...et].find((c) => SIGNES.includes(c)) ?? null;
  const maj = et.endsWith("u") ? true : et.endsWith("l") ? false : null;
  return [punt, maj];
}

export class ModelEtiquetes {
  /** sessio: ort.InferenceSession; tokenitzador: tokenizer.json (objecte); config: config.json. */
  constructor(ort, sessio, tokenitzador, config) {
    this.ort = ort;
    this.s = sessio;
    this.tok = new TokenitzadorBPE(tokenitzador);
    this.etiquetes = Object.entries(config.id2label).map(([i, l]) => [Number(i), etiqueta(l)])
      .sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    this.inici = this.tok.idDe("<s>");
    this.final = this.tok.idDe("</s>");
  }

  codifica(paraules) {
    const ids = [this.inici], primers = [];
    for (const w of paraules) { primers.push(ids.length); ids.push(...this.tok.codifica(" " + w)); }
    ids.push(this.final);
    return [ids, primers];
  }

  async prediu(paraules) {
    const { Tensor } = this.ort;
    const punts = new Array(paraules.length).fill(null), majs = new Array(paraules.length).fill(null);
    for (const [ini, fi, desDe, finsA] of finestres(paraules.length)) {
      let [ids, primers] = this.codifica(paraules.slice(ini, fi));
      ids = ids.slice(0, 512);
      const L = ids.length, forma = [1, L];
      const feed = {
        input_ids: new Tensor("int64", BigInt64Array.from(ids, BigInt), forma),
        attention_mask: new Tensor("int64", new BigInt64Array(L).fill(1n), forma),
        token_type_ids: new Tensor("int64", new BigInt64Array(L), forma),
      };
      const out = await this.s.run(Object.fromEntries(this.s.inputNames.map((k) => [k, feed[k]])));
      const lg = out[this.s.outputNames[0]].data, C = this.etiquetes.length;
      primers.forEach((pos, k) => {
        if (desDe <= ini + k && ini + k < finsA && pos < L - 1) {
          let millor = 0;
          for (let c = 1; c < C; c++) if (lg[pos * C + c] > lg[pos * C + millor]) millor = c;
          [punts[ini + k], majs[ini + k]] = this.etiquetes[millor];
        }
      });
    }
    return [punts, majs];
  }
}

export function capitalitza(w) {
  const cs = [...w];
  const i = cs.findIndex((c) => /\p{L}/u.test(c));
  if (i < 0) return w;
  cs[i] = cs[i].toUpperCase();
  return cs.join("");
}

export class Puntuador {
  constructor(signes, majuscules) {
    this.signes = signes;
    this.majuscules = majuscules;
  }

  /** Per a cada paraula: [text amb majúscules, signe darrere o null]. */
  async puntua(paraules) {
    if (!paraules.length) return [];
    const [punts] = await this.signes.prediu(paraules);
    const [puntsM, majsM] = await this.majuscules.prediu(paraules);
    const iniciUmu = paraules.map((_, i) => i === 0 || FINAL_FRASE.has(puntsM[i - 1]));
    const fiables = new Set(paraules.filter((w, i) => majsM[i] && !iniciUmu[i]).map((w) => w.toLowerCase()));
    const res = [];
    let inici = true;
    paraules.forEach((w, i) => {
      const m = !!majsM[i] && (!iniciUmu[i] || fiables.has(w.toLowerCase()));
      res.push([m || inici ? capitalitza(w) : w, punts[i]]);
      inici = FINAL_FRASE.has(punts[i]);
    });
    const [w, p] = res[res.length - 1];
    if (p === null || !".?!:;".includes(p)) res[res.length - 1] = [w, "."];
    return res;
  }
}
