# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
"""Serveix la web en local per a provar-la, amb els models de la teua carpeta.

    python eines\\serveix.py --models ruta\\models_onnx        ->  http://localhost:8000/
                                                               http://localhost:8000/banc/banc.html

La web busca els models a /models_onnx/ quan s'obri des de localhost. Per defecte s'envien les
capçaleres COOP/COEP (fils WASM); amb --sense-coi no s'envien, com a GitHub Pages, i així es
prova que el service worker (web/coi-serviceworker.js) les posa.

També serveix el banc de proves del motor (proves/banc/), amb:
    /referencies/   les referències de Python (proves/referencia_motor.py; --referencies)
    /dades/         els àudios originals (--dades o SUBTITOLS_DADES), per a la font «navegador»
i desa a resultats/banc/navegador/ el que el banc envia a /desa/.
"""
import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ARREL = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--models", default=str(ARREL / "models_onnx"), help="carpeta dels models ONNX")
ap.add_argument("--referencies", default=str(ARREL / "resultats" / "proves" / "motor"),
                help="referències de Python per al banc de proves")
ap.add_argument("--dades", default=os.environ.get("SUBTITOLS_DADES"),
                help="carpeta dels àudios originals (per defecte, $SUBTITOLS_DADES)")
ap.add_argument("--port", type=int, default=8000)
ap.add_argument("--sense-coi", action="store_true", help="sense COOP/COEP, com GitHub Pages")
ARGS = ap.parse_args()
WEB, MODELS = ARREL / "web", Path(ARGS.models).resolve()
DESA = (ARREL / "resultats" / "banc" / "navegador").resolve()
# prefix de l'adreça -> carpeta (la resta de camins són de web/)
CARPETES = {"/models_onnx/": MODELS, "/banc/": (ARREL / "proves" / "banc").resolve(),
            "/referencies/": Path(ARGS.referencies).resolve()}
if ARGS.dades:
    CARPETES["/dades/"] = Path(ARGS.dades).resolve()


class Servidor(ThreadingHTTPServer):
    # A Windows, SO_REUSEADDR deixa obrir un segon servidor al mateix port sense cap error, i les
    # peticions continuen anant a l'antic: millor que falli i ho digui.
    allow_reuse_address = os.name != "nt"


def dins(base: Path, relatiu: str) -> str | None:
    dest = (base / relatiu).resolve()
    return str(dest) if base == dest or base in dest.parents else None


class Gestor(SimpleHTTPRequestHandler):
    # Windows pot tindre .js registrat com a text/plain: els mòduls no carregarien
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
                      ".json": "application/json", ".onnx": "application/octet-stream",
                      ".npy": "application/octet-stream", ".txt": "text/plain; charset=utf-8"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def translate_path(self, path):
        cami = unquote(path.split("?", 1)[0].split("#", 1)[0])
        for prefix, base in CARPETES.items():
            if cami.startswith(prefix):
                return dins(base, cami[len(prefix):]) or str(WEB / "no-existeix")
        return super().translate_path(path)

    def end_headers(self):
        if not ARGS.sense_coi:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if self.path.endswith((".html", ".js", ".mjs", "/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        """El banc de proves hi desa els resultats: /desa/<etiqueta>/<àudio>.json."""
        if not self.path.startswith("/desa/"):
            self.send_error(404)
            return
        dest = dins(DESA, unquote(self.path[len("/desa/"):]))
        if not dest:
            self.send_error(403)
            return
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):                  # només els errors
        if len(args) > 1 and str(args[1])[:1] in "45":
            super().log_message(fmt, *args)


if __name__ == "__main__":
    if not MODELS.is_dir():
        raise SystemExit(f"No trobe la carpeta dels models: {MODELS} (indica-la amb --models)")
    print(f"http://localhost:{ARGS.port}/  ({'SENSE' if ARGS.sense_coi else 'amb'} COOP/COEP, "
          f"models de {MODELS}; Ctrl+C per a parar)")
    print(f"banc de proves: http://localhost:{ARGS.port}/banc/banc.html  (dades: "
          f"{CARPETES['/dades/'] if ARGS.dades else 'cap; per a la font «navegador», --dades o SUBTITOLS_DADES'})")
    if ARGS.dades and not CARPETES["/dades/"].is_dir():
        print(f"[avís] No existeix la carpeta de dades: {CARPETES['/dades/']}")
    try:
        servidor = Servidor(("127.0.0.1", ARGS.port), Gestor)
    except OSError as e:
        raise SystemExit(f"No puc obrir el port {ARGS.port} ({e}). Potser ja hi ha un servidor obert: "
                         f"tanca'l o fes servir --port.")
    servidor.serve_forever()
