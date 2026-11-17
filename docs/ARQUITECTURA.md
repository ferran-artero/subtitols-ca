# Arquitectura de subtitols-ca

Com està fet per dins el subtitulador: quines peces té, què fa cada fitxer, com es comuniquen,
amb quins algorismes i **què s'ha mesurat per decidir cada cosa**. Pensat perquè qualsevol
persona (o agent de codi) pugui llegir el codi sabent on és cada cosa i per què és així.

Les normes per treballar-hi són a [`AGENTS.md`](../AGENTS.md); els models i les llicències, a
[`MODELS.md`](../MODELS.md).

**Tecnologia:** JavaScript en mòduls ES, sense *framework* ni empaquetador · onnxruntime-web
1.29.0 (WASM amb fils) · Web Worker + Cache API · GitHub Pages + Hugging Face · Python (numpy +
onnxruntime + tokenizers) com a motor de referència.

---

## 1. Visió general

No hi ha *backend*. Dos servidors estàtics entreguen fitxers, i tot el càlcul passa al dispositiu
de l'usuari, repartit entre el fil principal de la pàgina i un Web Worker.

```
 GitHub Pages (web/)                         Hugging Face (5 models ONNX, ≈ 463 MB, revisió fixada)
        │ GET, una vegada per versió                 │ fetch la primera vegada; després, Cache API
        ▼                                            ▼
┌─────────────────────────── Navegador de l'usuari ───────────────────────────┐
│  coi-serviceworker.js: COOP/COEP → pàgina aïllada → WASM amb diversos fils   │
│                                                                              │
│  Fil principal                              Web Worker (js/motor/)           │
│  interficie.js · transcriu.js               worker.js · models.js · motor.js │
│  audio.js · mp4.js            postMessage   vad.js · mel.js · rnnt.js        │
│  previsualitza.js · subtitols.js  ◄──────►  paraules.js · puntua.js · bpe.js │
│  (PCM transferit cap al worker;             onnxruntime-web (WASM, SIMD,     │
│   progrés i resultat de tornada)            N fils; opcionalment WebGPU)     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### El camí d'una transcripció

| Pas | Fitxer | Transformació | On |
|---|---|---|---|
| 1 | `audio.js` | `File` → `Float32Array` PCM mono a 16 kHz | Fil principal |
| 2 | `motor/vad.js` | PCM → `probs` (una cada 32 ms) → `trossos[{ini, fi, propi_ini, propi_fi, forcat}]` | Worker |
| 3 | `motor/mel.js` | tros de PCM → log-mel `[80 × T]`, una trama cada 10 ms | Worker |
| 4 | `motor/rnnt.js` | mel → encoder `[T′ × 512]` (40 ms) → `ids[]` i `trames[]` | Worker |
| 5 | `motor/paraules.js` | tokens → `paraules[{text, ini, fi}]` | Worker |
| 6 | `motor/motor.js` | detecta forats, rescata i ajunta els trossos | Worker |
| 7 | `motor/puntua.js` | totes les paraules → `{cru, punt}` i majúscules a `text` | Worker |
| 8 | `subtitols.js` | paraules + paràmetres → `cues[{ini, fi, linies, paraules}]` → SRT, VTT, TXT | Fil principal |

La segmentació (pas 8) és una funció pura de 2–7 ms: canviar un ajust només torna a segmentar, no
torna a transcriure.

---

## 2. Mapa del repositori

Cada mòdul del motor JS és el port d'un fitxer de Python amb el mateix nom.

| Fitxer | Responsabilitat |
|---|---|
| **`web/`** | **El que es publica a GitHub Pages** |
| `index.html` | Les dues pantalles (inici i taller); dos scripts en línia: tema i registre del service worker |
| `css/estil.css` | Tot l'estil; l'estat de la pàgina es resol amb selectors sobre `body[data-estat]` |
| `coi-serviceworker.js` | Afegeix COOP/COEP/CORP a les respostes del mateix origen |
| `fonts/` | Inter (OFL), servida des del mateix origen |
| `js/interficie.js` | Tema, arrossegar fitxers, estat de la pàgina, desplegables, `nota()` |
| `js/transcriu.js` | Crea el worker, en gestiona els missatges, pinta el progrés i emet `transcripcio` |
| `js/audio.js` | Descodifica i re-mostreja amb Web Audio; aplica la llista d'edició dels MP4 |
| `js/mp4.js` | Analitza les caixes MP4 fins a `edts/elst` |
| `js/previsualitza.js` | Formulari → segmentació en viu, capa sobre el vídeo, llista, correccions, cerca, sessió, baixades |
| `js/subtitols.js` | Segmentació per programació dinàmica i SRT/VTT/TXT. Sense dependències |
| `js/vendor/ort/` | onnxruntime-web 1.29.0, servit des del mateix origen |
| **`web/js/motor/`** | **El motor, dins del worker** (vegeu [`web/js/motor/README.md`](../web/js/motor/README.md)) |
| `worker.js` | Punt d'entrada: crea les sessions ONNX i munta el `Motor` |
| `models.js` | Adreces i revisions, baixada amb progrés, Cache API |
| `motor.js` | Orquestra VAD → ASR → rescat → puntuació; `forats()`, `ajunta()` |
| `vad.js` | Silero VAD i tall en trossos |
| `mel.js` | Espectrograma log-mel amb FFT pròpia |
| `rnnt.js` | Encoder i bucle de descodificació *greedy* reprenible |
| `paraules.js` | Peces SentencePiece → paraules amb temps; elisions |
| `puntua.js` | Finestres, classificació de tokens i combinació dels dos models |
| `bpe.js` | Tokenitzador BPE a nivell de byte, a partir de `tokenizer.json` |
| `npy.js`, `comu.js` | Lector de `.npy`; `roundPy()`, que imita el `round` de Python |
| **`eines/`** | **Python, no es publica** |
| `motor_ref/` | Motor de referència: `audio, vad, mel, rnnt, paraules, puntua, motor, subtitols` |
| `transcriu.py` | Línia d'ordres: àudio o JSON → JSON + SRT/VTT/TXT |
| `serveix.py` | Servidor local de `web/` amb els models a `/models_onnx/` (i del banc de proves) |
| `models/` | Exportar a ONNX, quantitzar, baixar VAD i UMU, publicar a Hugging Face |
| **`proves/`** | **Validació** |
| `*.py`, `*.test.mjs` | Generen referències amb Python i les comparen amb el JS executat a Node |
| `avalua.py` | Mètriques contra les referències humanes (WER, WER formatat, F1, frases perdudes, sincronia) |
| `banc/` | Banc de proves del motor JS a Node i al navegador (temps per etapa, configuracions) |

---

## 3. Arrencada, aïllament i fils

onnxruntime-web només pot fer servir diversos fils si la pàgina està aïllada
(`crossOriginIsolated`), i això exigeix dues capçaleres HTTP que GitHub Pages no deixa configurar.

1. Un script en línia a `index.html` comprova `window.crossOriginIsolated`. Si és fals, registra
   `coi-serviceworker.js` i recarrega la pàgina una sola vegada (marca a `sessionStorage` per no
   entrar en bucle).
2. El service worker intercepta les peticions del mateix origen i hi afegeix
   `Cross-Origin-Embedder-Policy: require-corp` i `Cross-Origin-Opener-Policy: same-origin`.
3. Amb la pàgina aïllada hi ha `SharedArrayBuffer`, i el WASM d'onnxruntime pot crear fils.

- **onnxruntime va dins del repositori** (`js/vendor/ort/`) perquè els fils són Web Workers, i un
  worker no es pot crear des d'un altre domini (una CDN).
- **Quants fils:** sense aïllament, 1. Al PC, tots els nuclis. Al mòbil, la meitat: onnxruntime
  reparteix cada operació a parts iguals i els nuclis ràpids acaben esperant els lents. Màxim 16.
  Es pot forçar amb `?fils=N`.

```js
const nuclis = navigator.hardwareConcurrency || 4;
const perDefecte = mobil ? Math.max(1, Math.floor(nuclis / 2)) : nuclis;
const fils = !self.crossOriginIsolated ? 1 : Math.max(1, Math.min(filsDemanats || perDefecte, 16));
```

---

## 4. La pàgina i el worker

El motor sencer viu en un Web Worker de tipus mòdul. La pàgina només li envia dos missatges.

| Sentit | Missatge | Contingut | Quan |
|---|---|---|---|
| pàgina → worker | `carrega` | `{local, fils, gpu}` | En triar el fitxer (si els models ja són a la cau) o en prémer «Transcriu» |
| pàgina → worker | `transcriu` | `{pcm}`, amb el `buffer` transferit (sense còpia) | Quan l'àudio ja està descodificat |
| worker → pàgina | `baixada` | `{rebut, total, fitxer}` en bytes | Mentre es baixen models |
| worker → pàgina | `estat`, `avis` | `{text}` | Canvis de fase; avís si no hi ha espai per desar els models |
| worker → pàgina | `llest` | `{fils, gpu, aillat, baixat, segons}` | Sessions creades |
| worker → pàgina | `progres` | `{fase: "vad" \| "asr" \| "puntuacio", f}` | Durant la transcripció |
| worker → pàgina | `resultat` | `{resultat}`: el JSON del motor | En acabar |
| worker → pàgina | `error` | `{missatge, pila}` | Qualsevol excepció |

- **L'àudio es descodifica al fil principal** perquè `AudioContext` no existeix als workers.
- **Cancel·lar és `worker.terminate()`:** es mata el worker i el següent ús en crea un de nou, que
  torna a llegir els models de la cau.
- **La barra de progrés** reparteix el total en 3 % per al VAD, 92 % per a l'ASR i la resta per a
  la puntuació.
- **Tots els mòduls del motor reben `ort` com a paràmetre** en lloc d'importar-lo: el mateix codi
  funciona al navegador i a Node, on corren les proves.

---

## 5. Els models

Cinc grafs ONNX. L'espectrograma i els tokenitzadors no van dins de cap graf: estan escrits a mà.

| Fitxer | Mida | Entrades | Sortides | Precisió |
|---|---|---|---|---|
| `encoder.q8w.onnx` | 191 MB | mel `[1, 80, T]` f32, llargada `[1]` i64 | `[1, 512, T′]`, T′ ≈ T/4 | Pesos de les MatMul a 8 bits (MatMulNBits, blocs de 64); activacions f32 |
| `decoder_joint.onnx` | 17 MB | trama `[1, 512, 1]`, últim token `[1, 1]` i32, `target_length` `[1]` i32, 2 estats LSTM `[1, 1, 640]` | logits `[1, 1, 1, 257]` i els 2 estats nous | f32 |
| `silero_vad.onnx` | 2 MB | `[1, 576]` (64 de context + 512), estat `[2, 1, 128]`, sr | probabilitat i estat nou | f32 |
| `softcatala/onnx/model_q8pc.onnx` | 127 MB | `input_ids`, `attention_mask` `[1, L]` i64 | logits `[1, L, 6]`: `0 . , ? - :` | int8 per canal, inclosa la taula d'*embeddings* |
| `umu/model.onnx` | 126 MB | igual | logits `[1, L, 12]`: signe × majúscula/minúscula | int8 oficial de la UMU |

### Com es generen (`eines/models/`)

1. `exporta_conformer.py`: NeMo exporta el transductor en dues peces (`encoder.onnx` i
   `decoder_joint.onnx`) i desa `tokens.txt` (256 peces SentencePiece), `config.json`, el banc de
   filtres mel (`mel_fb.npy`) i la finestra de Hann (`finestra.npy`).
2. `exporta_puntuadors.py`: exporta Softcatalà des de `transformers`, **en mode `.eval()`** (sense,
   el *dropout* quedava actiu i els logits diferien 0,12), i comprova que coincideix amb PyTorch.
3. `quantitza.py`: produeix les variants que baixa la web.
4. `baixa_vad.py`, `baixa_umu.py`: baixen Silero i l'int8 oficial de la UMU.
5. `publica_hf.py`: puja els dos repositoris propis i n'escriu les revisions.

### Com es carreguen (`web/js/motor/models.js`)

- **Revisió fixada per repositori** (`REVISIONS`). La memòria cau va per adreça
  (`caches.open("subtitols-ca-models-v1")`), i una adreça amb el *commit* no canvia mai de
  contingut: no cal cap lògica d'invalidació. Canviar de model = pujar-lo i canviar la revisió.
- **La baixada** demana primer les mides amb `HEAD`, llegeix cada resposta amb `getReader()` per
  informar del progrés i desa amb `cache.put()`. Si no hi ha espai, avisa i continua sense desar.
- **`modelsDesats()`** diu si tot ja és a la cau: la pàgina decideix si prepara el motor en triar el
  fitxer o espera «Transcriu» (no baixa 460 MB sense avisar).
- La pàgina demana `navigator.storage.persist()`.
- En local, `?models=hf` força Hugging Face i `?models=carpeta` fa servir una altra carpeta.

---

## 6. El motor, pas a pas

Cada apartat correspon a un fitxer de `web/js/motor/` i al seu bessó d'`eines/motor_ref/`.

### 6.1 Lectura de l'àudio (`js/audio.js`, `js/mp4.js`; Python: `audio.py`)

- Navegador: `OfflineAudioContext(…, 16000).decodeAudioData()` descodifica qualsevol format que el
  navegador conegui i el re-mostreja; els canals es fan mono per mitjana.
- Python: wav/flac/ogg/mp3 amb `soundfile` + `soxr` HQ (idèntic a librosa); la resta amb ffmpeg
  (`imageio_ffmpeg`).
- **Correcció dels MP4.** Els codificadors AAC posen mostres de preparació al principi, i la llista
  d'edició (`moov/trak/edts/elst`) diu que se les salti. El `<video>` ho fa; el `decodeAudioData`
  de Chrome, no: l'àudio quedava 0,115 s endarrerit. `mp4.js` llegeix les caixes i
  `aplicaEdicio()` salta les mostres només si dedueix, per la durada, que el navegador no ho ha fet
  (desfasament amb Python: +0,112 s → −0,008 s). Comprovat a Chrome.

### 6.2 Detecció de veu i tall en trossos (`vad.js`)

Silero VAD v5: finestres de 512 mostres (32 ms) amb 64 de context i un estat `[2, 1, 128]`. La
probabilitat de cada finestra es guarda perquè el rescat la torna a fer servir.

| Paràmetre | Valor | Efecte |
|---|---|---|
| `llindar` | 0,5 | Entra en veu a ≥ 0,5 i en surt per sota de 0,35 (histèresi) |
| `silenci_min` | 0,30 s | Silenci necessari per tancar un segment |
| `veu_min` | 0,25 s | Els segments més curts es descarten |
| `marge` | 0,20 s | S'afegeix a cada costat; els segments que es toquen es fusionen |
| `ajunta_si_silenci` | 2,0 s | Dos segments separats per menys s'ajunten, si el total no passa de `max_tros` |
| `max_tros` | 25 s | Llargada màxima d'un tros per a l'ASR |
| `solap` | 1,0 s | Solapament entre trossos d'un tall forçat |
| `extensio` | 0,5 s | Silenci de context a les vores (fins a la meitat del buit amb el veí) |

- **Tall forçat:** un segment de més de `max_tros` es parteix pel punt de probabilitat mínima
  entre el 60 % i el 100 % de `max_tros`. Els dos trossos se solapen 1 s, però cadascun té una
  **zona pròpia** (`propi_ini`, `propi_fi`): una paraula és del tros on cau el seu centre.
  `ajunta()` elimina el duplicat que pugui quedar a la frontera i n'ajusta els temps.
- **Extensió de 0,5 s:** sense silenci de context el model al·lucinava («Keith Ken»); amb 1 s era
  pitjor.

### 6.3 Espectrograma log-mel (`mel.js`)

1. Preèmfasi: `y[n] = x[n] − 0,97·x[n−1]`.
2. STFT amb `n_fft` 512, finestra de Hann de 400 mostres (`periodic=False`) centrada, salt de 160
   (10 ms) i farciment de zeros (`center=True`).
3. Potència, 80 filtres mel (`mel_fb.npy`), `log(x + 2⁻²⁴)`.
4. Normalització per banda amb mitjana i desviació típica (n−1) + 1e-5 de les trames vàlides.
   Trames = 1 + N//160, de les quals N//160 són vàlides.

Diferència amb NeMo: 2,5·10⁻⁵ (Python). La FFT de JS és una radix-2 pròpia; els passos intermedis
passen per `Math.fround()` per reproduir els 32 bits. Diferència JS–Python: 4·10⁻⁶.

### 6.4 Encoder i descodificació RNNT (`rnnt.js`)

L'encoder redueix la resolució per quatre: una trama de 512 dimensions cada 40 ms. La sortida es
transposa una sola vegada a `[T′, 512]` perquè el bucle passi cada trama amb `subarray()`, sense
còpies.

```js
for (let t = inici; t < T; t++) {
  punts.push({ n: ids.length, ultim, s1, s2 });        // estat a l'inici de la trama: permet reprendre
  const p = Math.fround(pt(t));                        // penalització del blank en aquesta trama
  for (let s = 0; s < this.maxSimbols; s++) {          // com a molt 10 símbols per trama
    const out = await this.dec.run(ent);
    // argmax amb el logit del blank menys p
    if (k === this.blank) break;                       // trama següent; ni estats ni últim token canvien
    ids.push(k); trames.push(t); ultim = k; s1 = out[nO1]; s2 = out[nO2];
  }
}
```

- **Vocabulari:** 256 peces SentencePiece; l'índex 256 és el *blank*; l'última etiqueta inicial és
  el *blank*. Sense model de llengua ni cerca en feix.
- **`penal`** pot ser un número o un vector amb un valor per trama; es resta al logit del *blank*.
  És el mecanisme del rescat.
- **Descodificació reprenible:** la decisió a cada trama només depèn de les anteriors, així que es
  pot continuar des de la trama `t` amb l'estat desat a `punts[t]` i el resultat és idèntic,
  sempre que la penalització no hagi canviat abans de `t` (−7–10 % de crides als vídeos amb música).
- **Cost:** ≈ 1,4 ms per crida al decoder, quasi tot dins d'onnxruntime. L'encoder és el 85–90 %
  del temps de l'ASR.

### 6.5 De tokens a paraules (`paraules.js`)

Una peça que comença per `▁` obre paraula. `ini` = trama del primer token × 0,04 s; `fi` = (última
trama + 1) × 0,04 s. Se salta `<unk>`. Es reparen dos defectes del model:
- s'ajunten les paraules que acaben o comencen amb `'`, `’` o `-` (`l'` + `actor`);
- lletres soltes sense apòstrof: `l d m t s n` com a prefix davant de vocal o h (excepte
  `a i o u e`), i `l m t s n` com a sufix darrere de paraula acabada en vocal (`l hotel` → `l'hotel`).

