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

  /** mel: Float32Array [80 × trames] -> {enc: Float32Array [T' × 512] (una fila per trama), T, D}. */
  async encoder(mel, trames, valides) {
    const { Tensor } = this.ort;
    const t0 = performance.now();
    const [nA, nL] = this.enc.inputNames;
    const out = await this.enc.run({
      [nA]: new Tensor("float32", mel, [1, mel.length / trames, trames]),
      [nL]: new Tensor("int64", BigInt64Array.from([BigInt(valides)]), [1]),
    });
    const [o, l] = this.enc.outputNames;
    const D = out[o].dims[1], Tt = out[o].dims[2], src = out[o].data;
    // [D, T'] -> [T', D]: cada trama queda contigua i el bucle la passa sense còpies
    const enc = new Float32Array(D * Tt);
    for (let d = 0; d < D; d++) for (let t = 0, i = d * Tt; t < Tt; t++, i++) enc[t * D + d] = src[i];
    this.tEnc += performance.now() - t0;
    return { enc, T: Number(out[l].data[0]), D, Tt };
  }

  /**
   * penal: número o Float32Array amb un valor per trama (es resta al logit del blank).
   * des: {prev, trama}: continua una descodificació anterior a partir de la trama indicada.
   * Com que la descodificació greedy només depén de les trames anteriors, el resultat és
   * idèntic al de començar de zero sempre que la penalització no haja canviat abans d'aquella trama.
   * Torna {ids, trames, punts}; punts[t] = estat a l'inici de la trama t (per a continuar-la).
   */
  async descodifica({ enc, T, D }, penal = 0, des = null) {
    const { Tensor } = this.ort;
    const [nE, nT, nL, nS1, nS2] = this.dec.inputNames;
    const [nO, , nO1, nO2] = this.dec.outputNames;
    const pt = typeof penal === "number" ? () => penal : (t) => penal[t];
    const t0 = performance.now();
    let s1, s2, ultim, ids, trames, punts, inici = 0;
    if (des && des.trama > 0 && des.trama < T) {
      inici = des.trama;
      const p = des.prev.punts[inici];
      [s1, s2, ultim] = [p.s1, p.s2, p.ultim];
      ids = des.prev.ids.slice(0, p.n);
      trames = des.prev.trames.slice(0, p.n);
      punts = des.prev.punts.slice(0, inici);
    } else {
      s1 = new Tensor("float32", new Float32Array(640), [1, 1, 640]);
      s2 = new Tensor("float32", new Float32Array(640), [1, 1, 640]);
      ultim = this.blank;
      ids = []; trames = []; punts = [];
    }
    const lon = new Tensor("int32", Int32Array.from([1]), [1]);
    const tg = new Int32Array(1), tgT = new Tensor("int32", tg, [1, 1]);   // es reutilitza: ort en copia les dades a cada crida
    const ent = { [nT]: tgT, [nL]: lon };
    for (let t = inici; t < T; t++) {
      punts.push({ n: ids.length, ultim, s1, s2 });
      ent[nE] = new Tensor("float32", enc.subarray(t * D, (t + 1) * D), [1, D, 1]);
      const p = Math.fround(pt(t));
      for (let s = 0; s < this.maxSimbols; s++) {
        tg[0] = ultim;
        ent[nS1] = s1;
        ent[nS2] = s2;
        const out = await this.dec.run(ent);
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
    return { ids, trames, punts };
  }
}
