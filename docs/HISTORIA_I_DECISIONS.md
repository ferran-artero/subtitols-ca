# Subtitulador català al navegador — història, decisions i passos pendents

*Ferran Artero Merino · beca ValgrAI (VRAIN-UPV) · estat a 9 de novembre de 2026*

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
| 3 | Motor en JavaScript al navegador + decisió de viabilitat | ✅ al PC; falta provar-lo al mòbil (després de la 4) |
| 4 | Publicar els models a Hugging Face | ✅ |
| 5 | Segmentació i format dels subtítols | ✅ (feta abans de la 3) |
| 6 | Interfície web | pendent |
| 7 | Robustesa (vídeos llargs, mòbils, errors) | pendent |
| 8 | Proves automàtiques | pendent |
| 9 | Versió 1.0 | pendent |
| 10 | Millores: ajust del model amb dades balears, pauses, mode local… | pendent |

Hi ha dues carpetes:
- **`ASR-CAT`** (OneDrive): és la recerca. Hi ha les dades, els experiments, els entorns i tots
  els scripts.
- **`subtitols-ca`** (a GitHub; en local a `Desktop\Projectes\03_subtitols-ca\subtitols-ca`): és el
  producte. Hi ha la web (`web/`, amb el motor en JavaScript), el motor de referència en Python i
  les eines dels models (`eines/`) i les proves (`proves/`). **Des del 4 de novembre, tot el codi
  nou es fa ací.** ASR-CAT es queda per a les dades, els models, els entorns i els experiments.

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

## 8. Fase 5 — Segmentació dels subtítols

La vam fer abans de la fase 3 perquè no necessita models i perquè és el que l'usuari veu.

### 8.1 Idea

La segmentació va **després** de la transcripció i n'és independent: rep la llista de paraules
amb inici, fi i signe (el JSON del motor) i decideix on tallar. No toca mai el text. Avantatge:
a la web, canviar un paràmetre només torna a segmentar (mil·lisegons) i no torna a transcriure.

### 8.2 Paràmetres

Els dos de Softcatalà (caràcters per línia i línies per subtítol) i uns quants més:

| Paràmetre | Horitzontal | Vertical (Reels, TikTok) | Accessibilitat |
|---|---|---|---|
| Línies × caràcters | 2 × 42 | 1 × 22 | 2 × 37 |
| Caràcters/s màxims (cost suau) | 17 | 22 | 13 |
| Durada | 1–7 s | 0,5–3 s | 1,5–7 s |
| Buit mínim / enganxa al següent | 0,08 / 0,5 s | 0 / 1 s | 0,08 / 0,8 s |