### 6.6 Orquestració i rescat de frases perdudes (`motor.js`)

**El problema:** el model es va entrenar amb clips de com a molt 15 s. En trossos llargs o amb
música, de vegades emet *blank* amb molta seguretat durant segons i es menja frases senceres
(NeMo original fa el mateix). Exemple diagnosticat: «d'una conversa telefònica» (Daniel Sancho,
2:00), amb VAD = 1,0 i el *blank* guanyant per 6–27 punts: en el tros de 26,8 s es perd; en una
finestra de 10 s es recupera amb penalització; en una de 5 s, perfecta.

Un **forat** és un interval dins de la zona pròpia, sense paraules, de ≥ 0,7 s, on ≥ 75 % de les
finestres del VAD tenen probabilitat ≥ 0,5.

```js
const FORAT = 0.7, VEU_FRAC = 0.75, VEU_LLINDAR = 0.5, PENAL = 2.0, PENAL_MAX = 4.0, MARGE = 0.2;
const FINESTRES = [1.0, 2.0, 0.5, 3.0];
```

| Etapa | Què fa | Cost |
|---|---|---|
| 1 · Tros sencer | Torna a descodificar tot el tros amb penalització 2. Recupera també les paraules soltes del voltant | Només el decoder |
| 2 · Finestra curta | Per a cada forat que queda, torna a passar per l'encoder `[a−m, b+m]` amb m = 1, 2, 0,5, 3 s, i descodifica amb penalització 0 i 2. Només paraules amb el centre dins de `[a, b)`, sense repetir la veïna. Guanya la primera opció que tanca el forat; si cap, la que hi posa més paraules | Fins a 4 passades d'encoder per forat: **37–57 % del temps als vídeos amb música** |
| 3 · Escalada | Si encara queda forat, penalització 3 i 4 només dins del forat (± 0,2 s), reprenent des de la primera trama que canvia. Les paraules de l'etapa 2 tenen preferència | Només el decoder, parcial |

