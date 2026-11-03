# Subtitulador català al navegador — història, decisions i passos pendents

*Ferran Artero Merino · beca ValgrAI (VRAIN-UPV) · estat a 3 de novembre de 2026*

Aquest document explica tot el procés fins ara: quin problema volem resoldre, què hem fet, quins
problemes hem trobat, com els hem resolt, per què hem pres cada decisió i què queda per fer.

---

## 1. El problema

Els creadors de contingut en català (Instagram, TikTok, YouTube) necessiten subtítols. Les eines
que hi ha tenen limitacions:

- Les eines comercials (CapCut, Premiere) funcionen malament en català, i encara pitjor amb
  accents no centrals (valencià, balear).
- El servei de Softcatalà funciona bé, però envies el vídeo a un servidor, hi ha cua i t'avisen
  per correu quan està.
- Whisper i semblants s'han d'instal·lar, demanen GPU i de vegades "al·lucinen" (repeteixen
  frases o se n'inventen).

A més, a la beca la línia de recerca és **l'ASR en català centrat en valencià i balear**, i la
idea de fons és una eina oberta de transcripció de vídeo per a creadors en català. A llarg
termini, això connecta amb el projecte personal de l'"Alexa catalana" (ESP32).

## 2. Què volem aconseguir

Una pàgina web on:

1. puges un vídeo o un àudio;
2. es transcriu **dins del teu navegador** (no s'envia res a cap servidor);
3. obtens subtítols **SRT/VTT** ben tallats, amb puntuació i majúscules, per a importar-los a
   Premiere o CapCut.

Requisits que hem fixat:

| Requisit | Per què |
|---|---|
| Funciona en Windows, Mac, Android i iOS sense instal·lar res | Els creadors fan servir el mòbil i no instal·laran Python |
| Allotjada a GitHub Pages | Gratuïta, estàtica, sense servidor que mantenir |
| Tot al navegador (models ONNX baixats i guardats a la memòria cau) | Privacitat, cost zero i cap cua |
| **Precisió per damunt de velocitat** | Prefereixes que tarde més si encerta més. L'únic requisit dur és que càpiga i funcione a la web |
| Codi obert, GPL-3.0 amb clàusula de citació | Que es puga reutilitzar però que s'haja de citar l'autor |
| Bon resultat en valencià i balear | És l'objectiu de la beca |

Enllaços:
- Web: https://ferran-artero.github.io/subtitols-ca/
- Codi: https://github.com/ferran-artero/subtitols-ca

## 3. Decisions de fons (i per què)

### 3.1 Quin model de reconeixement de veu

Vam comparar models de la *Catalan ASR Arena* (BSC) amb 38 frases gravades per tu mateix (19 en
valencià i 19 en balear: vocabulari dialectal, noms propis, verbs, missatges de WhatsApp i frases
comunes). Vam provar diversos Whisper (alguns convertits a faster-whisper) i el Conformer
`projecte-aina/stt_ca-es_conformer_transducer_large` (NeMo).

**Triat: el Conformer.** Va donar el millor WER sobre les teues gravacions. A més, és
un model *transducer* (RNNT): no al·lucina com Whisper, dona l'instant de cada paraula (necessari
per als subtítols) i és prou petit per a portar-lo al navegador.

Inconvenient: **no posa ni puntuació ni majúscules.** Això ens va portar a la decisió següent.

### 3.2 Com afegir puntuació i majúscules

Opcions considerades:

- **Reentrenar el Conformer perquè puntue:** caldrien moltes dades transcrites amb puntuació i
  temps de GPU. Descartat per ara.
- **Model de llengua KenLM i cerca en feix (*beam search*):** millora una mica el WER, però no
  posa puntuació, complica molt el motor al navegador i el guany esperat era petit. Descartat per
  ara. La descodificació és *greedy*: a cada pas es tria l'opció més probable.
- **Cascada:** l'ASR treu el text pla i un segon model de text hi posa signes i majúscules.
  **Triat.** És senzill, modular, i hi ha models catalans ja entrenats.

Al pas 0 i al pas 1 vam comparar dos puntuadors:

- **Softcatalà** (`softcatala/fullstop-catalan-punctuation-prediction`): millor amb els **signes**
  (`, . ? : -`).
- **UMU** (`UMUTeam/catalan_capitalization_punctuation_restoration`): millor amb les
  **majúscules** (noms propis).

**Decisió: combinar-los.** Els signes i els inicis de frase els posa Softcatalà. De la UMU
només s'agafen les majúscules de dins de frase, és a dir, els noms propis.

Problema que vam trobar: si un nom propi queda a inici de frase segons la UMU però no segons
Softcatalà, perdia la majúscula ("novetats: daniel Sancho"). Solució: si en algun altre lloc del
text la UMU ha escrit aquella paraula amb majúscula a mig de frase, la considerem fiable i la
posem en majúscula sempre.

La puntuació va per **finestres de 120 paraules que avancen de 100 en 100**, i de cada finestra
es guarda la part central. Els models de text tenen un límit de context, i així cada paraula té
context per les dues bandes. La puntuació es fa sobre el text **sencer**, no per trossos d'àudio,
perquè una frase pot quedar partida entre dos trossos.

Observació teua important: la puntuació depén del text, no de l'entonació. Un puntuador de
text no pot saber si "ve demà" és una pregunta. Ho acceptem i queda com a millora futura.

### 3.3 On s'executa: opció A o B

- **A:** un servidor local o un `.bat` que l'usuari executa (Python al PC). Ràpid i precís, però
  cal instal·lar-lo i no funciona al mòbil.
- **B:** tot al navegador amb `onnxruntime-web`. Cap instal·lació, funciona a tot arreu i
  és privat. A canvi, la primera vegada es baixen uns 460 MB (després queden en memòria cau) i
  en mòbils pot anar lent o justet de memòria.

**Triada la B**, perquè és l'única que compleix "funciona a tot arreu sense instal·lar res". La
fase 3 decidirà si és viable de debò.

### 3.4 Llicència i models de tercers

- Codi: **GPL-3.0 + `NOTICE`** amb una clàusula de citació (secció 7(b) de la GPL). Cada fitxer
  porta la capçalera `SPDX-License-Identifier: GPL-3.0-or-later` i el copyright a Ferran Artero
  Merino.
- Llicències dels models (resum a `MODELS.md`):

| Model | Llicència | Estat |
|---|---|---|
| Conformer (Projecte AINA, a partir de NVIDIA NeMo) | CC-BY-4.0 | cal atribució |
| Silero VAD | MIT | cal citar |
| Softcatalà | **MIT** | Jordi Mas va afegir la llicència i en farà referència quan publiquem la conversió. *Cal comprovar que ja surt a Hugging Face.* |
| UMU | **Apache-2.0** | Rafael Valencia ens va demanar que fem servir **el seu int8 oficial** (`UMUTeam/catalan_capitalization_punctuation_restoration_int8`) i que els citem (article de Pan et al., 2023, a *Procesamiento del Lenguaje Natural* 70) |

Abans de les respostes vam preparar un pla B: entrenar el nostre propi puntuador a partir de
`roberta-base-ca-v2`. Ara ja no cal.

## 4. El pla per fases

| Fase | Contingut | Estat |
|---|---|---|
| 0 | Repositori, GitHub Pages, llicència, estructura | ✅ |
| 1 | Convertir els models a ONNX i comprovar que no perden qualitat | ✅ |
| 2 | Motor de referència en Python (només numpy + onnxruntime) | ✅ |
| 3 | Motor en JavaScript al navegador + decisió de viabilitat | ⏭️ següent |
| 4 | Publicar els models a Hugging Face | pendent |
| 5 | Segmentació i format dels subtítols (es pot fer en paral·lel a la 3) | pendent |
| 6 | Interfície web | pendent |
| 7 | Robustesa (vídeos llargs, mòbils, errors) | pendent |
| 8 | Proves automàtiques | pendent |
| 9 | Versió 1.0 | pendent |
| 10 | Millores: ajust del model amb dades balears, pauses, mode local… | pendent |

Hi ha dues carpetes:
- **`ASR-CAT`** (OneDrive): és la recerca. Hi ha les dades, els experiments, els entorns i tots
  els scripts.
- **`subtitols-ca`** (fora d'OneDrive, a GitHub): és el producte. Hi ha la web (`web/`) i les
  eines per a generar els models (`eines/`). Les coses passen d'una carpeta a l'altra quan estan
  acabades.

## 5. Fase 0 — Base del projecte

- S'ha creat el repositori `subtitols-ca` i s'ha configurat GitHub Pages amb un *workflow* que
  publica només la carpeta `web/` (actions/checkout@v6, configure-pages@v5,
  upload-pages-artifact@v4, deploy-pages@v4). Així les eines i els models no es publiquen a la web.
- S'ha triat la llicència GPL-3.0 i s'ha afegit el `NOTICE` amb la clàusula de citació. Tu
  volies codi obert ("no amaguem res"), però que qui el reutilitze t'haja de citar.
- S'han enviat correus a Softcatalà i a la UMU per a preguntar per les llicències. Les respostes
  són a la secció 3.4.

## 6. Fase 1 — Models a ONNX

**Objectiu:** convertir els models a un format que el navegador sàpiga executar (ONNX) i comprovar
que la qualitat no baixa.

Què es va fer:
- **Conformer:** exportat de NeMo en dues peces:
  - `encoder.onnx`: rep l'espectrograma i dona una representació cada 40 ms;
  - `decoder_joint.onnx`: rep un instant de l'encoder i l'última paraula, i dona la següent.
  
  El bucle de descodificació l'escrivim nosaltres.
- **Puntuadors:** exportats de transformers a ONNX.
- **Silero VAD** (detecció de veu): ja venia en ONNX.

Problemes trobats:
- **La validació del puntuador exportat donava diferències de 0,12 als logits.** El model
  s'exportava en mode d'entrenament (amb *dropout* actiu). Solució: posar-lo en mode d'avaluació
  (`.eval()`).
- **Mida.** En float32, el Conformer fa 481 MB i cada puntuador uns 500 MB: massa per a la web.
  Vam quantitzar a int8:
  - int8 dinàmic (pesos i activacions): WER del 10,4 % (fp32: 9,9 %);
  - int8 per canal (`int8pc`): 10,2 %;
  - als puntuadors, vam quantitzar també la taula d'*embeddings* (`q8pc`): passen a 127 MB, amb
    una F1 de puntuació de 0,76, igual que l'original.

**Conclusió de la fase 1:** funciona. La pèrdua de qualitat és petita i la mida total, d'uns 435
MB, cap dins dels 500 MB que havíem fixat.

## 7. Fase 2 — Motor de referència en Python

**Objectiu:** reescriure tot el procés **sense NeMo ni PyTorch**, només amb numpy, onnxruntime i
tokenizers. És exactament el que farà la web, però en Python. Serveix per a:
1. saber que la recepta és correcta abans de passar a JavaScript;
2. generar fitxers de referència (JSON) amb què comprovarem que la web dona el mateix resultat.

### 7.1 Com funciona el motor (`codi/motor_ref/`)

1. **Lectura** (`audio.py`): qualsevol àudio o vídeo, convertit a 16 kHz mono. Els vídeos es
   descodifiquen amb ffmpeg (`imageio-ffmpeg`).
2. **Detecció de veu** (`vad.py`, Silero): troba on hi ha veu i fa trossos de **com a molt 25 s**.
   - Paràmetres: llindar 0,5, silenci mínim 0,3 s, veu mínima 0,25 s, marge 0,2 s.
   - Si dos trossos estan separats per menys de 2 s, s'ajunten.
   - **Talls forçats:** si algú parla seguit més de 25 s, es talla pel punt més silenciós entre
     el 60 % i el 100 % del tros, amb 1 s de solapament. Cada tros té una "zona pròpia", i una
     paraula és del tros on cau el seu centre. Així no es dupliquen ni es perden paraules.
   - **Context:** 0,5 s de silenci a cada costat del tros.
3. **Espectrograma** (`mel.py`): log-mel de 80 bandes, reimplementat en numpy. És idèntic al de
   NeMo (diferència màxima de 2,5·10⁻⁵).
4. **Reconeixement** (`rnnt.py`): encoder i bucle RNNT *greedy*, amb l'instant de cada token.
5. **Paraules** (`paraules.py`): els tokens es converteixen en paraules amb inici i fi. Es
   reparen els apòstrofs i els guionets.
6. **Puntuació** (`puntua.py`): Softcatalà + UMU, com s'explica a la secció 3.2.
7. **SRT senzill** (`srt.py`): de moment, només per a comprovar els temps.

Ordres: `fase2_valida.py` (proves peça a peça), `fase2_transcriu.py` (transcriu qualsevol fitxer),
`fase2_avalua_video.py` (avalua un vídeo amb referència) i `fase2_diagnostica.py` (analitza un
fragment concret).

### 7.2 Vídeo de prova amb referència

Vam fer una referència d'un vídeo real, `017_Daniel Sancho.mov`:
- 2,8 minuts, en balear, de notícies, amb música de fons;
- 180 subtítols corregits a mà (extrets del vídeo amb OCR i revisats);
- 631 paraules, amb els números escrits en lletres per al WER.

Això ens va permetre mesurar coses que les frases curtes no mostren: frases perdudes, sincronia
i trossos llargs.

Mètriques:
- **WER:** percentatge de paraules errònies, sense comptar majúscules ni signes.
- **WER formatat:** el mateix, però comptant també majúscules i signes.
- **F1 de puntuació i de majúscules.**
- **Frases perdudes:** 3 o més paraules seguides que falten.
- **Sincronia:** diferència entre l'inici de cada subtítol de la referència i l'inici de la
  mateixa paraula al motor.
- **RTF:** temps de càlcul dividit per la durada de l'àudio.

### 7.3 Problemes trobats i com els vam resoldre

| Problema | Causa | Solució |
|---|---|---|
| ffmpeg fallava en passar-li una carpeta | PowerShell no expandeix rutes com caldria | Els scripts accepten carpetes i ho expliquen quan hi ha un error |
| Faltaven apòstrofs ("l actor") | El model a vegades no emet el token de l'apòstrof | Ajuntem les elisions i reparem les lletres soltes (l, d, m, t, s, n) davant de vocal o h, o darrere de vocal |
| "novetats: daniel Sancho" | La majúscula de la UMU es perdia a inici de frase | La llista de noms "fiables" (secció 3.2) |
| Paraules desordenades a les vores dels talls forçats | Els dos trossos veien la mateixa paraula | La funció `ajunta` elimina els duplicats i ajusta els temps |
| Al·lucinacions ("Keith Ken") | El VAD retallava massa just i el model no tenia silenci de context | 0,5 s de silenci a cada costat del tros (amb 0 s al·lucinava i amb 1 s era pitjor) |
| La variant fp32 carregava int8pc sense avisar | Un sufix buit es tractava com a "no indicat" | Les variants tenen nom propi |
| **L'int8 es menjava frases senceres** | Inestabilitat de la quantització dinàmica | Quantització **només dels pesos a 8 bits** (`q8w`, 191 MB); les activacions es queden en float32 |
| El decodificador en `q8w` anava 5 vegades més lent | Matrius petites cridades milers de vegades | El `decoder_joint` es queda en float32 (només 17 MB) |
| `q4w` (4 bits, 148 MB) | Perdia massa qualitat | Descartat |
| **Fins i tot l'fp32 es menjava frases** amb música de fons | El model RNNT s'"encalla" emetent *blank* ("cap paraula") durant segons. NeMo original fa el mateix | El **rescat** (secció 7.4) |

### 7.4 El rescat de frases perdudes (la part més treballada)

Ho vam fer en diverses iteracions, i cada una va ensenyar alguna cosa:

1. **Penalització fixa del *blank*.** Es resta un valor a la puntuació del *blank* perquè el model
   s'anime a escriure. Amb penalització 2, el vídeo passava del 13,3 % al 7,9 % de WER. Però els
   38 clips nets empitjoraven del 9,4 % al 10,2 %, perquè s'inventava paraules. **No servia
   aplicada sempre.**
2. **Rescat adaptatiu.** La penalització només s'aplica als trossos on hi ha un forat d'1,5 s o
   més sense paraules on el VAD diu que hi ha veu. Els clips nets es quedaven igual (9,4 %), però
   al vídeo, 8,6 %: no detectava els forats curts.
3. **Penalització només dins del forat.** Va ser pitjor (9,2 %). Allà on el model s'encalla
   també es menja paraules soltes al voltant ("aquest", "estava", "en aquest cas"), que no deixen
   forats prou llargs per a detectar-les.
4. **Rescat en etapes.** Si un tros té un forat ≥ 0,7 s amb veu:
   1. es torna a descodificar **el tros sencer** amb penalització 2 (així recupera també les
      paraules soltes);
   2. si encara queda forat, puja la penalització a 3 i a 4 **només dins del forat**.
   
   Resultat: 7,4 % al vídeo, els clips nets igual i 1 frase perduda.
5. **Diagnòstic de l'última frase perduda** ("d'una conversa telefònica", a 2:00). L'àudio era bo
   (VAD = 1,0 i volum normal) i el model estava *segur* que allí no hi havia res: el *blank*
   guanyava per 6 a 27 punts. La clau va ser la **llargada del tros**:
   - en el tros del motor (26,8 s), es perd;
   - en una finestra de 10 s, la recupera amb penalització;
   - en una de 5 s, la reconeix perfecta.
   
   El model es va entrenar amb clips de com a molt 15 s, i amb trossos més llargs l'encoder de
   vegades "no sent" una frase.
6. **Finestra curta (etapa nova).** Si després de l'etapa 1 encara queda forat, es torna a passar
   per l'encoder **només una finestra curta al voltant del forat** i se n'agafen només les
   paraules que cauen dins. Com que el resultat depén del context exacte (amb ±1 s funcionava i
   amb ±3 s no), es proven marges de ±1, 2, 0,5 i 3 s fins que un tanca el forat. Si encara no es
   tanca, s'aplica l'escalada a 3 i 4 dins del forat.

**Per què aquest disseny:**
- Als àudios nets no s'activa mai: els 38 clips donen exactament el mateix text, paraula per
  paraula.
- Fora dels forats no canvia res.
- Si la finestra no troba res, no s'afegeix res.

### 7.5 Canvi del model de majúscules

La UMU ens va demanar que féssim servir el seu int8 oficial. Vam comprovar que és compatible
(mateixes 12 etiquetes, mateix tokenitzador, mateixes entrades) i que dona el mateix resultat
que la nostra quantització: idèntic als 38 clips i igual al vídeo. Ara és el model per defecte
(`models_onnx/umu-oficial/`), i la web el podrà baixar directament del repositori de la UMU.

### 7.6 Resultats finals de la fase 2

| Configuració | WER clips | WER vídeo | WER formatat vídeo | F1 punt. vídeo | F1 maj. vídeo | Frases perdudes |
|---|---|---|---|---|---|---|
| Sense rescat | 9,4 % | 13,3 % | 19,4 % | 0,67 | 0,87 | 4 |
| Penalització 2 fixa | 10,2 % | 7,9 % | 12,6 % | 0,78 | 0,90 | 1 |
| **Final** | **9,4 %** | **7,0 %** | **11,7 %** | **0,78** | **0,91** | **0** |

- **Clips curts (final):** WER formatat del 14,0 %, F1 de puntuació de 0,76 i F1 de majúscules
  de 0,90.
- **Sincronia:** les paraules comencen 0,08 s després que el subtítol de referència (mediana; del
  10 % al 90 % dels casos, entre +0,01 i +0,14 s).
- **Velocitat:** RTF ≈ 0,18 al teu PC sense GPU (un vídeo de 3 minuts tarda uns 30 s).
- **Descàrrega a la web:**

| Fitxer | Mida |
|---|---|
| `encoder.q8w.onnx` | 191 MB |
| `decoder_joint.onnx` | 17 MB |
| `softcatala/model_q8pc.onnx` | 127 MB |
| `umu-oficial/model.onnx` | 126 MB |
| `silero_vad.onnx` | 2 MB |
| **Total** | **≈ 463 MB** |

**Validacions:**
- espectrograma idèntic al de NeMo;
- tokenitzadors idèntics a transformers (38/38);
- descodificació exacta respecte a la fase 1 en fp32 (38/38);
- puntuació idèntica a la de `puntuacio.py` (38/38).

**Errors que queden:** són sobretot del model, no del motor:
- formes balears normalitzades: "varen" → "van", 8 errors al vídeo;
- "idò", "vosaltres" → "voltros";
- noms estrangers ("Koh Phangan");
- paraules curtes inserides.

Això només ho arregla l'ajust del model amb dades balears (fase 10).

### 7.7 Què s'ha passat al repositori

S'han copiat a `subtitols-ca/eines/`:
- el motor de referència (`motor_ref/`) i `transcriu.py`;
- els sis scripts que generen els models;
- dos fitxers de requisits (un per al motor i un per a convertir models) i un README.

També s'hi ha afegit `MODELS.md`, amb llicències i cites. Tots els fitxers porten la capçalera
SPDX. Tot és pujat a GitHub.

## 8. Passos pendents, en detall

### Fase 3 — Motor en JavaScript (següent)

Objectiu: el mateix que `motor_ref`, però al navegador, i decidir si l'opció B és viable.

1. **Esquelet:**
   - un *Web Worker*, perquè la pàgina no es bloquege mentre treballa;
   - `onnxruntime-web` amb WASM, i WebGPU quan estiga disponible;
   - els models es guarden amb la Cache API o OPFS perquè no s'hagen de tornar a baixar.
2. **Fils d'execució.** El WASM amb diversos fils necessita `SharedArrayBuffer`, que exigeix
   unes capçaleres especials (COOP/COEP). GitHub Pages no deixa posar capçaleres. Solució
   coneguda: un *service worker* que les afig (com `coi-serviceworker`). Si no, el motor anirà
   amb un sol fil, és a dir, més lent.
3. **Lectura d'àudio:** descodificar el vídeo amb `AudioContext.decodeAudioData` o WebCodecs i
   passar-lo a 16 kHz mono. Cal comprovar quins formats accepta cada navegador (`.mov` a
   Android, `.mkv`…). Alternativa per als formats que fallen: `ffmpeg.wasm`, que és pesat.
4. **Portar peça a peça, comprovant cada peça contra Python:**
   - espectrograma (FFT, finestra, filtres mel): diferència < 10⁻³;
   - VAD i trossos: mateixos trossos;
   - encoder i bucle RNNT: mateixos tokens;
   - paraules, apòstrofs i reparacions: mateix text;
   - tokenitzador BPE dels puntuadors: mateixos ids (es pot fer servir el de transformers.js);
   - puntuació i rescat (les tres etapes).
   
   Els JSON de `resultats/fase2/referencia/` contenen ids, instants, paraules i temps de cada
   clip: serveixen de proves automàtiques.
5. **Riscos que cal mesurar:**
   - **Bucle del decodificador:** es fan milers de crides petites, i a onnxruntime-web cada
     crida té un cost fix. Pot ser el coll d'ampolla.
   - **`MatMulNBits`:** comprovar que l'encoder `q8w` funciona i va ràpid en WASM i en WebGPU.
   - **Memòria als mòbils**, sobretot a iOS: uns 460 MB de models més la memòria de treball.
6. **Prova en fp16 amb WebGPU:** un encoder en fp16 (≈ 240 MB) tindria la precisió de l'fp32. Si
   el navegador té WebGPU, podria ser l'opció "màxima precisió".
7. **Decisió de viabilitat (*go/no-go*):**
   - mateix resultat que Python als 38 clips i al vídeo;
   - temps acceptable al PC: prioritzem precisió, però ha de ser usable;
   - que no pete en un mòbil de gamma mitjana.
   
   Si falla als mòbils: un mode "només ordinador", o models més petits per al mòbil.

### Fase 4 — Publicar els models a Hugging Face

- Crear un repositori de models (`ferran-artero/...`) amb:
  - el Conformer en ONNX (`encoder.q8w`, `decoder_joint`, `tokens`, `mel_fb`, `finestra`, `config`);
  - el puntuador de Softcatalà en `q8pc`;
  - la fitxa del model (*model card*) amb llicències (CC-BY-4.0, MIT) i cites.
- La UMU es baixa directament del seu repositori oficial. Silero, del nostre o del seu.
- Avisar en Jordi Mas (Softcatalà) amb l'enllaç, tal com vam quedar. Abans, comprovar que la
  llicència MIT ja surt al seu repositori.
- Comprovar que la web pot baixar els fitxers de Hugging Face (CORS) i que es guarden en memòria
  cau.

### Fase 5 — Segmentació i format dels subtítols

És el que dona qualitat al resultat final. Proposta:

- **Paràmetres configurables:**
  - caràcters per línia: uns 42 per a vídeo horitzontal; per a Reels/TikTok, 1 línia d'uns
    20–25 caràcters;
  - línies per subtítol (1–2);
  - velocitat de lectura màxima (17–20 caràcters/s);
  - durada mínima i màxima (uns 0,8 s i 6–7 s);
  - separació mínima entre subtítols.
- **Regles de tall:**
  - primer per signes de puntuació i pauses;
  - no separar article i nom ni preposició i nom;
  - línies equilibrades.
- **Perfils predefinits:** horitzontal, vertical i accessibilitat.
- **Sincronia:** decidir si corregim el desfasament de +0,08 s (avançar els subtítols 0,08 s).

L'avantatge respecte a Softcatalà: tenim el temps de cada paraula i la puntuació, així que podem
tallar millor.

### Fase 6 — Interfície

- Pujar el fitxer (o arrossegar-lo), barra de progrés, previsualització del vídeo amb els
  subtítols i botó de descàrrega.
- **Formats:**
  - SRT i VTT;
  - TXT;
  - JSON amb el temps de cada paraula;
  - opcionalment ASS, amb estil.
- **Opció "ressalta cada paraula"** (com Softcatalà): en SRT es fa repetint el subtítol amb la
  paraula activa marcada; en VTT o ASS, amb marques de temps per paraula.
- **Editor de la transcripció:** fas clic en una paraula i el vídeo salta allí; corregeixes
  paraules sense perdre els temps; buscar i substituir.
- **Sobre l'estil:** el SRT només guarda text i temps. La font, la mida, la posició i els colors
  es posen a l'editor:
  - a Premiere, amb l'estil de la pista de subtítols, que s'aplica a tots;
  - a CapCut, amb "aplicar a tots".
  
  La nostra eina ha de donar el millor text, els millors temps i els millors talls, i deixar
  l'estil a l'editor.

### Fase 7 — Robustesa

- Vídeos llargs (més d'1 hora): llegir l'àudio per parts per a no omplir la memòria.
- Botó de cancel·lar i missatges d'error clars.
- Formats que el navegador no sap llegir.
- Proves en Chrome, Firefox, Safari, Android i iOS.

### Fase 8 — Proves automàtiques

- Proves unitàries del motor JavaScript contra els JSON de referència de Python.
- Proves de cap a cap (*end-to-end*) amb Playwright: pujar un fitxer i comprovar el SRT.
- Una petita "prova de regressió" amb els 38 clips i el vídeo, per a cada canvi.

### Fase 9 — Versió 1.0

- README complet del repositori (ara només enllaça `MODELS.md`).
- Un `CITATION.cff` perquè GitHub mostre com citar el projecte.
- Opcionalment, un DOI a Zenodo.
- Anunci: Softcatalà, la UMU, la beca i xarxes.

### Fase 10 — Millores

- **Ajust del Conformer amb dades balears** (i, si cal, valencianes): el problema més gran que
  queda ("varen", "idò", "voltros", l'article salat). Cal decidir abans si es transcriu **el que
  es diu** (fidelitat) o la **forma estàndard**.
- **Música i cançons.** Al vídeo `prova_anamfent` (vlog amb música, cançons i mescla d'idiomes),
  el rescat recupera moltes frases bones però també escriu fragments sense sentit on hi ha
  cançons, perquè el VAD pren el cant per veu. Primer cal **fer-ne una referència d'uns minuts**,
  per a mesurar-ho; després es podria afegir un detector de música.
- **Puntuació que tinga en compte l'entonació**, per a les preguntes.
- **Funcions inspirades en la guia de tallat:** editar el vídeo editant el text (esborrar "ehh" o
  silencis) i exportar els talls per a Premiere o DaVinci. Renderitzar vídeo amb estils al
  navegador és car i té poc sentit si l'usuari acaba a Premiere o CapCut: ho deixaria per al
  final o no ho faria.
- **Més endavant:** subtítols en temps real i l'"Alexa catalana".

## 9. Petits pendents immediats

- [ ] Comprovar que la llicència MIT de Softcatalà ja surt a Hugging Face.
- [ ] Fer una referència de 2–3 minuts de `prova_anamfent` (és el cas difícil).
- [ ] Ampliar el README del repositori `subtitols-ca`.
- [ ] Afegir els resultats d'aquesta setmana a l'informe setmanal de la beca.
