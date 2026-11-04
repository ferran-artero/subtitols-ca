# eines/ — motor de referència en Python i preparació dels models

Aquesta carpeta no es publica a la web (GitHub Pages només publica `web/`). Conté:

```
eines/
├── transcriu.py      àudio o vídeo -> JSON + subtítols SRT/VTT/TXT
├── requirements.txt
├── motor_ref/        el motor: la mateixa recepta que farà la web en JavaScript
│   ├── audio.py      llegir a 16 kHz mono
│   ├── vad.py        Silero VAD -> trossos de veu de com a molt 25 s
│   ├── mel.py        espectrograma log-mel (idèntic al de NeMo)
│   ├── rnnt.py       encoder + bucle RNNT greedy
│   ├── paraules.py   tokens -> paraules amb temps (apòstrofs reparats)
│   ├── puntua.py     signes (Softcatalà) + majúscules (UMU)
│   ├── motor.py      ho ajunta tot, amb el rescat de frases perdudes
│   └── subtitols.py  paraules -> subtítols (segmentació, perfils, ressaltat)
└── models/           generar models_onnx/ (només cal una vegada)
```

## Transcriure

```bat
pip install -r eines\requirements.txt
python eines\transcriu.py video.mp4 --models models_onnx
python eines\transcriu.py video.mp4 --perfil vertical --ressalta progres --color groc
python eines\transcriu.py video.json --perfil horitzontal vertical --formats srt vtt txt
```

Escriu `<nom>.json` (la transcripció: paraules amb inici, fi, signe i majúscules) i els
subtítols. Si li passes el `.json`, només refà els subtítols (és instantani). `--help` mostra
totes les opcions.

| Grup | Opcions |
|---|---|
| Entrada | fitxers o carpetes, `--models`, `--eixida`, `--reutilitza`, `--fils` |
| Subtítols | `--perfil {horitzontal,vertical,accessibilitat}`, `--max-car`, `--max-linies`, `--max-paraules`, `--max-cps`, `--durada-min`, `--durada-max`, `--separacio`, `--enganxa`, `--cua`, `--desfas` |
| Ressaltat | `--ressalta {paraula,progres,acumula}`, `--subratlla`, `--negreta`, `--cursiva`, `--color`, `--fons` (només VTT), `--marca` |
| Eixida | `--formats srt vtt txt` |

Perfils: horitzontal 2×42 caràcters, 17 car/s; vertical 1×22, 22 car/s, subtítols enganxats;
accessibilitat 2×37, 13 car/s.

## Com funciona

1. **Àudio** a 16 kHz mono (wav/flac/ogg/mp3 amb soundfile + soxr; la resta amb ffmpeg).
2. **VAD** (Silero): trossos de veu de com a molt 25 s, amb 0,5 s de silenci de context; la
   parla seguida de més de 25 s es talla pel punt més silenciós, amb 1 s de solapament.
3. **Espectrograma** log-mel idèntic al de NeMo.
4. **Conformer-Transducer**: encoder + descodificació RNNT greedy.
5. **Rescat de frases perdudes**: si en un tros queda un forat de ≥ 0,7 s sense paraules on el
   VAD diu que hi ha veu, el tros es torna a descodificar amb el blank penalitzat; si el forat
   continua, es reconeix de nou una finestra curta al voltant del forat; i si encara continua,
   la penalització puja només dins del forat. En àudios nets no s'activa mai.
6. **Paraules** amb inici i fi; apòstrofs i guionets ajuntats.
7. **Puntuació**: signes de Softcatalà + majúscules de la UMU, per finestres de 120 paraules.
8. **Subtítols**: es tria la partició de cost mínim (talls per signes i pauses, mai darrere
   d'un article o una preposició, ni dins d'un número o un nom propi; línies equilibrades).

## Generar els models

Cal un entorn amb NeMo (`eines/models/requirements.txt`). Des de l'arrel del repositori:

```bat
python eines\models\exporta_conformer.py    :: Conformer ca-es -> encoder + decoder_joint (float32)
python eines\models\exporta_puntuadors.py   :: puntuador de Softcatalà (float32)
python eines\models\baixa_vad.py            :: Silero VAD
python eines\models\baixa_umu.py            :: majúscules: int8 oficial de la UMU
python eines\models\quantitza.py            :: encoder.q8w.onnx i softcatala model_q8pc.onnx
```

Fitxers que fan servir el motor i la web (≈ 463 MB):

| Fitxer | Mida |
|---|---|
| `conformer-ca-es/encoder.q8w.onnx` | 191 MB |
| `conformer-ca-es/decoder_joint.onnx` | 17 MB |
| `conformer-ca-es/tokens.txt`, `config.json`, `mel_fb.npy`, `finestra.npy` | petits |
| `softcatala/onnx/model_q8pc.onnx` (+ `tokenizer.json`, `config.json`) | 127 MB |
| `umu-oficial/onnx/model.onnx` (+ tokenitzador, `config.json`) | 126 MB |
| `silero-vad/silero_vad.onnx` | 2 MB |
