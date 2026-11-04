# Proves

Comproven que la versió JavaScript (`web/js/`) dona exactament el mateix que el motor de
referència en Python (`eines/motor_ref/`). Les dades (transcripcions) es generen a `resultats/`,
que no es puja a git.

## Segmentació dels subtítols (`web/js/subtitols.js`)

```powershell
python eines\transcriu.py video.mp4 --models ruta\models_onnx      # o qualsevol JSON del motor a resultats\
python proves\casos_subtitols.py resultats\*.json                   # SRT/VTT/TXT de Python, 36 combinacions per fitxer
node proves\subtitols.test.mjs                                      # els compara amb els de JavaScript
```

## Motor (`web/js/motor/`)

```powershell
python proves\referencia_motor.py ruta\audios --models ruta\models_onnx   # referències pas a pas (resultats\proves\motor)
$env:ORT_WEB = "ruta\node_modules\onnxruntime-web\dist\ort.node.min.mjs" # o npm install onnxruntime-web@1.29.0
node proves\motor.test.mjs --models ruta\models_onnx           # mel i VAD
node proves\rnnt.test.mjs --models ruta\models_onnx            # tokens dels trossos sense rescat
node proves\motor_complet.test.mjs --models ruta\models_onnx   # tot el motor amb rescat (reprenible)
node proves\puntua.test.mjs --models ruta\models_onnx          # puntuació i majúscules
```

Resultats (4/11/2026): mel, VAD, tokens, rescat i paraules amb temps idèntics a Python en 41/41
àudios. Puntuació: tokenitzador idèntic; majúscules (UMU) idèntiques; els signes (Softcatalà
`q8pc`, int8 dinàmic) varien una mica entre plataformes, també entre dues instal·lacions de
Python: 1970/2015 paraules iguals i la mateixa qualitat (WER formatat dels clips 13,66 % en tots dos).
