# Models que fa servir subtitols-ca

El codi d'aquest repositori és GPL-3.0 (vegeu `LICENSE` i `NOTICE`). Els models no són
nostres: cadascun té la seua llicència i els seus autors, que cal citar.

| Funció | Model | Autors | Llicència |
|---|---|---|---|
| Reconeixement de veu | [projecte-aina/stt_ca-es_conformer_transducer_large](https://huggingface.co/projecte-aina/stt_ca-es_conformer_transducer_large), convertit a ONNX i amb l'encoder quantitzat a 8 bits | Projecte AINA (Barcelona Supercomputing Center), a partir d'un model de NVIDIA NeMo | CC-BY-4.0 |
| Signes de puntuació | [softcatala/fullstop-catalan-punctuation-prediction](https://huggingface.co/softcatala/fullstop-catalan-punctuation-prediction), convertit a ONNX i quantitzat a 8 bits | Jordi Mas (Softcatalà), basat en [fullstop-deep-punctuation-prediction](https://github.com/oliverguhr/fullstop-deep-punctuation-prediction) | MIT |
| Majúscules | [UMUTeam/catalan_capitalization_punctuation_restoration_int8](https://huggingface.co/UMUTeam/catalan_capitalization_punctuation_restoration_int8) (sense canvis) | UMUTeam, Universidad de Murcia | Apache-2.0 |
| Detecció de veu | [Silero VAD](https://github.com/snakers4/silero-vad) | Silero Team | MIT |

## On es baixen

La web baixa els models de Hugging Face, amb la revisió (commit) fixada a
[`web/js/motor/models.js`](web/js/motor/models.js), i els guarda a la memòria cau del navegador:

| Repositori | Contingut |
|---|---|
| [ferran-artero/stt_ca-es_conformer_transducer_large-onnx](https://huggingface.co/ferran-artero/stt_ca-es_conformer_transducer_large-onnx) | Conformer en ONNX (encoder `q8w` i fp32, `decoder_joint`, espectrograma) i Silero VAD |
| [ferran-artero/fullstop-catalan-punctuation-prediction-onnx](https://huggingface.co/ferran-artero/fullstop-catalan-punctuation-prediction-onnx) | Puntuador de Softcatalà en ONNX (`q8pc` i fp32) |
| [UMUTeam/catalan_capitalization_punctuation_restoration_int8](https://huggingface.co/UMUTeam/catalan_capitalization_punctuation_restoration_int8) | El repositori oficial de la UMU, sense canvis |

Els dos primers es publiquen amb [`eines/models/publica_hf.py`](eines/models/publica_hf.py) i les
fitxes de [`eines/models/fitxes_hf/`](eines/models/fitxes_hf/). Per a canviar un model: pujar-lo,
posar la nova revisió a `models.js` i el navegador el baixarà sol.

## Cites

Majúscules (UMU):

```bibtex
@article{pan2023evaluation,
  title   = {Evaluation of Transformer-Based Models for Punctuation and Capitalization Restoration in Catalan and Galician},
  author  = {Pan, Ronghao and Garc{\'i}a-D{\'i}az, Jos{\'e} Antonio and Vivancos-Vicente, Pedro Jos{\'e} and Valencia-Garc{\'i}a, Rafael},
  journal = {Procesamiento del Lenguaje Natural},
  number  = {70},
  pages   = {27--38},
  year    = {2023},
  doi     = {10.26342/2023-70-2}
}
```

Detecció de veu (Silero):

```bibtex
@misc{SileroVAD,
  author       = {Silero Team},
  title        = {Silero VAD: pre-trained enterprise-grade Voice Activity Detector (VAD), Number Detector and Language Classifier},
  year         = {2024},
  publisher    = {GitHub},
  journal      = {GitHub repository},
  howpublished = {\url{https://github.com/snakers4/silero-vad}}
}
```
