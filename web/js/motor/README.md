# Motor de transcripció (`web/js/motor/`)

El motor de subtitols-ca en JavaScript: àudio a 16 kHz → paraules amb temps, signes i majúscules.
És el port, fitxer a fitxer, del motor de referència en Python (`eines/motor_ref/`), i dona el
mateix resultat (vegeu [`docs/ARQUITECTURA.md`](../../../docs/ARQUITECTURA.md)).

Funciona igual **al navegador** (dins d'un Web Worker) i **a Node** (proves, banc de proves), perquè
cap mòdul no importa onnxruntime: tots reben `ort` com a paràmetre. Per això es pot reutilitzar
fora de la web (transcripció en directe, assistent de veu…) sense tocar-lo.

## Ús des d'una pàgina: el worker

```js
const w = new Worker(new URL("./js/motor/worker.js", import.meta.url), { type: "module" });
w.postMessage({ tipus: "carrega", local: null, fils: 0, gpu: false });   // local: carpeta o null (Hugging Face)
w.postMessage({ tipus: "transcriu", pcm }, [pcm.buffer]);              // Float32Array mono a 16 kHz
w.onmessage = ({ data: m }) => { /* baixada, avis, estat, llest, progres, resultat, error */ };
```

Els missatges són a la secció 4 d'`ARQUITECTURA.md`. Cal que la pàgina estigui aïllada
(COOP/COEP) per fer servir més d'un fil.

## Ús directe (Node o un altre worker)

```js
import * as ort from "onnxruntime-web";          // a Node, també "…/dist/ort.node.min.mjs"
import { llegeixNpy } from "./npy.js";
import { Mel } from "./mel.js";
import { VAD } from "./vad.js";
import { RNNT } from "./rnnt.js";
import { Motor } from "./motor.js";
import { ModelEtiquetes, Puntuador } from "./puntua.js";

const sessio = (bytes) => ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
const motor = new Motor({
  mel: new Mel(llegeixNpy(melFb).dades, llegeixNpy(finestra).dades),
  vad: new VAD(ort, await sessio(silero)),
  rnnt: new RNNT(ort, await sessio(encoder), await sessio(decoderJoint), configJson, tokensTxt.split("\n")),
  puntuador: new Puntuador(                                   // opcional: sense, no hi ha signes ni majúscules
    new ModelEtiquetes(ort, await sessio(softcatala), scTokenizerJson, scConfigJson),   // signes
    new ModelEtiquetes(ort, await sessio(umu), umuTokenizerJson, umuConfigJson)),       // majúscules
});
const r = await motor.transcriu(pcm, (fase, fraccio) => {});  // fase: "vad" | "asr" | "puntuacio"
// r = {durada_s, text, paraules: [{text, ini, fi, cru, punt}], trossos: [...], temps: {..., rtf}}
```

## Mòduls

| Fitxer | Exporta | Fa |
|---|---|---|
| `motor.js` | `Motor`, `forats()`, `ajunta()` | Orquestra VAD → ASR → rescat de frases perdudes → puntuació. `asrTros()` transcriu un sol tros |
| `vad.js` | `VAD`, `PARAMS_VAD`, `SR`, `SEG_FINESTRA` | Silero VAD i tall en trossos (≤ `max_tros`) |
| `mel.js` | `Mel` | Espectrograma log-mel idèntic al de NeMo |
| `rnnt.js` | `RNNT` | Encoder i descodificació *greedy* reprenible, amb penalització del *blank* |
| `paraules.js` | `aParaules()`, `agrupaElisions()`, `neteja()` | Peces SentencePiece → paraules amb temps |
| `puntua.js` | `Puntuador`, `ModelEtiquetes`, `finestres()`, `etiqueta()`, `capitalitza()` | Signes (Softcatalà) i majúscules (UMU) |
| `bpe.js` | `TokenitzadorBPE` | Tokenitzador BPE de byte a partir de `tokenizer.json` |
| `models.js` | `carregaModels()`, `modelsDesats()`, `esborraModels()`, `FITXERS`, `FONTS`, `adreces()` | Baixada amb progrés i Cache API (només navegador) |
| `worker.js` | — | Punt d'entrada del Web Worker |
| `npy.js`, `comu.js` | `llegeixNpy()`, `roundPy()` | Lector de `.npy`; arrodoniment com el de Python |

**Regla:** qualsevol canvi aquí es fa també a `eines/motor_ref/`, i les proves de `proves/`
(igualtat amb Python, 41/41) han de continuar passant.
