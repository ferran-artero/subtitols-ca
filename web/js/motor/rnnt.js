// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Encoder + descodificació RNNT greedy. Port de eines/motor_ref/rnnt.py:
//   encoder:       mel [1, 80, T] + llargada  ->  [1, 512, T'] (una trama cada 40 ms)
//   decoder_joint: trama [1, 512, 1], últim token [1, 1], llargada [1], estats [1, 1, 640] ×2
//                  -> logits [1, 1, 1, 257] + estats nous
// Per a cada trama (com a molt max_simbols vegades): k = argmax(logits - penal al blank);
// si k és el blank, trama següent (sense tocar l'últim token ni els estats); si no, s'emet.

export class RNNT {
  /** enc, dec: ort.InferenceSession; cfg: config.json; peces: línies de tokens.txt. */
  constructor(ort, enc, dec, cfg, peces) {
    this.ort = ort;
    this.enc = enc;
    this.dec = dec;
    this.blank = cfg.blank_id;
    this.maxSimbols = cfg.max_symbols_per_step ?? 10;
    this.segTrama = cfg.segons_per_instant ?? 0.04;
    this.peces = peces.slice(0, this.blank).map((p) => p.replace(/\r$/, ""));   // tokens.txt pot tindre \r\n
    this.crides = 0;                                   // estadístiques: crides al decoder_joint,
    this.tEnc = 0;                                     // ms a l'encoder i al bucle
    this.tDec = 0;
  }

  /** mel: Float32Array [80 × trames] -> {enc: Float32Array [512 × T], T, D}. */
  async encoder(mel, trames, valides) {
    const { Tensor } = this.ort;
    const t0 = performance.now();
    const [nA, nL] = this.enc.inputNames;
    const out = await this.enc.run({
      [nA]: new Tensor("float32", mel, [1, mel.length / trames, trames]),
      [nL]: new Tensor("int64", BigInt64Array.from([BigInt(valides)]), [1]),
    });
    const [o, l] = this.enc.outputNames;
    const D = out[o].dims[1], Tt = out[o].dims[2];
    this.tEnc += performance.now() - t0;
    return { enc: out[o].data, T: Number(out[l].data[0]), D, Tt };
  }

  /** penal: número o Float32Array amb un valor per trama (es resta al logit del blank). */
  async descodifica({ enc, T, D, Tt }, penal = 0) {
    const { Tensor } = this.ort;
    const [nE, nT, nL, nS1, nS2] = this.dec.inputNames;
    const [nO, , nO1, nO2] = this.dec.outputNames;
    const pt = typeof penal === "number" ? () => penal : (t) => penal[t];
    const t0 = performance.now();
    let s1 = new Tensor("float32", new Float32Array(640), [1, 1, 640]);
    let s2 = new Tensor("float32", new Float32Array(640), [1, 1, 640]);
    let ultim = this.blank;
    const lon = new Tensor("int32", Int32Array.from([1]), [1]);
    const ids = [], trames = [];
    const f = new Float32Array(D);
    for (let t = 0; t < T; t++) {
      for (let d = 0; d < D; d++) f[d] = enc[d * Tt + t];               // columna t de [D, T']
      const ft = new Tensor("float32", f.slice(), [1, D, 1]);
      const p = Math.fround(pt(t));
      for (let s = 0; s < this.maxSimbols; s++) {
        const out = await this.dec.run({
          [nE]: ft, [nT]: new Tensor("int32", Int32Array.from([ultim]), [1, 1]), [nL]: lon, [nS1]: s1, [nS2]: s2,
        });
        this.crides++;
        const lg = out[nO].data;
        let k = 0, millor = -Infinity;
        for (let i = 0; i < lg.length; i++) {
          const v = i === this.blank ? Math.fround(lg[i] - p) : lg[i];
          if (v > millor) { millor = v; k = i; }
        }
        if (k === this.blank) break;
        ids.push(k);
        trames.push(t);
        ultim = k;
        s1 = out[nO1];
        s2 = out[nO2];
      }
    }
    this.tDec += performance.now() - t0;
    return { ids, trames };
  }
}