A més: paraules màximes per subtítol (estil "2–3 paraules de colp"), desfasament dels temps i
**ressaltat de paraules** en tres modes: `paraula` (la que es diu), `progres` (karaoke: la frase
sencera i les paraules dites es van pintant) i `acumula` (apareixen d'una en una). La marca pot
ser subratllat, negreta, cursiva, color o fons (el fons només existeix en VTT; el SRT no en té).

### 8.3 Com talla

Programació dinàmica: es prova cada subtítol possible i es tria la partició de cost mínim.
Tallar després d'un signe o d'una pausa és barat; és car tallar darrere d'un article, una
preposició o un auxiliar (inclou l'article salat), dins d'un número ("dos mil | vint") o d'un
nom propi, deixar una frase a mig subtítol, passar-se de caràcters/s o fer subtítols molt curts.
El salt de línia es tria amb les mateixes regles i línies equilibrades.

### 8.4 Resultats (vídeo de Daniel Sancho, contra l'antic `srt.py`)

| | `srt.py` (fase 2) | Horitzontal |
|---|---|---|
| Línies de més de 42 caràcters | 11 | 0 |
| Talls darrere d'article o preposició (subtítol / línia) | 21 / 24 | 0 / 0 |
| Talls en un lloc natural (signe, pausa o davant de "que", "per"…) | 51 % | 89 % |

Als altres dos vídeos, els talls naturals passen del 54–65 % al 94–100 %. Contra la referència
de Daniel Sancho (1 línia de 24, que és un perfil vertical) el perfil vertical encerta el 34–36 %
dels talls (orientatiu: hi ha moltes maneres bones de tallar). Els caràcters/s per damunt de 17
són del locutor (~21 car/s, també a la referència): tallar d'una altra manera no ho arregla.

### 8.5 Proves amb els editors

- **Premiere:** importa el SRT i respecta `<u>` (subratllat). Falta provar `<b>`, `<i>`,
  `<font color>` i el VTT (fitxer de prova: `ASR-CAT/resultats/fase5/prova_etiquetes.srt`).
- **Film Craft:** amaga les etiquetes però no les aplica: allà només serveix `acumula`.

## 9. Neteja i pas al repositori (4 de novembre)

Abans de començar el JavaScript vam deixar el Python com a producte final i el vam passar al
repositori. Etiqueta de git **`motor-python-v1`** (còpia de seguretat de l'estat validat) i còpia
del codi d'ASR-CAT a `ASR-CAT/copies/ASR-CAT_codi_2026-11-04.zip`.

- **Fora:** les variants de models esborrades (int8, int8pc, q4w), les opcions d'experiment
  (penalització fixa, triar el model de majúscules, paràmetres del rescat a l'ordre), `srt.py`
  i funcions que ja no s'usaven. El motor passa de 284 a 195 línies (−20 % en total).
- **Models:** els 6 scripts `onnx_*.py` ara són 5 a `eines/models/`.
- **Una sola ordre:** `eines/transcriu.py` transcriu i segmenta (o només segmenta si li passes
  el JSON) i escriu a `resultats/`, que git ignora.
- **Lectura d'àudio:** librosa (pesada) → `soundfile` + `soxr`, que dona el mateix senyal
  exacte. Llegir-ho tot amb ffmpeg canviava el text i empitjorava el WER formatat (13,66 % →
  13,8–14,0 %): descartat.
- **Comprovació:** abans i després de la neteja, els 38 clips i els 3 vídeos donen el mateix
  resultat (text, temps, signes, tokens i rescat): 41/41.

Estructura del repositori:

```
subtitols-ca/
├── web/
│   ├── index.html, previsualitza.html
│   └── js/  subtitols.js, previsualitza.js
│        └── motor/  npy, mel, vad, rnnt, paraules, comu, motor, bpe, puntua
├── eines/  transcriu.py, motor_ref/ (Python), models/ (generar els ONNX)
├── proves/ casos de Python i proves de Node que els comparen amb JS
└── docs/, MODELS.md, README.md, LICENSE, NOTICE
```

## 10. Fase 3 — Motor en JavaScript

### 10.1 Decisions

- **onnxruntime-web 1.29.0** (agost de 2026). Carrega l'encoder `q8w` (MatMulNBits) sense
  problemes, que era un dels riscos.
- Els mòduls reben `ort` des de fora: el mateix codi funciona al navegador i a Node (proves).
- Cada peça es porta línia a línia des del Python i es compara amb referències que desa
  `proves/referencia_motor.py` (àudio, probabilitats del VAD, espectrograma de cada tros,
  tokens, rescat i paraules).
- Primer la segmentació (no necessita models), amb una pàgina de previsualització: vídeo + JSON,
  paràmetres en temps real (2–7 ms per recalcular), subtítols damunt del vídeo i baixada de
  SRT/VTT/TXT.

### 10.2 Validació peça a peça (38 clips + 3 vídeos)

| Peça | Resultat |
|---|---|
| `subtitols.js` | SRT, VTT i TXT idèntics a Python: 108/108 casos (3 vídeos × 3 perfils × 12 combinacions) |
| `mel.js` | diferència màxima de l'espectrograma 4·10⁻⁶ (objectiu < 10⁻³) |
| `vad.js` | trossos idèntics 41/41 (probabilitats a 3·10⁻⁶) |
| `rnnt.js` | tokens i trames idèntics en tots els trossos |
| `paraules.js` + `motor.js` | **41/41 idèntics**: tokens, cada pas del rescat i cada paraula amb el seu inici i fi (els vídeos tenen 5, 4 i 12 trossos amb rescat) |
| `bpe.js` | ids del tokenitzador idèntics a `tokenizers`: 657/657 per model |
| `puntua.js` | majúscules (UMU) idèntiques; signes 1.970/2.015 paraules iguals, amb la mateixa qualitat |

Els signes no poden ser idèntics: el model de Softcatalà `q8pc` és int8 dinàmic, i aquests
càlculs en enters donen resultats lleugerament diferents en cada plataforma (fins a 0,63 als
logits). Passava també entre dues instal·lacions de Python (el Windows i la màquina virtual).
La qualitat és la mateixa:

| | WER formatat | F1 signes | F1 majúscules |
|---|---|---|---|
| 38 clips, Python → JS | 13,66 % → 13,66 % | 0,807 → 0,803 | 0,867 → 0,875 |
| Daniel Sancho, Python → JS | 14,14 % → 14,29 % | 0,780 → 0,780 | 0,903 → 0,902 |

Si algun dia cal la igualtat exacta, el puntuador es pot quantitzar només als pesos, com
l'encoder (`q8w`).

### 10.3 Problemes trobats

| Problema | Causa | Solució |
|---|---|---|
| Paraules partides ("eixe" → "e ix e") | `tokens.txt` té finals de línia de Windows; Python els neteja sols | `rnnt.js` treu el `\r` |
| Temps diferents en 1 ms | `round(x, 3)` de Python arrodoneix els empats al parell | `comu.js` imita `round` exactament (0 errors en 88.000 valors) |
| Probabilitats del VAD sense sentit a la prova | Node reaprofita memòria en fitxers petits | llegir el `.npy` amb el seu desplaçament |
| Les proves llargues no acabaven | cada ordre al PC té un límit de 3 minuts | proves reprenibles, tros a tros |

### 10.4 Rendiment: Python contra JavaScript

Mateixa màquina (la màquina virtual de 2 nuclis del PC, més lenta que el PC); Python amb
onnxruntime natiu i 2 fils; JavaScript a Node amb onnxruntime-web (WASM) i **1 fil**.
Temps en segons; RTF = temps / durada.

| Àudio (durada) | | VAD | ASR (mel + encoder + bucle + rescat) | Puntuació | Total | RTF |
|---|---|---|---|---|---|---|
| 38 clips (261 s) | Python | 3,8 | 40,8 | 3,4 | 48,1 | 0,18 |
| | JS | 3,9 | 185,3 | 8,5 | 197,7 | 0,76 |
| Daniel Sancho (169 s; 5 trossos amb rescat) | Python | 1,0 | 34,2 | 1,3 | 36,5 | 0,22 |
| | JS | 3,8 | 157,9 | 9,5 | 171,2 | 1,02 |
| Raquel (127 s; 4 amb rescat) | Python | 0,9 | 67,9 | 1,2 | 70,0 | 0,55 |
| | JS | 1,8 | 266,8 | 4,1 | 272,7 | 2,15 |
| prova_anamfent (221 s; 12 amb rescat) | Python | 1,6 | 70,4 | 0,9 | 72,9 | 0,33 |
| | JS | 3,4 | 323,4 | 7,2 | 334,0 | 1,51 |

- JS va **unes 4–5 vegades més lent** (tenint en compte que Python fa servir 2 fils i JS 1,
  són unes 2 vegades per fil).
- Dins de l'ASR de JS, **l'encoder és el 85–90 %** (Daniel: 136 de 158 s; anamfent: 272 de
  323 s). El bucle del decoder costa 1,7 ms per crida (20–50 s per vídeo). El risc que temíem
  (milers de crides petites) no és el problema; separar decoder i joint ja no és prioritari.
- El rescat encareix molt els àudios amb música (Raquel, anamfent): l'etapa 2 torna a passar
  l'encoder fins a 4 vegades per forat.
- L'espectrograma (≈ 1 s per vídeo) i el VAD (2–4 s) no compten.
- Les mesures varien amb la càrrega de la màquina (el mateix vídeo de Daniel en Python ha anat
  de 36 a 68 s en dies diferents).

Com recuperar-ho, per ordre: WASM amb diversos fils al navegador (cal el *service worker* de
COOP/COEP); WebGPU per a l'encoder; abaratir l'etapa 2 del rescat. Tot s'ha de mesurar ja al
navegador i al PC de l'usuari, no a Node.

### 10.5 Optimització i pàgina del navegador (9 de novembre)

Abans de la interfície vam optimitzar el motor i vam fer la pàgina que l'executa. Com sempre,
primer a ASR-CAT (banc de proves `codi/js/bench.mjs` a Node i `codi/js/bench.html` al navegador,
que comparen cada àudio amb Python i mesuren cada etapa) i després al repositori.

**Optimitzacions exactes** (el resultat continua idèntic a Python, 41/41):
- El bucle del decoder ja no copia res: l'eixida de l'encoder es transposa una vegada i es
  reutilitzen els tensors. Guany petit: quasi tot el cost és dins d'onnxruntime (≈ 1,4 ms/crida).
- L'etapa 3 del rescat continua des de la primera trama que canvia, en compte de tornar a
  començar el tros: la descodificació *greedy* només depén del que ve abans. Als vídeos amb
  música, un 7–10 % menys de crides al decoder.

**On s'executa l'encoder** (85–90 % del temps), mesurat al Chrome del PC de l'usuari (8 nuclis):

| | 38 clips (RTF) | Daniel (RTF) | Idèntic a Python |
|---|---|---|---|
| WASM, 1 fil | 0,39 | 0,52 | sí |
| **WASM, 8 fils** | **0,18–0,23** | **0,24–0,32** | **sí (41/41)** |
| WebGPU (gràfica integrada), encoder q8w | 0,22 | 0,38 | sí |
| *Python natiu, 2 fils* | *0,18* | *0,22* | – |

- **Triat: WASM amb tots els nuclis.** És exacte, va com Python i funciona a tots els navegadors.
- **WebGPU, de moment no.** Més lent que la CPU amb la gràfica integrada, paquet més gros i
  sessió més lenta de crear. A més, el WebGPU antic d'onnxruntime (JSEP, `ort.all`) no admet el
  MatMulNBits de 8 bits; el nou (`ort.webgpu`) sí, i dona el mateix resultat. Queda per a PCs
  amb GPU bona o mòbils amb pocs nuclis, potser amb un encoder fp16.
- Als vídeos amb música el coll d'ampolla és ara el rescat: les finestres de l'etapa 2 són el
  37–57 % del temps (anamfent RTF 0,54; Raquel 0,68).

**La pàgina** (`web/index.html`):
- `coi-serviceworker.js` posa les capçaleres COOP/COEP (GitHub Pages no ho permet) perquè la
  pàgina estiga aïllada i el motor puga fer servir tots els nuclis; recarrega la pàgina una vegada.
- `js/motor/worker.js`: el motor complet (amb la puntuació) en un Web Worker.
- `js/motor/models.js`: la primera vegada baixa els models amb progrés i els desa a la memòria
  cau del navegador (Cache API); després el motor està a punt en uns 3 s.
- `js/audio.js`: l'àudio del vídeo amb el descodificador del navegador, a 16 kHz mono.
- En acabar, la previsualització de la fase 5 (`previsualitza.html` ja no cal: la pàgina també
  carrega un JSON) i les baixades SRT, VTT, TXT i JSON.
- `onnxruntime-web` es serveix des del mateix origen (`js/vendor/ort/`): els fils són workers i
  no es poden crear des d'un altre domini.

**L'àudio del navegador:**
- El re-mostreig del navegador no és el de Python (`soxr`); en un WAV, SNR de 37 dB. Canvia
  alguna paraula, però no la qualitat: 38 clips WER 9,36 % → 9,01 %; Daniel 6,97 % → 7,29 %
  (2 paraules).
- **Error trobat als MP4:** els codificadors AAC posen unes mostres de preparació al principi i el
  fitxer (llista d'edició, `elst`) diu que se les salte. ffmpeg i el `<video>` ho fan; el
  `decodeAudioData` de Chrome no: l'àudio anava 0,115 s tard i els subtítols haurien eixit tard.
  `js/mp4.js` llig la llista d'edició i `audio.js` salta aquelles mostres si el navegador no ho ha
  fet (desfasament amb Python: +0,112 s → −0,008 s). Comprovat a Chrome; falta Firefox i Safari.
- Als MP4 queden diferències de paraules respecte a Python (Raquel, 17 de 302), perquè el
  descodificador AAC del navegador no és el de ffmpeg. Sense referència no se sap si és millor o
  pitjor; la de `prova_anamfent` (fase 10) ho permetrà mesurar.

**Fàcil de canviar el model:** un altre Conformer RNNT (p. ex. ajustat amb dades balears) o una
altra variant només demana canviar el fitxer a `FITXERS` de `models.js` (la memòria cau va per
adreça i el baixarà sol). Una altra arquitectura (Whisper, CTC) demanaria substituir `rnnt.js`.

### 10.6 Fase 4 — Models a Hugging Face (9 de novembre)

**Decisió: dos repositoris**, un per model original, perquè cadascun té la seua llicència i
Softcatalà pot enllaçar directament la seua conversió:

| Repositori | Contingut | Llicència |
|---|---|---|
| `ferran-artero/stt_ca-es_conformer_transducer_large-onnx` | encoder `q8w` i fp32, `decoder_joint`, `tokens`, `config`, `mel_fb`, `finestra` i `silero-vad/` (la còpia validada) | CC-BY-4.0 |
| `ferran-artero/fullstop-catalan-punctuation-prediction-onnx` | `onnx/model_q8pc.onnx` i fp32, tokenitzador i `config` | MIT |
| `UMUTeam/catalan_capitalization_punctuation_restoration_int8` | no es puja: la web el baixa del repositori oficial | Apache-2.0 |

- També s'han pujat les versions fp32, per a qui vulga fer-ne variants; la web no les baixa.
- Les fitxes (en català, amb un resum en anglés) expliquen els fitxers, les entrades i eixides,
  els resultats, la llicència, l'atribució i els canvis respecte a l'original (CC-BY-4.0 ho demana).
- `eines/models/publica_hf.py` puja els dos repositoris (un commit per repositori) i escriu les
  revisions. **La web fixa la revisió de cada repositori** a `web/js/motor/models.js`: la memòria cau
  del navegador va per adreça, i una adreça amb revisió fixa no canvia mai de contingut. Per a
  canviar de model, es puja i es canvia la revisió.
- Cada model té la seua font i el seu camí: la UMU té el model a l'arrel (`model.onnx`), però en
  local el guardem a `umu-oficial/onnx/` (primer error de la prova: 404).
- Comprovat al Chrome del PC (`?models=hf`): els models es baixen de Hugging Face amb la pàgina
  aïllada (COOP/COEP, sense problemes de CORS), es guarden a la memòria cau i la transcripció és
  la mateixa. Daniel Sancho: 2 min 49 s d'àudio en 1 min 32 s, amb la puntuació.
- La pàgina demana emmagatzematge persistent i avisa si el navegador no té espai per a guardar
  els models (en la prova automàtica, un navegador amb poca quota no va poder guardar la UMU).
- La llicència MIT ja surt al repositori de Softcatalà (sense fitxer LICENSE); la nostra fitxa
  manté l'atribució a Jordi Mas.

## 11. Passos pendents, en detall

### Fase 3 — El que queda: el mòbil

- **Decisió de viabilitat al mòbil:** que funcione en un Android i un iPhone de gamma mitjana
  (memòria, temps, que no es tanque la pestanya). Cal la web pública, és a dir, la fase 4: el
  *service worker* i la memòria cau només funcionen amb HTTPS o `localhost`.

### Fase 4 — El que queda

- Avisar en Jordi Mas (Softcatalà) amb l'enllaç a la conversió, tal com vam quedar.


### Fase 6 — Interfície i editor

- Pujar el fitxer (o arrossegar-lo), barra de progrés, previsualització del vídeo amb els
  subtítols i botó de descàrrega.
- **Formats:**
  - SRT i VTT;
  - TXT;
  - JSON amb el temps de cada paraula;
  - opcionalment ASS, amb estil.
- **Opció "ressalta cada paraula"**: ja feta a la fase 5 (`subtitols.js`); falta posar-la a la
  interfície. La previsualització (`previsualitza.html`) és el punt de partida.
- **Editor de la transcripció:** fas clic en una paraula i el vídeo salta allí; corregeixes
  paraules sense perdre els temps; buscar i substituir.
- **Sobre l'estil:** el SRT només guarda text i temps. La font, la mida, la posició i els colors
  es posen a l'editor:
  - a Premiere, amb l'estil de la pista de subtítols, que s'aplica a tots;
  - a CapCut, amb "aplicar a tots".
  
  La nostra eina ha de donar el millor text, els millors temps i els millors talls, i deixar
  l'estil a l'editor.

- **Editor de la transcripció (disseny acordat):** s'edita la llista de paraules, no el text del
  subtítol, perquè les correccions no es perden en canviar un paràmetre. Si el nombre de paraules
  no canvia, cada paraula conserva els seus temps; si canvia, es reparteixen per caràcters. Es
  torna a segmentar en acabar d'editar un subtítol (no mentre s'escriu). Desfer, i desar les
  correccions amb el JSON.
- Les correccions són dades per a ajustar el Conformer (fase 10): un dia, opcionalment i amb el
  consentiment de l'usuari, es podrien enviar.

### Fase 7 — Robustesa

- Vídeos llargs (més d'1 hora): llegir l'àudio per parts per a no omplir la memòria.
- Botó de cancel·lar i missatges d'error clars.
- Formats que el navegador no sap llegir.
- Proves en Chrome, Firefox, Safari, Android i iOS.

### Fase 8 — Proves automàtiques

- Ja fetes a mà amb Node (`proves/`): segmentació, mel, VAD, RNNT, motor complet i puntuació.
  Falta automatitzar-les i afegir-hi les de cap a cap.
- Proves de cap a cap (*end-to-end*) amb Playwright: pujar un fitxer i comprovar el SRT.
- Una petita "prova de regressió" amb els 38 clips i el vídeo, per a cada canvi.

### Fase 9 — Versió 1.0

- README del repositori actualitzat amb la web i com fer-la servir.
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

- **Exportar el vídeo amb els subtítols gravats** (estil CapCut): possible amb WebCodecs (ràpid
  en Chrome, Edge i Safari recents) o `ffmpeg.wasm` (lent). Té sentit per a qui no fa servir
  editor, però demana un editor d'estil (font, mida, posició, contorn). Després de la 1.0.

## 12. Petits pendents immediats

- [ ] Majúscula a mig de frase en interjeccions ("eh, **E** a dies d'avui"): probablement la
      regla de noms "fiables" de la UMU; excloure paraules d'una lletra i interjeccions.
- [ ] Provar a Premiere `<b>`, `<i>`, `<font color>` i el VTT; i a CapCut.
- [ ] Decidir si `desfas` -0,08 s per defecte.
- [x] Comprovar que la llicència MIT de Softcatalà ja surt a Hugging Face (sí, sense fitxer LICENSE).
- [ ] Fer una referència de 2–3 minuts de `prova_anamfent` (el cas difícil).
- [ ] Afegir els resultats d'aquesta setmana a l'informe setmanal de la beca.
- [ ] Opcional: esborrar de l'historial de GitHub `prova_raquel_apunt.json` i `.srt` (pujats per error).
- [ ] Comprovar la correcció de l'MP4 (`mp4.js`) a Firefox i Safari.
- [ ] Provar `<b>`, `<i>` i colors a CapCut amb un SRT fet per la pàgina.
