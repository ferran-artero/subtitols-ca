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
