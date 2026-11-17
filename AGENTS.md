# subtitols-ca — guia per a agents de codi (i persones)

Web estàtica (GitHub Pages) que transcriu vídeo o àudio en català **dins del navegador**
(onnxruntime-web, models en memòria cau) i genera subtítols SRT/VTT/TXT per a Premiere o CapCut.
Focus en el valencià i el balear. Autor: Ferran Artero Merino (beca ValgrAI, VRAIN-UPV).

Llegeix [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) abans de tocar el motor: explica com
funciona cada peça i què s'ha mesurat per decidir-la. **No tornis a obrir decisions mesurades**
(model, quantització, rescat, puntuació, fils) sense un motiu nou i mesures noves.

## On és cada cosa

| Carpeta | Què hi ha |
|---|---|
| `web/` | L'única cosa que es publica: `index.html`, `css/`, `fonts/`, `js/` (interfície, àudio, segmentació) |
| `web/js/motor/` | El motor JS (Web Worker): VAD, mel, RNNT, rescat, puntuació. Reutilitzable a Node ([README](web/js/motor/README.md)) |
| `web/js/vendor/ort/` | onnxruntime-web 1.29.0 (no es toca a mà) |
| `eines/motor_ref/` | Motor de referència en Python (numpy + onnxruntime + tokenizers). **És la versió oficial de la recepta** |
| `eines/` | `transcriu.py` (línia d'ordres), `serveix.py` (servidor local), `models/` (exportar, quantitzar i publicar) |
| `proves/` | Igualtat JS = Python, mètriques (`avalua.py`) i banc de proves (`banc/`) |
| `docs/` | `ARQUITECTURA.md` |
| `MODELS.md` | Models, autors, llicències i cites |

## Normes

**Qualitat**
- **Precisió per damunt de velocitat.** L'únic requisit dur és que tot funcioni **al navegador**
  (Windows, Mac, Android, iOS), sense instal·lar res.
- **Cap canvi no pot empitjorar els resultats mesurats.** Abans d'adoptar-lo, comprova'l amb els
  38 clips i els vídeos (`proves/avalua.py`; vegeu `proves/README.md`).
- Qualsevol canvi al motor es fa **a Python i a JS alhora** i les proves d'igualtat han de continuar
  donant 41/41 (els signes de Softcatalà poden variar una mica: és l'int8 dinàmic).
- La segmentació no modifica mai el text.

**Interfície**
- Textos en **català neutre** («aquí», «surt», «afegeix», «acabi»), no valencià («ací», «ix»,
  «afig», «acabe»).
- Cap text tècnic a la vista (RTF, ms, fils, avisos de segmentació): van a la consola.
- No es baixen els models (≈ 460 MB) sense que l'usuari premi «Transcriu».
- Privacitat: cap fitxer de l'usuari surt del navegador. Res de tercers en temps d'execució excepte
  els models de Hugging Face (revisió fixada).

**Codi**
- Noms, comentaris i documentació en català.
- Capçalera de tots els fitxers de codi:
  ```
  # SPDX-License-Identifier: GPL-3.0-or-later
  # Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
  ```
  (amb `//` als `.js` i `.mjs`).
- Sense *framework* ni empaquetador a la web: mòduls ES servits tal qual.
- Els mòduls del motor reben `ort` com a paràmetre (no l'importen).
- Les dades (gravacions, vídeos, referències) i els models no es pugen mai (`resultats/`,
  `models_onnx/`, `*.wav`, `*.mp4`…). Els scripts les llegeixen de `--dades` o de `SUBTITOLS_DADES`.

## Forma de treball

- L'usuari treballa a **Windows 11 sense GPU, amb PowerShell**. Treball pas a pas: dona-li les
  ordres exactes (blocs de PowerShell), explica breument el perquè de cada canvi i espera la
  sortida. Si tens accés a les seves carpetes, pots executar-ho tu (límit de 3 min per ordre: les
  proves llargues són reprenibles).
- PowerShell no expandeix `*` als arguments (els scripts ja fan servir `glob`); les rutes amb
  espais van entre cometes.
- **Flux:** els experiments es fan a la carpeta de recerca `ASR-CAT` (fora del repositori: dades,
  entorns, motor de recerca amb opcions d'experiment). Quan un canvi està validat, es passa aquí
  **net i sense redundàncies**.
- **Git:** l'usuari fa els *commits* i el `push`. Si treballes des d'una VM sobre la carpeta de
  Windows, fes servir `git -c core.autocrlf=true` (si no, tots els fitxers surten modificats). Si
  l'usuari diu «deixa-ho preparat», no facis cap *commit*.

## Ordres habituals

```powershell
pip install -r eines\requirements.txt
npm install                                                     # onnxruntime-web per a les proves de Node

python eines\serveix.py --models ruta\models_onnx               # la web en local: http://localhost:8000/
python eines\transcriu.py video.mp4 --models ruta\models_onnx   # el motor de referència

$env:SUBTITOLS_DADES = "ruta\dades"                             # referencies.tsv, valencia\, balear\, videos\
python proves\avalua.py resultats\...                           # WER, WER formatat, F1, perdudes, sincronia
```

La resta de proves (igualtat JS = Python, banc de proves al navegador) són a
[`proves/README.md`](proves/README.md).
