---
language:
- ca
license: mit
library_name: onnx
pipeline_tag: token-classification
base_model: softcatala/fullstop-catalan-punctuation-prediction
tags:
- onnx
- catalan
- punctuation-restoration
- onnxruntime-web
---

# Puntuació en català de Softcatalà, en ONNX

Conversió a ONNX del model
[softcatala/fullstop-catalan-punctuation-prediction](https://huggingface.co/softcatala/fullstop-catalan-punctuation-prediction)
de **Jordi Mas (Softcatalà)**, preparada per a executar-se **al navegador** amb `onnxruntime-web`.
Posa els signes de puntuació a un text sense puntuar, com el que dona un reconeixedor de veu. La
fa servir [subtitols-ca](https://github.com/ferran-artero/subtitols-ca) per als subtítols.

*ONNX export of Softcatalà's Catalan punctuation model, for in-browser use with onnxruntime-web.*

## Fitxers

| Fitxer | Mida | Què és |
|---|---|---|
| `onnx/model_q8pc.onnx` | 127 MB | Quantitzat a int8 per canal, també la taula d'*embeddings*. **És el que fa servir la web.** |
| `onnx/model.onnx` | 479 MB | Float32 |
| `tokenizer.json`, `tokenizer_config.json`, `config.json` | | Tokenitzador i etiquetes (`0 . , ? - :`) |

Entrades: `input_ids` i `attention_mask` (int64, `[1, L]`). Eixida: logits `[1, L, 6]`, un per
token; l'etiqueta d'una paraula és la del seu primer token i indica el signe que va darrere.
subtitols-ca la fa servir per finestres de 120 paraules amb 20 de solapament.

## Qualitat

F1 de puntuació amb 38 frases en valencià i balear: **0,76**, la mateixa que el model original en
PyTorch. El model quantitzat fa servir int8 dinàmic: els logits varien una mica entre plataformes
(navegador i Python), però la qualitat és la mateixa.

## Llicència i atribució

El model original és de **Jordi Mas (Softcatalà)**, basat en
[fullstop-deep-punctuation-prediction](https://github.com/oliverguhr/fullstop-deep-punctuation-prediction),
i té llicència **MIT**; aquesta conversió en manté la llicència i l'atribució. **Canvis:**
exportat a ONNX i quantitzat a 8 bits.

Conversió: Ferran Artero Merino (beca ValgrAI, VRAIN – Universitat Politècnica de València), per a
[subtitols-ca](https://github.com/ferran-artero/subtitols-ca).
