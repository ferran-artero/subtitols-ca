// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Motor complet: àudio 16 kHz -> paraules amb temps (i, si hi ha puntuador, signes i majúscules).
// Port de eines/motor_ref/motor.py; l'explicació del rescat de frases perdudes és allà.
import { roundPy } from "./comu.js";
import { aParaules } from "./paraules.js";
import { SEG_FINESTRA, SR } from "./vad.js";

const FORAT = 0.7, VEU_FRAC = 0.75, VEU_LLINDAR = 0.5, PENAL = 2.0, PENAL_MAX = 4.0, MARGE = 0.2;
const FINESTRES = [1.0, 2.0, 0.5, 3.0];

const centre = (p) => (p.ini + p.fi) / 2;
const perIni = (ps) => [...ps].sort((a, b) => a.ini - b.ini);

/** Intervals sense paraules dins de [ini, fi), de ≥ FORAT s i amb prou veu segons el VAD. */
export function forats(paraules, ini, fi, probs) {
  const temps = [ini];
  for (const p of paraules) for (const t of [p.ini, p.fi]) temps.push(Math.min(Math.max(t, ini), fi));
  temps.push(fi);
  const res = [];
  for (let k = 0; k + 1 < temps.length; k += 2) {
    const a = temps[k], b = temps[k + 1];
    if (b - a < FORAT) continue;
    const i0 = Math.trunc(a / SEG_FINESTRA), i1 = Math.trunc(b / SEG_FINESTRA);
    let veu = 0;
    for (let i = i0; i < Math.min(i1, probs.length); i++) if (probs[i] >= VEU_LLINDAR) veu++;
    if (veu * SEG_FINESTRA >= VEU_FRAC * FORAT) res.push([roundPy(a, 2), roundPy(b, 2)]);
  }
  return res;
}

/** Afegeix les paraules d'un tros; a la vora d'un tall forçat descarta els duplicats. */
export function ajunta(totes, noves) {
  if (!totes.length) { totes.push(...noves); return; }
  const ult = totes[totes.length - 1];
  for (let k = 0; k < noves.length; k++) {
    const p = noves[k];
    if (p.ini >= ult.fi) { totes.push(...noves.slice(k)); return; }
    if (p.text === ult.text) continue;
    p.ini = ult.fi;
    p.fi = roundPy(Math.max(p.fi, p.ini + 0.04), 3);
    totes.push(p);
  }
}

export class Motor {
  /** mel: Mel; vad: VAD; rnnt: RNNT; puntuador: Puntuador o null; rescat: bool. */
  constructor({ mel, vad, rnnt, puntuador = null, rescat = true }) {
    Object.assign(this, { mel, vad, rnnt, puntuador, rescat });
  }

  async enc(x) {
    const m = this.mel.calcula(x);
    return this.rnnt.encoder(m.mel, m.trames, m.valides);
  }

  async paraules(e, inici, penal = 0, des = null) {
    const r = await this.rnnt.descodifica(e, penal, des);
    return { ps: aParaules(r.ids, r.trames, this.rnnt.peces, inici, this.rnnt.segTrama), ids: r.ids, trames: r.trames, r };
  }

  /** Etapa 2: finestres curtes al voltant del forat. */
  async finestra(x, paraules, [a, b], probs) {
    const abans = paraules.filter((p) => centre(p) < a), despres = paraules.filter((p) => centre(p) >= b);
    let millor = [], usat = null;
    for (const m of FINESTRES) {
      const w0 = Math.max(0.0, a - m), w1 = Math.min(x.length / SR, b + m);
      const e = await this.enc(x.subarray(Math.trunc(w0 * SR), Math.trunc(w1 * SR)));
      for (const pen of [0.0, PENAL]) {
        let cand = (await this.paraules(e, w0, pen)).ps.filter((p) => a <= centre(p) && centre(p) < b);
        if (cand.length && abans.length && cand[0].text === abans[abans.length - 1].text && cand[0].ini < a + 0.3) cand = cand.slice(1);
        if (cand.length && despres.length && cand[cand.length - 1].text === despres[0].text && cand[cand.length - 1].fi > b - 0.3) cand = cand.slice(0, -1);
        if (!cand.length) continue;
        if (!forats(cand, a, b, probs).length) return [cand, { marge: m, penal: pen, tancat: true }];
        if (cand.length > millor.length) { millor = cand; usat = { marge: m, penal: pen, tancat: false }; }
      }
    }
    return [millor, usat];
  }

