# Proves

Tres menes de proves:

1. **Igualtat JS = Python:** la versió JavaScript (`web/js/`) ha de donar exactament el mateix que
   el motor de referència en Python (`eines/motor_ref/`).
2. **Qualitat** (`avalua.py`): mètriques contra les referències humanes. Cap canvi no s'adopta si
   alguna empitjora.
3. **Banc de proves** (`banc/`): temps per etapa i configuracions (fils, WASM o WebGPU) a Node i al
   navegador de cada dispositiu.

Els resultats es generen a `resultats/`, que no es puja a git.

## Preparació

```powershell
pip install -r proves\requirements.txt              # el motor de Python + jiwer
npm install                                         # onnxruntime-web 1.29.0 per a Node (o $env:ORT_WEB = "ruta\ort.node.min.mjs")
$env:SUBTITOLS_DADES = "ruta\dades"                 # les teves gravacions i referències (fora del repositori)
```

La carpeta de dades té aquest format (és el de les dades de l'autor; qualsevol altre conjunt
serveix si el segueix):

```
dades/
├── referencies.tsv          columnes «arxiu» (p. ex. balear/ba_lex_01.wav) i «text» (amb puntuació)
├── valencia/, balear/…      els àudios de referencies.tsv
└── videos/
    ├── <nom>.mov|mp4|…      el vídeo
    ├── <nom>.ref.txt        text de referència (números en lletres, com es pronuncien)
    └── <nom>.ref.srt        opcional: subtítols de referència amb temps (per a la sincronia)
```

## Referències de Python

```powershell
python proves\referencia_motor.py "$env:SUBTITOLS_DADES\valencia" "$env:SUBTITOLS_DADES\balear" "$env:SUBTITOLS_DADES\videos" --models ruta\models_onnx
```

Desa, per a cada àudio, cada pas del motor a `resultats\proves\motor\<nom>\` (àudio, probabilitats
del VAD, espectrogrames, `motor.json`) i la llista d'àudios a `index.json`. Els àudios ja fets se
salten.

## 1. Igualtat JS = Python

### Segmentació dels subtítols (`web/js/subtitols.js`)

```powershell
python proves\casos_subtitols.py resultats\proves\motor          # SRT/VTT/TXT de Python, 36 combinacions per fitxer
node proves\subtitols.test.mjs                                   # els compara amb els de JavaScript
```

### Motor (`web/js/motor/`)

```powershell
node proves\motor.test.mjs --models ruta\models_onnx           # mel i VAD
node proves\rnnt.test.mjs --models ruta\models_onnx            # tokens dels trossos sense rescat
node proves\motor_complet.test.mjs --models ruta\models_onnx   # tot el motor amb rescat (reprenible)
node proves\puntua.test.mjs --models ruta\models_onnx          # puntuació i majúscules
```

Resultats (4/11/2026): mel, VAD, tokens, rescat i paraules amb temps idèntics a Python en 41/41
àudios. Puntuació: tokenitzador idèntic; majúscules (UMU) idèntiques; els signes (Softcatalà
`q8pc`, int8 dinàmic) varien una mica entre plataformes, també entre dues instal·lacions de
Python: 1.970/2.015 paraules iguals i la mateixa qualitat.

## 2. Qualitat: `avalua.py`

```powershell
python proves\avalua.py resultats\proves\motor                                  # les referències de Python
python proves\avalua.py resultats\*.json                                       # el que hagi escrit eines\transcriu.py
python proves\avalua.py resultats\banc\navegador\<etiqueta>                    # el que hagi transcrit el navegador
python proves\avalua.py resultats\proves\motor --desa resultats\linia_base.json
python proves\avalua.py resultats\nou --compara resultats\linia_base.json      # codi 1 si alguna mètrica empitjora
```

Per grup (els clips de `referencies.tsv` junts, cada vídeo a part): WER, WER formatat (majúscules
i signes), F1 de puntuació i de majúscules, frases perdudes (≥ 3 paraules seguides eliminades),
sincronia (si hi ha `.ref.srt`) i RTF. Les mètriques amb format només surten si la transcripció
té signes (el banc de proves no puntua).

Línia base (17/11/2026, referències de Python generades a la VM):

| Grup | WER | WER formatat | F1 punt. | F1 maj. | Perdudes | Sincronia |
|---|---|---|---|---|---|---|
| 38 clips | 9,36 % | 13,66 % | 0,772 | 0,908 | 0 | – |
| Daniel Sancho | 6,97 % | 12,16 % | 0,768 | 0,905 | 0 | +0,08 s (+0,01..+0,14) |

(Amb el JSON de Daniel fet a Windows, el WER formatat és 11,72 %: la diferència són els signes de
Softcatalà, que varien una mica entre màquines.)

## 3. Banc de proves (`banc/`)

### A Node

```powershell
node proves\banc\banc.mjs --models ruta\models_onnx --etiqueta base [--nomes ba_lex_01,va_whats_03] [--fils 1] [--temps 150]
```

Transcriu els àudios de `resultats\proves\motor` tros a tros, comprova que el resultat és idèntic al
de Python i mostra el temps de cada etapa (VAD, encoder, bucle, i la part del rescat amb finestres).
És reprenible: cada tros es desa a `resultats\banc\node\<etiqueta>\`, i amb `--temps` s'atura abans
del límit i continua la vegada següent.

### Al navegador

```powershell
python eines\serveix.py --models ruta\models_onnx            # (amb $env:SUBTITOLS_DADES definit)
# obre http://localhost:8000/banc/banc.html
```

Tria configuracions (WASM amb 1, 2, 4 o N fils; WebGPU amb l'encoder `q8w` o fp32), un joc d'àudios
i la font de l'àudio: `pcm.npy` (el mateix que Python: ha de donar idèntic) o el fitxer original
descodificat pel navegador (com a la web). Mostra el temps per etapa i l'RTF, i desa cada
transcripció a `resultats\banc\navegador\<etiqueta>\`, que es pot avaluar amb `avalua.py`.

Per a provar-lo en un altre dispositiu de la xarxa (un mòbil, un Mac), cal servir-lo amb HTTPS o des
de `localhost`: els navegadors només deixen fer servir diversos fils en un context segur.
