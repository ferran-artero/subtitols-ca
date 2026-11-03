# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Tokens -> paraules amb temps.

Cada peça de SentencePiece que comença per '▁' obri una paraula nova. Una paraula comença
a l'instant del seu primer token i acaba a l'instant del darrer + 1 (cada instant = 40 ms).
El temps absolut és l'inici del tros + instant × 0,04 s.

Elisions: l'ASR de vegades escriu l'apòstrof o el guionet en una peça i comença la paraula
següent com a paraula nova ("l'" + "actor"). Si una paraula acaba en ' o -, o la següent en
comença, s'ajunten en una sola ("l'actor", "xerrar-ne"), amb el temps de totes dues.

Elisions que l'ASR no escriu: de vegades deixa una lletra sola ("l hotel", "se n va"). En
català l, d, m, t, s i n mai no són paraules soles: si van davant d'una paraula que comença per
vocal o h, s'hi uneixen amb apòstrof ("l'hotel", "d'ahir", "m'ho"); si no, i van darrere d'una
paraula acabada en vocal, s'hi uneixen pel darrere ("se'n", "porta'l"; la d, mai). Davant de
"a", "i", "o", "u", "e" no s'apostrofa.

El text de cada paraula es neteja igual que fa el puntuador (minúscules, sense signes, però
mantenint apòstrofs, guionets interns i l·l), perquè paraules i puntuació vagen una per una.
"""
import re
import unicodedata

ELISIO = ("'", "’", "-")


def uneix_elisions(text: str) -> str:
    """El mateix sobre un text: "l' actor" -> "l'actor", "xerrar -ne" -> "xerrar-ne"."""
    text = re.sub(r"(?<=\w)(['’-])\s+(?=\w)", r"\1", text)
    return re.sub(r"(?<=\w)\s+(['’-])(?=\w)", r"\1", text)


SOLES = {"l", "d", "m", "t", "s", "n"}
ENCLITICS = {"l", "m", "t", "s", "n"}            # els que poden anar darrere ("se'n", "porta'l")
NO_APOSTROFEN = {"a", "i", "o", "u", "e"}         # mai "l'a", "d'i"...
INICI_VOCAL = tuple("aeiouàèéíïòóúüh")
FINAL_VOCAL = tuple("aeiouàèéíïòóúü")


def agrupa_elisions(textos: list[str]) -> list[tuple[str, int, int]]:
    """Paraules -> (text, primera, última) amb les elisions refetes."""
    res, i = [], 0
    while i < len(textos):
        w = textos[i]
        if w in SOLES and i + 1 < len(textos) and textos[i + 1].startswith(INICI_VOCAL) \
                and textos[i + 1] not in NO_APOSTROFEN:
            res.append((f"{w}'{textos[i + 1]}", i, i + 1))
            i += 2
            continue
        if w in ENCLITICS and res and res[-1][0].endswith(FINAL_VOCAL):
            t, a, _ = res[-1]
            res[-1] = (f"{t}'{w}", a, i)
            i += 1
            continue
        res.append((w, i, i))
        i += 1
    return res


def repara_text(text: str) -> str:
    return " ".join(t for t, _, _ in agrupa_elisions(text.split()))


def neteja(w: str) -> str:
    t = unicodedata.normalize("NFC", w).lower()
    t = t.replace("’", "'").replace("‘", "'").replace("`", "'").replace("´", "'")
    t = t.replace("ŀl", "l·l").replace("l.l", "l·l").replace("l•l", "l·l").replace("l∙l", "l·l")
    t = re.sub(r"[^\w\s'·-]", " ", t)
    t = re.sub(r"(?<!\w)['-]|['-](?!\w)", " ", t)
    t = re.sub(r"(?<!l)·|·(?!l)", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def a_paraules(ids: list[int], instants: list[int], peces: list[str],
               inici_tros: float, seg_instant: float) -> list[dict]:
    brutes = []                                   # [text, primer instant, últim instant]
    for i, t in zip(ids, instants):
        p = peces[i]
        if p == "<unk>":                          # SentencePiece l'escriu com ' ⁇ ': no és una paraula
            continue
        if p.startswith("▁") or not brutes:
            brutes.append([p.lstrip("▁"), t, t])
        else:
            brutes[-1][0] += p
            brutes[-1][2] = t
    unides = []
    for b in brutes:
        if unides and b[0] and unides[-1][0] and (unides[-1][0].endswith(ELISIO) or b[0].startswith(ELISIO)):
            unides[-1][0] += b[0]
            unides[-1][2] = b[2]
        else:
            unides.append(b)
    netes = []                                    # [text, primer instant, últim instant]
    for text, t0, t1 in unides:
        for w in neteja(text).split():           # en casos rars, la neteja parteix una paraula
            netes.append((w, t0, t1))
    paraules = []
    for text, a, b in agrupa_elisions([w for w, _, _ in netes]):
        paraules.append({"text": text,
                         "ini": round(inici_tros + netes[a][1] * seg_instant, 3),
                         "fi": round(inici_tros + (netes[b][2] + 1) * seg_instant, 3)})
    return paraules
