// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Detecció de veu (Silero VAD v5) i tall en trossos per a l'ASR. Port de eines/motor_ref/vad.py
// (l'explicació de cada pas és allà). `ort` és onnxruntime-web, que es passa des de fora perquè
// el mateix codi funcione al navegador i a Node (proves).

export const SR = 16000;
const FINESTRA = 512, CONTEXT = 64;
export const SEG_FINESTRA = FINESTRA / SR;       // 0,032 s

export const PARAMS_VAD = Object.freeze({
  llindar: 0.5, silenci_min: 0.30, veu_min: 0.25, marge: 0.20, max_tros: 25.0,
  ajunta_si_silenci: 2.0, solap: 1.0, extensio: 0.5,
});

export class VAD {
  /** sessio: ort.InferenceSession de silero_vad.onnx */
  constructor(ort, sessio, params = PARAMS_VAD) {
    this.ort = ort;
    this.s = sessio;
    this.p = params;
  }

  /** Una probabilitat de veu per finestra de 512 mostres (Float32Array). */
  async probabilitats(x, progres) {
    const { Tensor } = this.ort;
    const n = Math.ceil(x.length / FINESTRA);
    const probs = new Float32Array(n);
    let estat = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    const sr = new Tensor("int64", BigInt64Array.from([BigInt(SR)]), []);
    const entrada = new Float32Array(CONTEXT + FINESTRA);          // [context | finestra]
    for (let i = 0; i < n; i++) {
      entrada.copyWithin(0, FINESTRA, FINESTRA + CONTEXT);           // context = 64 últimes de l'anterior
      entrada.fill(0, CONTEXT);
      entrada.set(x.subarray(i * FINESTRA, Math.min((i + 1) * FINESTRA, x.length)), CONTEXT);
      const out = await this.s.run({ input: new Tensor("float32", entrada.slice(), [1, CONTEXT + FINESTRA]), state: estat, sr });
      probs[i] = out.output.data[0];
      estat = out.stateN;
      if (progres && i % 500 === 0) progres(i / n);
    }
    return probs;
  }

  segments(probs, durada) {
    const p = this.p, baix = Math.max(p.llindar - 0.15, 0.01);
    let segs = [], inici = null, silenciDesDe = null;
    for (let i = 0; i < probs.length; i++) {
      const pr = probs[i], t = i * SEG_FINESTRA;
      if (inici === null) {
        if (pr >= p.llindar) { inici = t; silenciDesDe = null; }
      } else if (pr < baix) {
        if (silenciDesDe === null) silenciDesDe = t;
        if (t + SEG_FINESTRA - silenciDesDe >= p.silenci_min) { segs.push([inici, silenciDesDe]); inici = null; silenciDesDe = null; }
      } else silenciDesDe = null;
    }
    if (inici !== null) segs.push([inici, probs.length * SEG_FINESTRA]);
    segs = segs.filter(([a, b]) => b - a >= p.veu_min);
    const ambMarge = [];
    for (let [a, b] of segs) {
      a = Math.max(0.0, a - p.marge); b = Math.min(durada, b + p.marge);
      const u = ambMarge[ambMarge.length - 1];
      if (u && a <= u[1]) u[1] = Math.max(b, u[1]);
      else ambMarge.push([a, b]);
    }
    return ambMarge;
  }

  /** Talla un segment més llarg que max_tros pel punt de probabilitat mínima (60-100 %). */
  parteix(a, b, probs) {
    const p = this.p, trossos = [];
    while (b - a > p.max_tros) {
      const i0 = Math.trunc((a + 0.6 * p.max_tros) / SEG_FINESTRA);
      const i1 = Math.trunc((a + p.max_tros) / SEG_FINESTRA);
      let i = i1;
      if (i1 > i0) {
        i = i0;
        for (let k = i0 + 1; k < Math.min(i1, probs.length); k++) if (probs[k] < probs[i]) i = k;
      }
      const tall = i * SEG_FINESTRA;
      trossos.push([a, tall]);
      a = tall;
    }
    trossos.push([a, b]);
    return trossos;
  }

  /** Trossos per a l'ASR: {trossos: [{ini, fi, propi_ini, propi_fi, forcat}], probs}. */
  async trossos(x, progres) {
    const durada = x.length / SR;
    const probs = await this.probabilitats(x, progres);
    const res = [];
    for (const [a, b] of this.segments(probs, durada)) {
      const peces = this.parteix(a, b, probs);
      if (peces.length === 1) {
        const u = res[res.length - 1];
        if (u && !u.forcat && a - u.fi <= this.p.ajunta_si_silenci && b - u.ini <= this.p.max_tros) {
          u.fi = u.propi_fi = b;
        } else res.push({ ini: a, fi: b, propi_ini: a, propi_fi: b, forcat: false });
        continue;
      }
      peces.forEach(([c, d], k) => res.push({
        ini: k === 0 ? c : Math.max(a, c - this.p.solap),
        fi: k === peces.length - 1 ? d : Math.min(b, d + this.p.solap),
        propi_ini: c, propi_fi: d, forcat: true,
      }));
    }
    return { trossos: this.amplia(res, durada), probs };
  }

  /** Allarga les vores exteriors de cada tros dins del silenci (fins a la meitat del silenci). */
  amplia(res, durada) {
    const ext = this.p.extensio;
    if (ext <= 0) return res;
    const orig = res.map((t) => [t.ini, t.fi]);
    res.forEach((t, i) => {
      const contAnt = i > 0 && res[i - 1].forcat && t.forcat && Math.abs(res[i - 1].propi_fi - t.propi_ini) < 1e-9;
      const contSeg = i + 1 < res.length && res[i + 1].forcat && t.forcat && Math.abs(t.propi_fi - res[i + 1].propi_ini) < 1e-9;
      if (!contAnt) {
        const limit = i > 0 ? (orig[i - 1][1] + orig[i][0]) / 2 : 0.0;
        t.ini = t.propi_ini = Math.max(limit, orig[i][0] - ext);
      }
      if (!contSeg) {
        const limit = i + 1 < res.length ? (orig[i][1] + orig[i + 1][0]) / 2 : durada;
        t.fi = t.propi_fi = Math.min(limit, orig[i][1] + ext);
      }
    });
    return res;
  }
}