**Per què aquest disseny** (iteracions a `HISTORIA`, fora del repositori):
- Penalització fixa 2 a tot arreu: vídeo 13,3 % → 7,9 %, però clips nets 9,4 % → 10,2 % (inventa
  paraules). Descartada.
- Penalització només dins del forat: no recupera les paraules soltes del voltant (9,2 %).
- Al disseny final: **als 38 clips nets no s'activa mai** (text idèntic paraula per paraula); fora
  dels forats no canvia res; si la finestra no troba res, no s'afegeix res.

### 6.7 Puntuació i majúscules (`puntua.js`, `bpe.js`)

- **Cascada de dos models:** els signes i els inicis de frase són de Softcatalà; de la UMU només
  s'agafen les majúscules de dins de frase (noms propis). Mesurat: Softcatalà és millor amb els
  signes i la UMU amb les majúscules.
- **Noms «fiables»:** si un nom queda a inici de frase segons la UMU però no segons Softcatalà, es
  perdia la majúscula («novetats: daniel Sancho»). Ara, si la UMU ha escrit aquella paraula amb
  majúscula a mig de frase en algun altre lloc del text, es posa sempre en majúscula.
- **Sobre el text sencer**, no per trossos d'àudio (una frase pot quedar partida entre dos trossos).
- **Finestres** de 120 paraules que avancen de 100 en 100; de cada finestra es guarda la part
  central. Codificació `[<s>] + tokens(" " + paraula)… + [</s>]`; etiqueta del primer subtoken.
  Només es passen les entrades que declara cada model. Punt final al final del text.
