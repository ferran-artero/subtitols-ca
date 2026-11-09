// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ferran Artero Merino — vegeu NOTICE
//
// Service worker que afegeix les capçaleres COOP/COEP a les respostes del mateix origen.
// Calen perquè la pàgina estiga "aïllada" (crossOriginIsolated) i el motor puga fer servir
// diversos fils (SharedArrayBuffer). GitHub Pages no deixa posar capçaleres; la idea és la de
// coi-serviceworker (https://github.com/gzuidhof/coi-serviceworker, MIT), reescrita i reduïda.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (new URL(r.url).origin !== self.location.origin) return;           // la resta, sense tocar
  if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;
  e.respondWith(fetch(r).then((res) => {
    if (res.status === 0 || res.type === "opaqueredirect") return res;
    const h = new Headers(res.headers);
    h.set("Cross-Origin-Embedder-Policy", "require-corp");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }));
});
