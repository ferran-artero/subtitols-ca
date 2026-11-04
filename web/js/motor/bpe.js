// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Tokenitzador BPE a nivell de byte (estil GPT-2 / RoBERTa) a partir d'un tokenizer.json de
// Hugging Face. Fa el mateix que `tokenizers` amb el pre-tokenitzador ByteLevel
// (add_prefix_space, use_regex) i sense normalitzador, que és el cas dels dos puntuadors.

// Partició de GPT-2 (la mateixa expressió que fa servir ByteLevel a `tokenizers`)
const PARTEIX = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

// bytes -> caràcters "visibles" (taula bytes_to_unicode de GPT-2)
function taulaBytes() {
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const t = new Array(256);
  bs.forEach((b, i) => { t[b] = String.fromCharCode(cs[i]); });
  return t;
}
const BYTES = taulaBytes();
const utf8 = new TextEncoder();

export class TokenitzadorBPE {
  /** tj: el tokenizer.json ja llegit (objecte). */
  constructor(tj) {
    const m = tj.model;
    if (m.type !== "BPE") throw new Error(`Tokenitzador no suportat: ${m.type}`);
    this.vocab = new Map(Object.entries(m.vocab));
    this.rangs = new Map();
    m.merges.forEach((mg, i) => this.rangs.set(Array.isArray(mg) ? `${mg[0]} ${mg[1]}` : mg, i));
    this.prefix = tj.pre_tokenizer?.add_prefix_space ?? true;
    this.especials = new Map((tj.added_tokens || []).map((a) => [a.content, a.id]));
    this.cache = new Map();
  }

  idDe(t) { return this.especials.get(t) ?? this.vocab.get(t); }

  bpe(paraula) {
    let c = this.cache.get(paraula);
    if (c) return c;
    let s = [...paraula];
    while (s.length > 1) {
      let millor = -1, rang = Infinity;
      for (let i = 0; i + 1 < s.length; i++) {
        const r = this.rangs.get(`${s[i]} ${s[i + 1]}`);
        if (r !== undefined && r < rang) { rang = r; millor = i; }
      }
      if (millor < 0) break;
      const [a, b] = [s[millor], s[millor + 1]], nou = [];
      for (let i = 0; i < s.length;) {                       // fusiona totes les aparicions, d'esquerra a dreta
        if (i + 1 < s.length && s[i] === a && s[i + 1] === b) { nou.push(a + b); i += 2; } else nou.push(s[i++]);
      }
      s = nou;
    }
    c = s.map((p) => {
      const id = this.vocab.get(p);
      if (id === undefined) throw new Error(`Peça fora del vocabulari: ${p}`);
      return id;
    });
    this.cache.set(paraula, c);
    return c;
  }

  /** Com tokenizer.encode(text, add_special_tokens=False).ids */
  codifica(text) {
    if (this.prefix && !text.startsWith(" ")) text = " " + text;
    const ids = [];
    for (const tros of text.match(PARTEIX) || []) {
      const p = Array.from(utf8.encode(tros), (b) => BYTES[b]).join("");
      ids.push(...this.bpe(p));
    }
    return ids;
  }
}