- **Etiquetes:** Softcatalà `0 . , ? - :`; UMU `l u ?u ?l !u !l ,u ,l .u .l :u :l`.
- **`bpe.js`:** BPE a nivell de byte (estil RoBERTa) a partir del `tokenizer.json`, sense
  transformers.js; ids idèntics a `tokenizers` en 657/657 casos per model.

### 6.8 El resultat: el JSON del motor

```json
{
  "durada_s": 168.704,
  "text": "Bon dia a tothom, avui us vull parlar…",
  "paraules": [
    { "text": "Bon", "ini": 0.4, "fi": 0.56, "cru": "bon", "punt": null },
    { "text": "tothom", "ini": 0.98, "fi": 1.44, "cru": "tothom", "punt": "," }
  ],
  "trossos": [
    { "ini": 0.0, "fi": 24.9, "forcat": true, "propi": [0.0, 24.1], "ids": [], "trames": [],
      "rescat": [ { "forat": [12.4, 14.1], "penal": 2, "abast": "finestra", "marge": 1, "paraules": 4 } ] }
  ],
  "temps": { "total": 41.2, "rtf": 0.2442 }
}
```

Valors il·lustratius; l'estructura és la real. `trossos` serveix per depurar i per a les proves.
Les paraules corregides a la interfície porten `corregida: true`.

