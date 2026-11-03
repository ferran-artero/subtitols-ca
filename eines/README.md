# eines/ — preparació dels models i motor de referència en Python

Aquesta carpeta no forma part de la web publicada (GitHub Pages publica només `web/`).
Conté dues coses:

1. **Els scripts que generen els models ONNX** que baixa la web, a `models_onnx/` (fora de git).
2. **El motor de referència** (`motor_ref/`), la mateixa recepta que la web fa en JavaScript,
   només amb numpy, onnxruntime i tokenizers. Serveix per a comprovar que la web dona el mateix
   resultat i per a transcriure des de la línia d'ordres.

## Generar els models

Cal un entorn amb NeMo (vegeu `requirements-exporta.txt`). Des de l'arrel del repositori:

```bat
python eines\onnx_exporta_conformer.py      :: Conformer ca-es -> encoder + decoder_joint
python eines\onnx_exporta_puntuadors.py     :: puntuador de Softcatalà (i UMU, per a comparar)
python eines\onnx_baixa_vad.py              :: Silero VAD
python eines\onnx_quantitza_pesos.py --bits 8   :: encoder.q8w.onnx (pesos de 8 bits)
python eines\onnx_requantitza.py            :: softcatala/onnx/model_q8pc.onnx
python eines\onnx_baixa_umu_oficial.py      :: majúscules: int8 oficial de la UMU
```

Fitxers que fa servir el motor (i la web):

| Fitxer | Mida |
|---|---|
| `conformer-ca-es/encoder.q8w.onnx` | 191 MB |
| `conformer-ca-es/decoder_joint.onnx` | 17 MB |
| `softcatala/onnx/model_q8pc.onnx` | 127 MB |
| `umu-oficial/onnx/model.onnx` | 126 MB |
| `silero-vad/silero_vad.onnx` | 2 MB |

## Transcriure amb el motor de referència

Entorn lleuger (`requirements-motor.txt`, sense PyTorch):

```bat
python eines\transcriu.py C:\videos\entrevista.mp4
python eines\transcriu.py C:\carpeta_amb_videos --eixida C:\subtitols
```

Escriu `<nom>.json` (paraules amb temps, signes i majúscules) i `<nom>.srt` (subtítols senzills).

Com funciona, pas a pas:

1. **Àudio** a 16 kHz mono (vídeos amb ffmpeg).
2. **VAD** (Silero): trossos de veu de com a molt 25 s, amb 0,5 s de silenci de context;
   la parla seguida de més de 25 s es talla pel punt més silenciós, amb 1 s de solapament.
3. **Espectrograma** log-mel idèntic al de NeMo.
4. **Conformer-Transducer**: encoder + descodificació RNNT greedy.
5. **Rescat de frases perdudes**: si en un tros queda un forat de ≥ 0,7 s sense paraules on el
   VAD diu que hi ha veu, el tros es torna a descodificar amb penalització 2 del blank; si el
   forat continua, es reconeix de nou una finestra curta al voltant del forat (se n'agafen només
   les paraules de dins); i si encara continua, només el forat puja a penalització 3 i 4.
6. **Paraules** amb inici i fi; apòstrofs i guionets ajuntats.
7. **Puntuació**: signes de Softcatalà + majúscules de la UMU, per finestres de 120 paraules.