  /** Un tros del VAD: mel -> encoder -> RNNT (+ rescat). */
  async asrTros(x, tros, probs) {
    const ini = tros.ini;
    const e = await this.enc(x.subarray(Math.trunc(ini * SR), Math.trunc(tros.fi * SR)));
    const T = e.T;
    let { ps: paraules, ids, trames } = await this.paraules(e, ini);
    const zona = (ps) => forats(perIni(ps), tros.propi_ini, tros.propi_fi, probs);
    const rescat = [];
    let oberts = this.rescat ? zona(paraules) : [];
    if (oberts.length) {
      // 1. tot el tros amb penalització
      for (const f of oberts) rescat.push({ forat: [...f], penal: PENAL, abast: "tros" });
      const penal = new Float32Array(T).fill(PENAL);
      let dec;
      ({ ps: paraules, ids, trames, r: dec } = await this.paraules(e, ini, penal));
      // 2. finestres curtes
      let afegides = [];
      for (const f of zona(paraules)) {
        const [noves, usat] = await this.finestra(x, [...paraules, ...afegides], f, probs);
        rescat.push({ forat: [...f], penal: usat && usat.penal, abast: "finestra", marge: usat && usat.marge, paraules: noves.length });
        afegides = [...afegides, ...noves];
      }
      oberts = zona([...paraules, ...afegides]);
      // 3. penalització creixent només dins dels forats
      let nivell = PENAL + 1.0;
      const st = this.rnnt.segTrama;
      while (oberts.length && nivell <= PENAL_MAX + 1e-6) {
        let primera = T;                     // abans d'aquesta trama la penalització no canvia
        for (const [a, b] of oberts) {
          const i0 = Math.max(0, Math.trunc((a - MARGE - ini) / st));
          primera = Math.min(primera, i0);
          const i1 = Math.min(T, Math.trunc(Math.ceil((b + MARGE - ini) / st)));
          for (let i = i0; i < i1; i++) penal[i] = Math.max(penal[i], nivell);
          rescat.push({ forat: [a, b], penal: nivell, abast: "forat" });
        }
        let nou;
        // es continua la descodificació anterior des de la primera trama que canvia (resultat idèntic)
        ({ ps: nou, ids, trames, r: dec } = await this.paraules(e, ini, penal, { prev: dec, trama: primera }));
        const ocupat = afegides.map((p) => [p.ini, p.fi]);
        paraules = nou.filter((p) => !ocupat.some(([i, f]) => i - 0.05 < centre(p) && centre(p) < f + 0.05));
        oberts = zona([...paraules, ...afegides]);
        nivell += 1.0;
      }
      paraules = perIni([...paraules, ...afegides]);
    }
    if (tros.forcat) paraules = paraules.filter((p) => tros.propi_ini <= centre(p) && centre(p) < tros.propi_fi);
    return { ini: roundPy(ini, 3), fi: roundPy(tros.fi, 3), forcat: tros.forcat,
             propi: [roundPy(tros.propi_ini, 3), roundPy(tros.propi_fi, 3)], ids, trames, rescat, paraules };
  }

  /** x: Float32Array a 16 kHz. progres(fase, fracció, info) per a la interfície. */
  async transcriu(x, progres = () => {}) {
    const durada = x.length / SR, t0 = performance.now();
    progres("vad", 0);
    const { trossos, probs } = await this.vad.trossos(x, (f) => progres("vad", f));
    const resultats = [], paraules = [];
    for (let i = 0; i < trossos.length; i++) {
      progres("asr", i / trossos.length, trossos[i]);
      const r = await this.asrTros(x, trossos[i], probs);
      ajunta(paraules, r.paraules);
      delete r.paraules;
      resultats.push(r);
    }
    progres("asr", 1);
    if (this.puntuador && paraules.length) {
      progres("puntuacio", 0);
      const res = await this.puntuador.puntua(paraules.map((p) => p.text));
      paraules.forEach((p, k) => { p.cru = p.text; [p.text, p.punt] = res[k]; });
    }
    const total = (performance.now() - t0) / 1000;
    return { durada_s: roundPy(durada, 3), text: paraules.map((p) => p.text + (p.punt || "")).join(" "),
             paraules, trossos: resultats, temps: { total: roundPy(total, 3), rtf: durada ? roundPy(total / durada, 4) : null } };
  }
}
