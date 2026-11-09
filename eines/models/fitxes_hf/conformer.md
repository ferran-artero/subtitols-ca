---
language:
- ca
- es
license: cc-by-4.0
library_name: onnx
pipeline_tag: automatic-speech-recognition
base_model: projecte-aina/stt_ca-es_conformer_transducer_large
tags:
- onnx
- catalan
- valencian
- balearic
- conformer
- transducer
- rnnt
- onnxruntime-web
---

# Conformer-Transducer català (Projecte AINA) en ONNX

Conversió a ONNX del model de reconeixement de veu
[projecte-aina/stt_ca-es_conformer_transducer_large](https://huggingface.co/projecte-aina/stt_ca-es_conformer_transducer_large),
preparada per a executar-se **al navegador** amb `onnxruntime-web` (i també amb `onnxruntime` en
Python o Node). És el motor de [subtitols-ca](https://github.com/ferran-artero/subtitols-ca), una
eina oberta que fa subtítols en català dins del navegador.

*ONNX export of the AINA Catalan Conformer-Transducer, for in-browser speech recognition with
onnxruntime-web. Used by [subtitols-ca](https://github.com/ferran-artero/subtitols-ca).*

## Fitxers

| Fitxer | Mida | Què és |
|---|---|---|
| `encoder.q8w.onnx` | 191 MB | Encoder amb els pesos quantitzats a 8 bits (MatMulNBits, blocs de 64); activacions en float32. **És el que fa servir la web.** |
| `encoder.onnx` | 481 MB | Encoder original en float32 |
| `decoder_joint.onnx` | 17 MB | Decoder (LSTM) + joint, en float32: una crida per pas de descodificació |
| `tokens.txt` | | Les 256 peces SentencePiece (el *blank* és l'índex 256) |
| `config.json` | | Paràmetres de l'espectrograma i de la descodificació |
| `mel_fb.npy`, `finestra.npy` | | Banc de filtres mel i finestra de Hann, per a calcular l'espectrograma igual que NeMo |
| `silero-vad/` | 2 MB | [Silero VAD](https://github.com/snakers4/silero-vad) v5 (MIT), la còpia amb què s'ha validat el motor |

## Com es fa servir

- **Entrada de l'encoder:** espectrograma log-mel `[1, 80, T]` (float32) i la llargada `[1]`
  (int64). L'espectrograma: preènfasi 0,97; finestra de Hann de 400 mostres, n_fft 512, salt de
  160 (16 kHz); 80 bandes; `log(x + 2^-24)`; normalització per banda. **Eixida:** `[1, 512, T']`,
  una trama cada 40 ms.
- **`decoder_joint`:** entrades `encoder_outputs` `[1, 512, 1]`, `targets` int32 `[1, 1]`,
  `target_length` int32 `[1]` i els dos estats `[1, 1, 640]`; eixides els logits `[1, 1, 1, 257]` i
  els estats nous.
- **Descodificació *greedy*:** per a cada trama, com a molt 10 símbols; si guanya el *blank*, es
  passa a la trama següent sense canviar ni l'estat ni l'últim token.

Implementacions completes (espectrograma, descodificació, paraules amb temps):
[Python](https://github.com/ferran-artero/subtitols-ca/tree/main/eines/motor_ref) i
[JavaScript](https://github.com/ferran-artero/subtitols-ca/tree/main/web/js/motor). La conversió
és a [`eines/models`](https://github.com/ferran-artero/subtitols-ca/tree/main/eines/models).

## Qualitat

Mesurada amb 38 frases gravades (19 en valencià i 19 en balear) i un vídeo de notícies en balear
amb música (2,8 min):

| | WER 38 frases |
|---|---|
| NeMo → ONNX float32 | 9,9 % |
| Encoder `q8w` (aquest) | 9,4 % – 10,2 % segons la descodificació |

Amb el motor complet de subtitols-ca (detecció de veu, rescat de frases perdudes): 9,4 % a les
frases i 7,0 % al vídeo. Al navegador (WASM amb diversos fils) dona exactament el mateix resultat
que amb `onnxruntime` en Python.

Limitació coneguda: el model normalitza algunes formes dialectals ("varen" → "van").

## Llicència i atribució

El model original és del **Projecte AINA** (Language Technologies Unit, Barcelona Supercomputing
Center), basat en `nvidia/stt_es_conformer_transducer_large`, i té llicència
**[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)**; aquesta conversió en manté la
llicència. **Canvis respecte a l'original:** exportat de NeMo a ONNX en dues peces (encoder i
decoder+joint) i, a `encoder.q8w.onnx`, pesos quantitzats a 8 bits.

Silero VAD (`silero-vad/`) és del Silero Team, amb llicència MIT (vegeu `silero-vad/LICENSE`).

Conversió: Ferran Artero Merino (beca ValgrAI, VRAIN – Universitat Politècnica de València).
