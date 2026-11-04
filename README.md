# subtitols-ca

**Subtítols automàtics en català, dins del teu navegador.** Puja un vídeo o un àudio i obtén
subtítols SRT/VTT amb puntuació i majúscules, a punt per a Premiere o CapCut. Tot s'executa al
navegador: el vídeo no ix mai del teu ordinador o mòbil i no cal instal·lar res.

Està pensat per a creadors de contingut en català, amb atenció especial al **valencià** i al
**balear**.

🌐 **Web:** https://ferran-artero.github.io/subtitols-ca/

> **Estat:** en desenvolupament. El motor de reconeixement i la segmentació dels subtítols ja
> funcionen i estan validats en Python (`eines/`). Ara s'estan portant al navegador. Fins que no
> estiga acabat, la web no transcriu.

---

## Com funciona

```
vídeo/àudio ─► àudio 16 kHz ─► detecció de veu ─► reconeixement ─► puntuació ─► subtítols
                               (Silero VAD)       (Conformer)      (Softcatalà   (SRT / VTT)
                                                                     + UMU)
```

1. **Detecció de veu.** Silero VAD troba on es parla i talla l'àudio en trossos de com a molt
   25 s, pels silencis.
2. **Reconeixement.** El Conformer-Transducer del Projecte AINA
   (`stt_ca-es_conformer_transducer_large`) transcriu cada tros i dona l'instant de cada paraula.
3. **Rescat de frases perdudes.** Si en un tros queda un forat sense paraules on el detector diu
   que hi ha veu, aquell tros es torna a reconéixer amb altres paràmetres i, si cal, amb una
   finestra curta al voltant del forat. En àudios nets no s'activa mai.
4. **Puntuació i majúscules.** Els signes els posa el model de Softcatalà i les majúscules dels
   noms propis, el de la Universitat de Múrcia.
5. **Subtítols.** Es talla on menys molesta (signes, pauses; mai darrere d'un article o una
   preposició) respectant els caràcters per línia, les línies i la velocitat de lectura. Hi ha
   perfils per a vídeo horitzontal, vertical (Reels, TikTok) i accessibilitat, i es pot ressaltar
   cada paraula quan es pronuncia (subratllat, color o efecte karaoke).

Tots els models s'executen amb ONNX Runtime. La web els baixa la primera vegada (≈ 460 MB) i
després els guarda en la memòria cau del navegador.

## Resultats actuals

Motor de referència en Python, a la CPU d'un portàtil sense GPU:

| Prova | WER | WER amb signes i majúscules | F1 puntuació | F1 majúscules | Frases perdudes |
|---|---|---|---|---|---|
| 38 frases curtes (19 en valencià, 19 en balear) | 9,4 % | 14,0 % | 0,76 | 0,90 | – |
| Vídeo de notícies en balear amb música (2,8 min) | 7,0 % | 11,7 % | 0,78 | 0,91 | 0 |

- **Sincronia:** les paraules comencen 0,08 s (mediana) després del subtítol de referència.
- **Velocitat:** un vídeo de 3 minuts es transcriu en uns 30 s (RTF ≈ 0,18).

La majoria d'errors que queden són formes dialectals que el model normalitza ("varen" → "van",
"idò"). Es corregiran ajustant el model amb dades balears.

## Estructura del repositori

```
subtitols-ca/
├── web/              # la pàgina (és l'única carpeta que es publica a GitHub Pages)
├── eines/            # motor de referència en Python i preparació dels models
│   ├── transcriu.py  # àudio o vídeo -> subtítols, des de la línia d'ordres
│   ├── motor_ref/    # el motor complet (numpy + onnxruntime + tokenizers) i la segmentació
│   └── models/       # converteixen i quantitzen els models a ONNX
├── docs/             # història del projecte i decisions
├── MODELS.md         # models, autors, llicències i cites
├── LICENSE           # GPL-3.0
└── NOTICE            # condició d'atribució
```

## Fer servir el motor en Python

Mentre la web no estiga acabada, es pot transcriure des de la línia d'ordres. Cal Python 3.10 o
posterior.

```bash
pip install -r eines/requirements.txt
python eines/transcriu.py el_meu_video.mp4 --models ruta/a/models_onnx
python eines/transcriu.py el_meu_video.mp4 --perfil vertical --ressalta progres --color groc
```

Escriu `el_meu_video.json` (paraules amb temps, signes i majúscules) i els subtítols
(`el_meu_video.horitzontal.srt`…). Totes les opcions són a [`eines/README.md`](eines/README.md).

Per a generar els models (`models_onnx/`) cal NeMo. Vegeu [`eines/README.md`](eines/README.md).
Quan estiguen publicats a Hugging Face, n'hi haurà prou de baixar-los.

## Full de ruta

- [x] **Fase 0:** repositori, GitHub Pages i llicència
- [x] **Fase 1:** models convertits a ONNX i quantitzats sense perdre qualitat
- [x] **Fase 2:** motor de referència en Python, validat peça a peça
- [ ] **Fase 3:** motor en JavaScript al navegador (WASM / WebGPU)
- [ ] **Fase 4:** models publicats a Hugging Face
- [x] **Fase 5:** segmentació dels subtítols (caràcters per línia, velocitat de lectura, talls
      per frases, perfils per a vídeo horitzontal i vertical, ressaltat de paraules)
- [ ] **Fase 6:** interfície: pujar, previsualitzar, editar la transcripció i descarregar
      SRT/VTT/TXT
- [ ] **Fases 7–9:** robustesa, proves automàtiques i versió 1.0
- [ ] **Després:** ajust del model amb dades balears i valencianes, i subtítols en temps real

La història completa del projecte i el perquè de cada decisió són a
[`docs/HISTORIA_I_DECISIONS.md`](docs/HISTORIA_I_DECISIONS.md).

## Models i llicències

El codi és de Ferran Artero Merino i es distribueix sota **GPL-3.0** amb una **condició
d'atribució** (vegeu [`NOTICE`](NOTICE)). Si en feu servir o en distribuïu una versió derivada,
cal citar l'autor i el projecte.

Els models són dels seus autors i tenen les seues pròpies llicències:

| Funció | Model | Llicència |
|---|---|---|
| Reconeixement de veu | Projecte AINA, Conformer-Transducer ca-es (a partir de NVIDIA NeMo) | CC-BY-4.0 |
| Signes de puntuació | Softcatalà, `fullstop-catalan-punctuation-prediction` | MIT |
| Majúscules | UMUTeam, Universidad de Murcia (int8 oficial) | Apache-2.0 |
| Detecció de veu | Silero VAD | MIT |

Els detalls i les cites són a [`MODELS.md`](MODELS.md).

## Com citar-lo

```bibtex
@software{artero_subtitols_ca_2026,
  author = {Artero Merino, Ferran},
  title  = {subtitols-ca: subtítols automàtics en català al navegador},
  year   = {2026},
  url    = {https://github.com/ferran-artero/subtitols-ca}
}
```

Si en feu servir els resultats, citeu també els models de [`MODELS.md`](MODELS.md),
especialment l'article de la UMU (Pan et al., 2023).

## Agraïments

Aquest projecte es desenvolupa amb una beca de recerca de **ValgrAI** a l'institut **VRAIN** de la
Universitat Politècnica de València. Gràcies al **Projecte AINA** (Barcelona Supercomputing
Center) pel model de reconeixement de veu, a **Softcatalà** (Jordi Mas) i al **UMUTeam** de la
Universidad de Murcia pels models de puntuació, i a **Silero** pel detector de veu.
