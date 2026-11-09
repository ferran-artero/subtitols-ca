// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Llista d'edició (edts/elst) de la pista d'àudio d'un MP4/MOV. Els codificadors AAC posen unes
// mostres inicials de "preparació" (priming) i la llista d'edició diu al reproductor que se les
// salte. ffmpeg (i el <video>) la respecten; decodeAudioData de Chrome no: sense corregir-ho, els
// subtítols van uns 0,1 s tard respecte al vídeo.

function caixes(dv, ini, fi) {
  const res = [];
  for (let p = ini; p + 8 <= fi;) {
    let mida = dv.getUint32(p), cap = 8;
    const tipus = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    if (mida === 1) { mida = Number(dv.getBigUint64(p + 8)); cap = 16; } else if (mida === 0) mida = fi - p;
    if (mida < cap || p + mida > fi) break;
    res.push({ tipus, ini: p + cap, fi: p + mida });
    p += mida;
  }
  return res;
}
const fill = (dv, c, tipus) => c && caixes(dv, c.ini, c.fi).find((b) => b.tipus === tipus);

/**
 * buf: ArrayBuffer del fitxer. Torna null si no és MP4/MOV o no té llista d'edició a l'àudio; si no,
 * {salta, retard, mostres}: segons que el reproductor salta a l'inici de la pista, segons de
 * silenci inicial (edició buida) i durada total de la pista en segons (amb el priming).
 */
export function edicioAudio(buf) {
  const dv = new DataView(buf);
  const moov = caixes(dv, 0, buf.byteLength).find((b) => b.tipus === "moov");
  if (!moov) return null;
  const mvhd = fill(dv, moov, "mvhd");
  if (!mvhd) return null;
  const escalaPeli = dv.getUint32(mvhd.ini + (dv.getUint8(mvhd.ini) === 1 ? 20 : 12));
  for (const trak of caixes(dv, moov.ini, moov.fi).filter((b) => b.tipus === "trak")) {
    const mdia = fill(dv, trak, "mdia"), hdlr = fill(dv, mdia, "hdlr"), mdhd = fill(dv, mdia, "mdhd");
    if (!hdlr || !mdhd) continue;
    const h = String.fromCharCode(...new Uint8Array(buf, hdlr.ini + 8, 4));
    if (h !== "soun") continue;
    const v = dv.getUint8(mdhd.ini);
    const escala = dv.getUint32(mdhd.ini + (v === 1 ? 20 : 12));
    const durada = v === 1 ? Number(dv.getBigUint64(mdhd.ini + 24)) : dv.getUint32(mdhd.ini + 16);
    const elst = fill(dv, fill(dv, trak, "edts"), "elst");
    if (!elst) return null;
    const ve = dv.getUint8(elst.ini), n = dv.getUint32(elst.ini + 4);
    let p = elst.ini + 8, retard = 0, salta = 0;
    for (let k = 0; k < n; k++) {
      const seg = ve === 1 ? Number(dv.getBigUint64(p)) : dv.getUint32(p);
      const temps = ve === 1 ? Number(dv.getBigInt64(p + 8)) : dv.getInt32(p + 4);
      p += ve === 1 ? 20 : 12;
      if (temps === -1) { retard += seg / escalaPeli; continue; }    // edició buida: silenci
      salta = temps / escala;
      break;
    }
    return { salta, retard, mostres: durada / escala };
  }
  return null;
}
