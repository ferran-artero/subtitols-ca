# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""Serveix la web en local per a provar-la, amb els models de la teua carpeta.

    python eines\\serveix.py --models ruta\\models_onnx        ->  http://localhost:8000/

La web busca els models a /models_onnx/ quan s'obri des de localhost. Per defecte s'envien les
capçaleres COOP/COEP (fils WASM); amb --sense-coi no s'envien, com a GitHub Pages, i així es
prova que el service worker (web/coi-serviceworker.js) les posa.
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ARREL = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--models", default=str(ARREL / "models_onnx"), help="carpeta dels models ONNX")
ap.add_argument("--port", type=int, default=8000)
ap.add_argument("--sense-coi", action="store_true", help="sense COOP/COEP, com GitHub Pages")
ARGS = ap.parse_args()
WEB, MODELS = ARREL / "web", Path(ARGS.models).resolve()


class Gestor(SimpleHTTPRequestHandler):
    # Windows pot tindre .js registrat com a text/plain: els mòduls no carregarien
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
                      ".json": "application/json", ".onnx": "application/octet-stream",
                      ".npy": "application/octet-stream"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def translate_path(self, path):
        cami = unquote(path.split("?", 1)[0].split("#", 1)[0])
        if cami.startswith("/models_onnx/"):
            dest = (MODELS / cami[len("/models_onnx/"):]).resolve()
            if MODELS in dest.parents:
                return str(dest)
        return super().translate_path(path)

    def end_headers(self):
        if not ARGS.sense_coi:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if self.path.endswith((".html", ".js", ".mjs", "/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):                  # només els errors
        if len(args) > 1 and str(args[1])[:1] in "45":
            super().log_message(fmt, *args)


if __name__ == "__main__":
    if not MODELS.is_dir():
        raise SystemExit(f"No trobe la carpeta dels models: {MODELS} (indica-la amb --models)")
    print(f"http://localhost:{ARGS.port}/  ({'SENSE' if ARGS.sense_coi else 'amb'} COOP/COEP, "
          f"models de {MODELS}; Ctrl+C per a parar)")
    ThreadingHTTPServer(("127.0.0.1", ARGS.port), Gestor).serve_forever()
