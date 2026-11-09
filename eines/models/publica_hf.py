# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""Publica els models convertits a Hugging Face (fase 4): un repositori per al Conformer (+ Silero
VAD) i un per al puntuador de Softcatalà. La UMU no es puja: la web la baixa del seu repositori.

    hf auth login                                   # una vegada, amb un token d'escriptura
    python eines\\models\\publica_hf.py --models ruta\\models_onnx            # només mostra què es pujaria
    python eines\\models\\publica_hf.py --models ruta\\models_onnx --puja     # crea els repositoris i puja

En acabar, escriu les revisions (commit) que cal fixar a web/js/motor/models.js: la memòria cau
del navegador va per adreça, i una adreça amb revisió fixa no canvia mai de contingut.
"""
import argparse
from pathlib import Path

USUARI = "ferran-artero"
UMU = "UMUTeam/catalan_capitalization_punctuation_restoration_int8"
FITXES = Path(__file__).resolve().parent / "fitxes_hf"

# repositori -> (fitxa, {camí al repositori: camí dins de models_onnx})
REPOS = {
    f"{USUARI}/stt_ca-es_conformer_transducer_large-onnx": ("conformer.md", {
        "encoder.q8w.onnx": "conformer-ca-es/encoder.q8w.onnx",
        "encoder.onnx": "conformer-ca-es/encoder.onnx",
        "decoder_joint.onnx": "conformer-ca-es/decoder_joint.onnx",
        "config.json": "conformer-ca-es/config.json",
        "tokens.txt": "conformer-ca-es/tokens.txt",
        "mel_fb.npy": "conformer-ca-es/mel_fb.npy",
        "finestra.npy": "conformer-ca-es/finestra.npy",
        "silero-vad/silero_vad.onnx": "silero-vad/silero_vad.onnx",
        "silero-vad/LICENSE": "silero-vad/LICENSE",
        "silero-vad/CITATION.cff": "silero-vad/CITATION.cff",
    }),
    f"{USUARI}/fullstop-catalan-punctuation-prediction-onnx": ("softcatala.md", {
        "onnx/model_q8pc.onnx": "softcatala/onnx/model_q8pc.onnx",
        "onnx/model.onnx": "softcatala/onnx/model.onnx",
        "tokenizer.json": "softcatala/tokenizer.json",
        "tokenizer_config.json": "softcatala/tokenizer_config.json",
        "config.json": "softcatala/config.json",
    }),
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", default=str(Path(__file__).resolve().parents[2] / "models_onnx"))
    ap.add_argument("--puja", action="store_true", help="puja de veritat (sense això, només ho mostra)")
    args = ap.parse_args()
    models = Path(args.models)

    from huggingface_hub import CommitOperationAdd, HfApi
    api = HfApi()
    revisions = {}
    for repo, (fitxa, fitxers) in REPOS.items():
        print(f"\n== {repo}")
        ops = [CommitOperationAdd("README.md", str(FITXES / fitxa))]
        for desti, origen in fitxers.items():
            ruta = models / origen
            if not ruta.exists():
                raise SystemExit(f"Falta {ruta}")
            print(f"   {desti:32} {ruta.stat().st_size / 1e6:8.1f} MB   <- {origen}")
            ops.append(CommitOperationAdd(desti, str(ruta)))
        if args.puja:
            api.create_repo(repo, repo_type="model", exist_ok=True)
            info = api.create_commit(repo, ops, commit_message="Models en ONNX per a subtitols-ca")
            revisions[repo] = info.oid
            print(f"   pujat: {info.commit_url}")
    if not args.puja:
        print("\n(No s'ha pujat res. Afegeix --puja per a publicar-ho.)")
        return
    revisions[UMU] = api.model_info(UMU).sha
    print("\nRevisions per a web/js/motor/models.js:")
    for repo, rev in revisions.items():
        print(f'   "{repo}": "{rev}",')


if __name__ == "__main__":
    main()