---

## 7. Segmentació (`js/subtitols.js`; Python: `subtitols.py`)

Funció pura: rep paraules i paràmetres i torna subtítols. **No toca mai el text.** Escrita en
Python sense biblioteques i portada tal qual a JS (segmentar 3 min tarda < 0,1 s en Python i 2–7 ms
en JS).

És una partició òptima per programació dinàmica: `millor[j]` és el cost mínim de segmentar les
`j` primeres paraules; per a cada `i` es proven tots els subtítols `[i, j)` fins que es passen de
caràcters, paraules o durada.

| Terme | Pes | Quan |
|---|---|---|
| **Cost de tallar després d'una paraula** (`costTall`) | | |
| Signe de final de frase | 0 | `. ? ! …` |
| Signe feble | +0,6 | `, : ; -` |
| Cap signe | +2,0 | |
| Paraula funcional | +3,0 | Article, preposició, auxiliar; inclou l'article salat |
| Unitat partida | +2,5 | Dins d'un número o d'un nom propi |
| Pausa després | fins a −1,5 | Proporcional a la pausa, saturant a `pausa` (0,5 s) |
| **Cost d'un subtítol** (`costSubtitol`) | | |
| Base | +1,0 | Per subtítol: afavoreix fer-ne menys |
| Salt de línia | variable | Mateixes regles de tall + equilibri entre línies |
| Final de frase a dins | +1,2 | Per cada frase que acaba a mig subtítol |
| Pausa a dins | +1,5 | Per cada pausa ≥ `pausa` |
| Massa curt | fins a +1,0 | < 35 % de la capacitat i sense signe al final |
| Massa ràpid | +0,4 per car/s | Per damunt de `max_cps` (suau: no prohibeix) |
| Massa breu en pantalla | fins a +1,0 | Per sota de `durada_min` |

- **Restriccions dures:** caràcters per línia, línies, paraules màximes i `durada_max`.
- **`temps()`** ajusta inici i fi: cua, durada mínima, enganxar al següent si el buit és petit,
  separació mínima i `desfas`.
- **`expandeix()`**: un subtítol per paraula quan hi ha ressaltat (`paraula`, `progres`,
  `acumula`), amb `<u>`, `<b>`, `<i>`, `<font color>` a l'SRT i `::cue(.r)` al VTT (`fons`, només
  VTT).

| Perfil | Línies × car. | car/s (suau) | Durada | Buit mínim / enganxa |
|---|---|---|---|---|
| `horitzontal` | 2 × 42 | 17 | 1–7 s | 0,08 / 0,5 s |
| `vertical` (Reels, TikTok) | 1 × 22 | 22 | 0,5–3 s | 0 / 1 s |
| `accessibilitat` («Lectura pausada») | 2 × 37 | 13 | 1,5–7 s | 0,08 / 0,8 s |

**Compatibilitat amb editors:** Premiere importa l'SRT i respecta `<u>`; Film Craft amaga les
etiquetes però no les aplica (allà només serveix `acumula`). Falta provar `<b>`, `<i>`, colors i el
VTT a Premiere i CapCut. L'estil (font, mida, posició, color) no va a l'SRT: es posa a l'editor.

