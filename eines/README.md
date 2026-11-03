# Eines: preparació dels models

Converteixen els models a ONNX per al navegador. No formen part de la web.
Generen `models_onnx/` a l'arrel del repositori (no es puja a GitHub).

Requisits: Python 3.12 amb `nemo_toolkit[asr]`, `transformers`, `onnx` i `onnxruntime`.

```bash
python eines/onnx_exporta_conformer.py     # Conformer RNNT -> encoder.onnx + decoder_joint.onnx
python eines/onnx_exporta_puntuadors.py    # puntuadors de text (token-classification)
python eines/onnx_baixa_vad.py             # Silero VAD (MIT)
python eines/onnx_requantitza.py           # int8 per canal + embeddings: la versió que fa servir la web
```

Fitxers que fa servir la web: `conformer-ca-es/{encoder,decoder_joint}.int8pc.onnx`,
`{softcatala,umu}/onnx/model_q8pc.onnx` i `silero-vad/silero_vad.onnx` (435 MB en total).

Validació (fase 1): WER 10,2% (PyTorch 9,7%), F1 de puntuació 0,76 (igual que PyTorch),
RTF 0,10 en CPU.