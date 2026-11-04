# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""
Fase 5 — segmentació de subtítols a partir de les paraules del motor (text, ini, fi, punt).

Paràmetres (ParamsSub), els dos primers com al transcriptor de Softcatalà:
  max_car      caràcters màxims per línia ("abans de saltar de línia")
  max_linies   línies màximes per subtítol
  max_paraules paraules màximes per subtítol (0 = sense límit); es combina amb max_car,
               p. ex. l'estil "2–3 paraules de colp" de Reels i TikTok
  ressalta     "Ressalta cada paraula quan es pronuncia":
                 ""        no
                 "paraula" es marca només la paraula que es diu
                 "progres" la frase sencera a la vista i les paraules dites es van marcant
                           (efecte karaoke: blanc -> color conforme es diu)
                 "acumula" les paraules apareixen d'una en una (sense etiquetes: va a tot arreu)
  com es marca (es poden combinar; si no se'n tria cap, subratllat):
    subratlla, negreta, cursiva   True/False
    color        color del text marcat: "#FFFF00" o un nom (groc, verd, roig, blau…)
    fons         color de fons de la paraula marcada. Només VTT (el SRT no en té)
    marca        etiquetes pròpies, p. ex. ("<b>", "</b>"); substitueix les opcions anteriors
  max_cps      velocitat de lectura màxima (caràcters per segon, cost suau)
  durada_min / durada_max   durada d'un subtítol (la màxima és dura)
  separacio    separació mínima entre dos subtítols seguits (s)
  enganxa      si el buit fins al següent és menor que això, el subtítol s'hi allarga
  cua          temps que el subtítol es queda després de la darrera paraula (s)
  pausa        silenci que es considera una pausa clara entre paraules (s)
  desfas       desplaçament de tots els temps (s); p. ex. -0,08 compensa el retard mesurat

Algorisme: programació dinàmica sobre les paraules. Cada subtítol possible [i..j] té un
cost (tall en mal lloc, frase partida, massa caràcters per segon, massa curt…) i es tria
la partició de cost mínim. Dins de cada subtítol, el salt de línia es tria igual: línies
equilibrades, preferentment després d'un signe i mai després d'un article o preposició.
El text no es modifica mai: només es decideix on tallar.

Tot és Python pur (sense numpy) perquè es puga portar tal qual a JavaScript.
"""
from dataclasses import dataclass, replace

FINAL = {".", "?", "!", "…"}
FEBLE = {",", ":", ";", "-"}

# Paraules després de les quals no s'ha de tallar (articles, preposicions, conjuncions,
# pronoms febles, possessius àtons…). Inclou l'article salat balear.
FUNCIONALS = set("""
el la els les lo los l un una uns unes es sa ses so s en na n
de del dels d a al als ab amb per pel pels pera sense sobre sota fins cap contra entre segons
des dins devers vers envers davant darrere damunt devall baix
i o ni però que perquè si com quan on mentre doncs ja ben molt més menys tan tant
em et es ens us li hi ho me te se mos vos
meu meva teu teva seu seva nostre nostra vostre vostra mon ma ton ta son sa mos tos sos
aquest aquesta aquests aquestes aquell aquella aquells aquelles este esta estos estes
aqueix aqueixa cada tot tota tots totes altre altra altres qualque qualsevol alguns algunes
no és era va van vaig vam vau varen ha han he hem heu havia hauria pot poden
""".split())


NUMERALS = set("""
zero u un una dos dues tres quatre cinc sis set vuit nou deu onze dotze tretze catorze quinze
setze disset desset dèsset divuit devuit dinou dènou dinòu vint trenta quaranta cinquanta seixanta
setanta vuitanta huitanta noranta cent cents centes mil milió milions bilió bilions i
""".split())


@dataclass(frozen=True)
class ParamsSub:
    max_car: int = 42
    max_linies: int = 2
    max_paraules: int = 0
    max_cps: float = 17.0
    durada_min: float = 1.0
    durada_max: float = 7.0
    separacio: float = 0.08
    enganxa: float = 0.5
    cua: float = 0.3
    pausa: float = 0.5
    desfas: float = 0.0
    ressalta: str = ""                 # "", "paraula", "progres", "acumula"
    subratlla: bool = False
    negreta: bool = False
    cursiva: bool = False
    color: str = ""
    fons: str = ""
    marca: tuple | None = None


PERFILS = {
    # vídeo horitzontal (YouTube, televisió): 2 línies de 42, lectura còmoda
    "horitzontal": ParamsSub(),
    # Reels / TikTok / Shorts: 1 línia curta, subtítols ràpids i enganxats
    "vertical": ParamsSub(max_car=22, max_linies=1, max_cps=22.0, durada_min=0.5, durada_max=3.0,
                          separacio=0.0, enganxa=1.0, cua=0.2),
    # accessibilitat: lectura lenta, més temps a pantalla
    "accessibilitat": ParamsSub(max_car=37, max_linies=2, max_cps=13.0, durada_min=1.5, durada_max=7.0,
                                enganxa=0.8, cua=0.6),
}


def params(perfil: str = "horitzontal", **canvis) -> ParamsSub:
    """Perfil predefinit amb els canvis indicats (els None s'ignoren)."""
    return replace(PERFILS[perfil], **{k: v for k, v in canvis.items() if v is not None})


# ---------------------------------------------------------------- utilitats

def _forma(p: dict) -> str:
    return p["text"] + (p.get("punt") or "")


def _nu(p: dict) -> str:
    return p["text"].lower().strip("'’-").split("'")[-1].split("’")[-1]


def _es_funcional(p: dict) -> bool:
    return not p.get("punt") and (_nu(p) in FUNCIONALS or p["text"].endswith(("'", "’")))


def _es_numeral(p: dict) -> bool:
    t = p["text"].lower()
    return t.replace(",", "").replace(".", "").isdigit() or \
        (t != "i" and all(x in NUMERALS for x in t.split("-")))


def _unit(p: dict, seg: dict) -> bool:
    """p i seg formen una unitat que no s'ha de partir: un número o un nom propi."""
    if p.get("punt"):
        return False
    if _es_numeral(p) and (_es_numeral(seg) or seg["text"].lower() == "i"):
        return True
    return p["text"][:1].isupper() and seg["text"][:1].isupper()


def _cost_tall(p: dict, seg: dict | None, P: ParamsSub) -> float:
    """Cost de tallar (subtítol o línia) just després de la paraula p."""
    if seg is None:
        return 0.0
    punt = p.get("punt") or ""
    if punt in FINAL:
        c = 0.0
    elif punt in FEBLE:
        c = 0.6
    else:
        c = 2.0
    if _es_funcional(p):
        c += 3.0
    elif _unit(p, seg):
        c += 2.5
    pausa = seg["ini"] - p["fi"]
    c -= 1.5 * min(max(pausa, 0.0) / P.pausa, 1.0)
    return c


# ---------------------------------------------------------------- línies

def linies(ws: list[dict], P: ParamsSub, L: list[int] | None = None) -> tuple[list[list[dict]], float] | None:
    """Reparteix les paraules d'un subtítol en línies. Torna (línies, cost) o None si no cap.
    L: llargada de cada paraula (amb el signe), si ja es té."""
    L = L or [len(_forma(p)) for p in ws]
    total = sum(L) + len(L) - 1
    if total <= P.max_car:
        return [ws], 0.0                    # una línia si cap (norma habitual)
    if P.max_linies < 2:
        return ([ws], 50.0) if len(ws) == 1 else None   # paraula sola massa llarga: s'accepta
    millor = None
    llarg = 0
    for k in range(1, len(ws)):              # salt després de la paraula k-1
        llarg += L[k - 1] + (1 if k > 1 else 0)
        l1, l2 = llarg, total - llarg - 1
        if l1 > P.max_car or l2 > P.max_car:
            continue
        c = _cost_tall(ws[k - 1], ws[k], P) + 1.5 * abs(l1 - l2) / P.max_car
        if l1 > l2:                          # millor piràmide invertida suau: 1a línia més curta
            c += 0.2 * (l1 - l2) / P.max_car
        if millor is None or c < millor[1]:
            millor = ([ws[:k], ws[k:]], c)
    if millor is None and len(ws) == 1:
        return [ws], 50.0
    return millor


# ---------------------------------------------------------------- segmentació

def _cost_subtitol(ws: list[dict], seguent: dict | None, P: ParamsSub, L: list[int]) -> tuple[float, list] | None:
    lin = linies(ws, P, L)
    if lin is None:
        return None
    parts, c_lin = lin
    parla = ws[-1]["fi"] - ws[0]["ini"]
    if len(ws) > 1 and parla > P.durada_max:
        return None
    c = 1.0 + c_lin                                   # cost fix per subtítol: evita trossets
    c += _cost_tall(ws[-1], seguent, P)
    for a, b in zip(ws, ws[1:]):                       # frases o pauses llargues a dins
        if (a.get("punt") or "") in FINAL:
            c += 1.2
        if b["ini"] - a["fi"] >= P.pausa:
            c += 1.5
    car = sum(L) + len(L) - 1
    curt = 0.35 * P.max_car * P.max_linies          # subtítols molt curts: només si acaben frase
    if car < curt and not ws[-1].get("punt") and seguent is not None:
        c += 1.0 * (curt - car) / curt
    pantalla = max(parla + P.cua, 0.3)
    if seguent is not None:
        pantalla = min(pantalla, max(seguent["ini"] - ws[0]["ini"], 0.3))
    cps = car / pantalla
    if cps > P.max_cps:
        c += 0.4 * (cps - P.max_cps)
    if pantalla < P.durada_min and seguent is not None:
        c += 1.0 * (P.durada_min - pantalla) / P.durada_min
    return c, parts


def segmenta(paraules: list[dict], P: ParamsSub) -> list[dict]:
    """Paraules -> subtítols [{ini, fi, linies: [[paraula…]…], paraules: [...]}]."""
    n = len(paraules)
    if n == 0:
        return []
    L = [len(_forma(p)) for p in paraules]
    INF = float("inf")
    millor = [INF] * (n + 1)
    tria = [None] * (n + 1)
    millor[0] = 0.0
    for i in range(n):
        if millor[i] == INF:
            continue
        car = -1
        for j in range(i + 1, n + 1):
            car += L[j - 1] + 1
            if j - i > 1 and (car > P.max_car * P.max_linies or P.max_paraules and j - i > P.max_paraules
                              or paraules[j - 1]["fi"] - paraules[i]["ini"] > P.durada_max):
                break
            r = _cost_subtitol(paraules[i:j], paraules[j] if j < n else None, P, L[i:j])
            if r is None:
                continue
            c = millor[i] + r[0]
            if c < millor[j]:
                millor[j], tria[j] = c, (i, r[1])
    trossos, j = [], n
    while j > 0:
        i, parts = tria[j]
        trossos.append((i, j, parts))
        j = i
    trossos.reverse()

    cues = []
    for k, (i, j, parts) in enumerate(trossos):
        ws = paraules[i:j]
        cues.append({"ini": ws[0]["ini"] + P.desfas, "fi": ws[-1]["fi"] + P.desfas,
                     "linies": parts, "paraules": ws})
    return temps(cues, P)


def temps(cues: list[dict], P: ParamsSub) -> list[dict]:
    """Ajusta l'inici i la fi de cada subtítol (cua, durada mínima, enganxa, separació)."""
    for k, c in enumerate(cues):
        c["ini"] = max(c["ini"], 0.0)
        fi = max(c["fi"] + P.cua, c["ini"] + P.durada_min)
        if k + 1 < len(cues):
            seg = max(cues[k + 1]["ini"], 0.0)
            if seg - fi < P.enganxa:
                fi = seg - P.separacio          # s'allarga (o s'escurça) fins al següent
            fi = min(fi, seg - P.separacio)
        c["fi"] = max(fi, c["ini"] + 0.04)
    return cues


COLORS = {"groc": "#FFFF00", "verd": "#00E676", "roig": "#FF3B30", "vermell": "#FF3B30",
          "blau": "#2F9BFF", "cian": "#00FFFF", "taronja": "#FF9500", "rosa": "#FF4FC3",
          "lila": "#B266FF", "blanc": "#FFFFFF", "negre": "#000000"}


def color_hex(c: str) -> str:
    """Nom o codi de color -> "#RRGGBB" ("" si no n'hi ha)."""
    if not c:
        return ""
    c = COLORS.get(c.strip().lower(), c.strip())
    c = c if c.startswith("#") else "#" + c
    if len(c) != 7 or any(x not in "0123456789abcdefABCDEF" for x in c[1:]):
        raise ValueError(f"Color no vàlid: {c} (usa #RRGGBB o {', '.join(COLORS)})")
    return c.upper()


def _amb_estil(P: ParamsSub) -> bool:
    return bool(P.marca or P.subratlla or P.negreta or P.cursiva or P.color or P.fons)


def etiquetes(P: ParamsSub, fmt: str = "srt") -> tuple[str, str]:
    """Etiquetes d'obrir i tancar per a una paraula marcada."""
    if P.marca:
        return P.marca
    if not _amb_estil(P):
        P = replace(P, subratlla=True)                # per defecte, subratllat (va a Premiere)
    obre = []
    if P.negreta:
        obre.append("b")
    if P.cursiva:
        obre.append("i")
    if P.subratlla:
        obre.append("u")
    a = "".join(f"<{x}>" for x in obre)
    z = "".join(f"</{x}>" for x in reversed(obre))
    if fmt == "srt" and P.color:
        a, z = a + f'<font color="{color_hex(P.color)}">', "</font>" + z
    if fmt == "vtt" and (P.color or P.fons):
        a, z = a + "<c.r>", "</c>" + z           # el color i el fons van al bloc STYLE
    return a, z


def avisos(P: ParamsSub, fmt: str) -> list[str]:
    res = []
    if P.ressalta and P.fons and not P.marca and fmt == "srt":
        res.append("El SRT no admet color de fons: el fons només s'aplica al VTT.")
    return res


def text(c: dict, marcades=(), fins: int | None = None, P: ParamsSub | None = None,
         fmt: str = "srt") -> str:
    """Text del subtítol. marcades: índexs de les paraules ressaltades (les seguides van dins
    d'una mateixa etiqueta, espais inclosos); fins: només es mostren fins a aquesta paraula."""
    a, z = etiquetes(P, fmt) if marcades else ("", "")
    res, k = [], 0
    for lin in c["linies"]:
        out, dins = "", False
        for p in lin:
            if fins is not None and k > fins:
                k += 1
                continue
            m = k in marcades
            if m and not dins:
                out += (" " if out else "") + a
            elif dins and not m:
                out += z + " "
            elif out:
                out += " "
            out += _forma(p)
            dins = m
            k += 1
        if dins:
            out += z
        if out:
            res.append(out)
    return "\n".join(res)


def expandeix(cues: list[dict], P: ParamsSub) -> list[dict]:
    """Subtítols finals [{ini, fi, cue, marcades, fins}]: un per subtítol o, amb el ressaltat,
    un per paraula. El text es construeix en escriure (SRT i VTT fan servir etiquetes diferents)."""
    mode = P.ressalta
    res = []
    for c in cues:
        ws = c["paraules"]
        if not mode:
            res.append({"ini": c["ini"], "fi": c["fi"], "cue": c, "marcades": (), "fins": None})
            continue
        for k, p in enumerate(ws):
            ini = c["ini"] if k == 0 else max(p["ini"] + P.desfas, res[-1]["ini"] + 0.04)
            fi = c["fi"] if k == len(ws) - 1 else ws[k + 1]["ini"] + P.desfas
            fi = min(max(fi, ini + 0.04), c["fi"])
            if mode == "paraula":
                marc, fins = {k}, None
            elif mode == "progres":
                marc, fins = set(range(k + 1)), None
            else:                                        # acumula
                marc, fins = ({k} if _amb_estil(P) else ()), k
            res.append({"ini": ini, "fi": fi, "cue": c, "marcades": marc, "fins": fins})
    return res


def subtitols(paraules: list[dict], P: ParamsSub | None = None) -> list[dict]:
    P = P or PERFILS["horitzontal"]
    return expandeix(segmenta(paraules, P), P)


# ---------------------------------------------------------------- escriptura

def _t(s: float, sep: str) -> str:
    ms = int(round(max(s, 0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s_, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s_:02d}{sep}{ms:03d}"


def _txt(e: dict, P: ParamsSub, fmt: str) -> str:
    return text(e["cue"], e["marcades"], e["fins"], P, fmt) if "cue" in e else e["text"]


def srt(cues: list[dict], P: ParamsSub | None = None) -> str:
    P = P or ParamsSub()
    return "\n".join(f"{i}\n{_t(c['ini'], ',')} --> {_t(c['fi'], ',')}\n{_txt(c, P, 'srt')}\n"
                     for i, c in enumerate(cues, 1))


def vtt(cues: list[dict], P: ParamsSub | None = None) -> str:
    P = P or ParamsSub()
    cap = "WEBVTT\n\n"
    if P.ressalta and not P.marca and (P.color or P.fons):
        css = (f"color: {color_hex(P.color)}; " if P.color else "") + \
              (f"background-color: {color_hex(P.fons)}; " if P.fons else "")
        cap += "STYLE\n::cue(.r) { " + css + "}\n\n"
    return cap + "\n".join(f"{_t(c['ini'], '.')} --> {_t(c['fi'], '.')}\n{_txt(c, P, 'vtt')}\n" for c in cues)


def txt(paraules: list[dict]) -> str:
    return " ".join(_forma(p) for p in paraules) + "\n"