---

## 8. La interfície

Tres mòduls que no s'importen entre ells (tret de `nota()`) i que es coordinen amb esdeveniments
del DOM. No hi ha magatzem d'estat ni biblioteques.

- **Disseny:** paleta de la UPV (barra `#3F4444`, accent `#D73333`, text `#111111`, secundari
  `#5B5B5B`, fons `#F5F3EE`), Inter, tema clar/fosc (`html[data-tema]`, posat abans de pintar),
  una columna per sota de 980 px.
- **Estat:** `body[data-estat]` = `inici` (zona per arrossegar o triar) → `taller` (fitxer triat;
  «Transcriu») → `fet` (hi ha subtítols; «Baixa SRT» + desplegable VTT/TXT/JSON). El CSS decideix
  què es veu; «Cancel·la» surt amb un selector sobre `#b-cancel:not([hidden])`.

| Esdeveniment | L'emet | L'escolten | Dades |
|---|---|---|---|
| `change` a `#f-video` | L'usuari, o `interficie.js` en deixar anar un fitxer | Els tres mòduls | El `File` |
| `change` a `#f-json` | Igual | `previsualitza.js` | Una transcripció desada |
| `transcripcio` | `transcriu.js` | `previsualitza.js` | `{resultat, nom}` |
| `subtitols` | `previsualitza.js`, cada vegada que pinta la llista | `interficie.js` | `{nombre, nom}` |
| `input` a `#params` | L'usuari | `previsualitza.js` | Torna a segmentar |

Arrossegar un fitxer el posa a l'`<input>` amb un `DataTransfer` i dispara `change`: un sol camí
d'entrada.

### Model de dades i correccions (`previsualitza.js`)

- **Font de veritat:** `doc` (el JSON del motor) i `paraules = doc.paraules`. Els subtítols són
  sempre derivats (`S.segmenta(paraules, P)`).
- **Es corregeixen paraules, no subtítols:** una correcció sobreviu a qualsevol canvi de format.
  Mateix nombre de paraules → mateixos temps; si canvia, el temps es reparteix per caràcters.
  `doc.text` s'actualitza.
- **Desfer:** tots els canvis passen per `corregeix([{i, n, noves}])`; la pila `desfets` guarda
  cada operació sencera («substitueix-ho tot» és una sola operació).
- **Cerca i substitueix:** paraules senceres, una o diverses de seguides, sense distingir
  majúscules, conservant el signe i la majúscula inicial; navegació entre coincidències.
- **Clic en una paraula** (`span.p`) → el vídeo hi salta.
- **Capa sobre el vídeo:** a cada fotograma (`requestVideoFrameCallback`) es busca el subtítol actiu
  per cerca binària i es pinta en un `<div>` damunt del `<video>`.
- **Format automàtic:** en carregar un vídeo, vertical → perfil `vertical` (i a l'inrevés).

| Clau | On | Què guarda |
|---|---|---|
| `subtitols-ca.tema` | localStorage | Tema, només si difereix del del sistema |
| `subtitols-ca.params` | localStorage | Perfil i ajustos de segmentació |
| `subtitols-ca.vista` | localStorage | Mida i fons del text a la previsualització (no va al fitxer) |
| `subtitols-ca.sessio` | localStorage | `{nom, doc}`: la transcripció amb les correccions («Continua» / «Descarta-la») |
| `subtitols-ca-models-v1` | Cache API | Els models |
| `coi-recarregada` | sessionStorage | Evita recarregar en bucle en registrar el service worker |

---

## 9. Com es garanteix que JavaScript dona el mateix que Python

La recepta es va validar primer en Python contra NeMo, i el port a JS es va fer peça a peça sobre
41 àudios (38 clips i 3 vídeos).

1. `proves/referencia_motor.py` executa el motor de Python i desa cada pas: àudio, probabilitats
   del VAD, espectrograma de cada tros, tokens, passos del rescat i paraules.
2. Els `*.test.mjs` executen els mateixos mòduls de `web/js/` a Node, amb onnxruntime-web
   injectat, i comparen.

| Prova | Compara | Resultat |
|---|---|---|
| `subtitols.test.mjs` | SRT, VTT i TXT de 3 vídeos × 3 perfils × 12 combinacions | 108/108 idèntics |
| `motor.test.mjs` | Espectrograma i trossos del VAD | Dif. 4·10⁻⁶; 41/41 |
| `rnnt.test.mjs` | Tokens i trames de cada tros | Idèntics |
| `motor_complet.test.mjs` | Tokens, cada pas del rescat i cada paraula amb inici i fi | 41/41 idèntics |
| `puntua.test.mjs` | Ids del tokenitzador, majúscules i signes | Signes: 1.970/2.015 |

| Símptoma | Causa | Solució |
|---|---|---|
| Temps diferents en 1 ms | `round(x, 3)` de Python arrodoneix els empats al parell | `roundPy()` ho imita (0 errors en 88.000 valors) |
| Paraules partides («e ix e») | `tokens.txt` amb finals de línia de Windows | `rnnt.js` treu el `\r` |
| Espectrograma lleugerament diferent | JS calcula en 64 bits | `Math.fround()` als passos intermedis |
| Probabilitats del VAD absurdes a les proves | Node reaprofita memòria en fitxers petits | Llegir el `.npy` amb el seu desplaçament |

**Excepcions inevitables:**
- **Signes:** Softcatalà `q8pc` és int8 dinàmic, i aquesta aritmètica dona logits lleugerament
  diferents a cada plataforma (fins a 0,63), també entre dues instal·lacions de Python. La qualitat
  és la mateixa (taula de la secció 10). Si calgués igualtat exacta: quantitzar només els pesos,
  com l'encoder.
- **Àudio al navegador:** el re-mostrejador no és `soxr` (SNR 37 dB en un WAV) i el descodificador
  AAC no és el de ffmpeg. Canvia alguna paraula sense empitjorar el WER.

---

## 10. Què s'ha mesurat per decidir-ho

### 10.1 Dades i mètriques (`proves/avalua.py`)

- **38 clips** gravats per l'autor (19 en valencià i 19 en balear; categories: lèxic, noms propis,
  verbs, missatges informals i frases comunes), amb referència puntuada (`referencies.tsv`).
- **Vídeo `017_Daniel Sancho`:** 2,8 min, balear, notícies amb música. Referència: 180 subtítols
  (OCR corregit) i 631 paraules amb els números en lletres.
- **Vídeos sense referència:** `prova_raquel_apunt` i `prova_anamfent` (vlog amb música, cançons i
  mescla d'idiomes).
- Les dades no són al repositori (són gravacions personals); els scripts les llegeixen de
  `--dades` o de `SUBTITOLS_DADES`.

| Mètrica | Definició |
|---|---|
| WER | Normalitzat: minúscules, sense signes, apòstrofs i `l·l` unificats |
| WER formatat | Cada signe és un token i es mantenen les majúscules |
| F1 de puntuació / de majúscules | Classe exacta del signe; majúscula sí/no |
| Frases perdudes | ≥ 3 paraules seguides de la referència eliminades |
| Sincronia | Inici de la paraula al motor − inici del subtítol de referència |
| RTF | Temps de càlcul / durada de l'àudio (mediana) |

### 10.2 Decisions

| Decisió | Alternatives | Motiu (mesurat) |
|---|---|---|
| ASR: Conformer-Transducer ca-es (AINA) | Whisper de la Catalan ASR Arena (alguns, amb faster-whisper) | Millor WER als 38 clips; no al·lucina; dona el temps de cada paraula; prou petit per al navegador |
| Descodificació *greedy* (`max_symbols` 10) | KenLM + cerca en feix | Guany esperat petit i motor molt més complex al navegador |
| Puntuació en cascada: Softcatalà (signes) + UMU (majúscules) | Un sol model; reentrenar el Conformer | Softcatalà millor amb els signes, UMU amb les majúscules; reentrenar demana dades i GPU |
| Tot al navegador | Servidor local o `.bat` | Sense instal·lació, multiplataforma, privat i gratuït |
| Encoder `q8w` | fp32 (481 MB), int8 dinàmic, int8 per canal, `q4w` (148 MB) | L'int8 dinàmic perdia frases senceres; `q4w` perdia qualitat |
| `decoder_joint` en fp32 | `q8w` | En MatMulNBits anava 5 vegades més lent (matrius petites, milers de crides) |
| Softcatalà `q8pc` (127 MB) | fp32 (≈ 500 MB) | Mateixa F1 que l'original |
| Majúscules: int8 oficial de la UMU | La nostra quantització | Ho van demanar; resultat idèntic als 38 clips i al vídeo |
| Rescat en 3 etapes | Penalització fixa; només dins del forat | Secció 6.6 |
| Àudio Python: `soundfile` + `soxr` | librosa; tot amb ffmpeg | Idèntic a librosa i més lleuger; amb ffmpeg el WER formatat empitjorava (13,66 → 13,8–14,0 %) |
| WASM amb tots els nuclis | WebGPU | Exacte i tan ràpid com Python; la WebGPU amb gràfica integrada anava més lenta i al mòbil petava |
| Mòbil: la meitat dels nuclis | Tots | Galaxy A52s: 8 fils 58 s, **4 fils 30 s**, 2 fils 41 s |

### 10.3 Resultats de qualitat (motor de referència)

| Configuració | WER clips | WER vídeo | WER formatat vídeo | F1 punt. vídeo | F1 maj. vídeo | Perdudes |
|---|---|---|---|---|---|---|
| Fase 1: onnx fp32 / int8 / int8pc | 9,9 / 10,4 / 10,2 % | – | – | 0,76 (clips) | – | – |
| Sense rescat (`q8w`) | 9,4 % | 13,3 % | 19,4 % | 0,67 | 0,87 | 4 |
| Penalització 2 fixa | 10,2 % | 7,9 % | 12,6 % | 0,78 | 0,90 | 1 |
| **Final** (rescat en 3 etapes + UMU oficial) | **9,4 %** | **7,0 %** | **11,7 %** | **0,78** | **0,91** | **0** |

- 38 clips (final): WER formatat 14,0 %, F1 de puntuació 0,76, F1 de majúscules 0,90.
- Sincronia: +0,08 s de mediana (p10..p90: +0,01..+0,14).

| Python → JS | WER formatat | F1 signes | F1 majúscules |
|---|---|---|---|
| 38 clips | 13,66 % → 13,66 % | 0,807 → 0,803 | 0,867 → 0,875 |
| Daniel Sancho | 14,14 % → 14,29 % | 0,780 → 0,780 | 0,903 → 0,902 |

Àudio del navegador (`decodeAudioData`) en lloc de `soxr`: clips WER 9,36 → 9,01 %; Daniel 6,97 →
7,29 % (2 paraules).

**Errors que queden** (del model, no del motor): «varen» → «van» (8 al vídeo), «idò»,
«vosaltres» → «voltros», noms estrangers («Koh Phangan») i paraules curtes inserides.

### 10.4 Rendiment

| | 38 clips (RTF) | Daniel (RTF) | Idèntic a Python |
|---|---|---|---|
| Python natiu, 2 fils | 0,18 | 0,22 | – |
| WASM, 1 fil (Chrome, PC de 8 nuclis) | 0,39 | 0,52 | sí |
| **WASM, 8 fils** | **0,18–0,23** | **0,24–0,32** | **sí (41/41)** |
| WebGPU (gràfica integrada), encoder `q8w` | 0,22 | 0,38 | sí |

- Vídeos amb música: anamfent RTF 0,54; Raquel 0,68. El coll d'ampolla és l'etapa 2 del rescat.
- Mòbil (Galaxy A52s, 4 fils, vídeo de 25 s): RTF 1,2; primera baixada 1,5–2 min amb wifi; motor a
  punt en 7–10 s. WebGPU: sense memòria (*device lost*).
- WebGPU: el paquet antic (`ort.all`, JSEP) no admet MatMulNBits de 8 bits; `ort.webgpu` sí, i
  dona el mateix resultat.

### 10.5 Segmentació (vídeo de Daniel Sancho, contra l'antic `srt.py`)

| | `srt.py` | Perfil horitzontal |
|---|---|---|
| Línies de més de 42 caràcters | 11 | 0 |
| Talls darrere d'article o preposició (subtítol / línia) | 21 / 24 | 0 / 0 |
| Talls en un lloc natural | 51 % | 89 % |

Altres vídeos: talls naturals del 54–65 % al 94–100 %. Contra la referència (1 × 24) el perfil
vertical encerta el 34–36 % dels talls (orientatiu). Els car/s per damunt de 17 són del locutor
(~21 car/s, també a la referència).

---

## 11. Desplegament i proves en local

- **Web:** un *workflow* publica només `web/` quan hi ha un `push` a `main` que la toca
  (actions/checkout@v6, configure-pages@v5, upload-pages-artifact@v4, deploy-pages@v4).
- **Models:** `publica_hf.py` puja els dos repositoris propis; després es copia la revisió a
  `REVISIONS`. És l'únic acoblament entre web i models.

```bash
python eines/serveix.py --models ruta/models_onnx            # web/ amb els models a /models_onnx/
python eines/serveix.py --models ruta/models_onnx --sense-coi  # com GitHub Pages (prova el service worker)
python eines/transcriu.py video.mp4 --models ruta/models_onnx  # el mateix motor, en Python
```

| Paràmetre de l'adreça | Efecte |
|---|---|
| `?fils=N` | Força el nombre de fils |
| `?gpu=1` | Encoder en WebGPU (paquet `ort.webgpu` + WASM asyncify). Experimental |
| `?models=hf` | En local, baixa de Hugging Face |
| `?models=carpeta` | Una altra carpeta de models |

Les proves (igualtat amb Python, mètriques i banc de proves) s'expliquen a
[`proves/README.md`](../proves/README.md).

---

## 12. Com estendre'l, i el deute tècnic

| Per a… | Cal tocar |
|---|---|
| Un altre Conformer RNNT (p. ex. ajustat amb dades balears) | Exportar-lo i quantitzar-lo amb `eines/models/`, publicar-lo i canviar `FITXERS` o `REVISIONS` a `models.js`. El navegador el baixarà sol |
| Una altra arquitectura (Whisper, CTC) | Substituir `rnnt.js` i adaptar `paraules.js`; el rescat de `motor.js` depèn del *blank* de l'RNNT |
| Un altre puntuador | Qualsevol model de classificació de tokens amb `tokenizer.json` BPE: canviar `FITXERS` i, si canvien les etiquetes, `etiqueta()` |
| Un format de sortida nou (ASS) | Una funció més a `subtitols.js`, al costat de `srt()` i `vtt()` |
| Un criteri de tall nou | Un terme a `costTall()` o `costSubtitol()`, a Python i a JS alhora, i tornar a passar `subtitols.test.mjs` |

**Deute tècnic conegut:**
- L'àudio sencer es carrega a memòria (una hora ≈ 230 MB de PCM, i `decodeAudioData` passa abans
  per l'estèreo a la freqüència original). Falta llegir per parts.
- Les proves es llancen a mà: no hi ha integració contínua ni proves de cap a cap.
- La correcció dels MP4 només està comprovada a Chrome. Cap prova en un iPhone.
- La sessió es desa a `localStorage` (uns pocs MB): transcripcions molt llargues podrien no cabre-hi.

**Idees de rendiment, per ordre:** trossos més curts (el model es va entrenar amb ≤ 15 s; pot
reduir l'activació del rescat); abaratir l'etapa 2 del rescat (no exacte: validar amb el WER);
separar el decoder (LSTM) del *joint*; encoder fp16 amb WebGPU per a equips amb bona gràfica.

> **Regla del projecte:** cap canvi no ha d'empitjorar els resultats mesurats. Abans d'adoptar-lo,
> es comprova amb els 38 clips i els vídeos.
