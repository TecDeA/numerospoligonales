/* ==========================================================================
   Service Worker — "Números Poligonales y Figurados" (PWA)
   -------------------------------------------------------------------------
   - Scope:    /numerospoligonales/  (auto-impuesto por la ubicación del SW)
   - App shell: index.html + manifest + iconos
   - CDN:      stale-while-revalidate para Tailwind, KaTeX, Three.js, fonts
   - Estrategia principal: la app funciona offline tras la primera visita.
   - No interfiere con el portal raíz (tecdea.github.io) porque el scope está
     limitado a /numerospoligonales/.
   ========================================================================== */

const SW_VERSION = "v1.0.0";
const APP_SHELL_CACHE = `npf-shell-${SW_VERSION}`;
const RUNTIME_CACHE = `npf-runtime-${SW_VERSION}`;
const FONT_CACHE = `npf-fonts-${SW_VERSION}`;

// Recursos del app shell (relativos al scope del SW).
const APP_SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.ico",
  "./favicon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./maskable-192.png",
  "./maskable-512.png",
  "./og-image.png"
];

// Recursos de CDN (Tailwind, KaTeX, Three.js, Google Fonts) — runtime cache.
const CDN_HOSTS = [
  "cdn.tailwindcss.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com"
];

// ---------------------------------------------------------------------------
// INSTALL: precachear el app shell local.
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      // Usamos addAll con control de errores individuales: si un icono
      // opcional falla, no rompemos toda la instalación.
      await Promise.all(
        APP_SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (err) {
            console.warn("[SW] No se pudo precachear:", url, err);
          }
        })
      );
      // Activar inmediatamente para tomar el control del scope.
      await self.skipWaiting();
    })()
  );
});

// ---------------------------------------------------------------------------
// ACTIVATE: limpiar caches antiguas y tomar el control.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("npf-") &&
              key !== APP_SHELL_CACHE &&
              key !== RUNTIME_CACHE &&
              key !== FONT_CACHE
          )
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      console.log(`[SW] ${SW_VERSION} activo. Scope: ${self.registration.scope}`);
    })()
  );
});

// ---------------------------------------------------------------------------
// FETCH: estrategia de enrutamiento.
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo interceptar GET. Otros métodos (POST, etc.) pasan directo a la red.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1) Navegaciones (HTML): network-first con fallback a la versión cacheada
  //    del index.html (modo offline). Así el usuario siempre ve la última
  //    versión publicada, pero puede seguir usándola sin conexión.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(APP_SHELL_CACHE);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (err) {
          const cache = await caches.open(APP_SHELL_CACHE);
          const cached =
            (await cache.match(req)) ||
            (await cache.match("./index.html")) ||
            (await cache.match("./"));
          if (cached) return cached;
          return new Response(
            "<h1>Sin conexión</h1><p>No se pudo cargar la aplicación.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  // 2) Recursos del mismo origen (nuestros iconos, manifest, etc.):
  //    cache-first con background revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        const fetchPromise = fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200 && resp.type === "basic") {
              const respClone = resp.clone();
              caches.open(APP_SHELL_CACHE).then((c) => c.put(req, respClone));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })()
    );
    return;
  }

  // 3) Recursos de CDN: stale-while-revalidate (imprescindible para que la
  //    app funcione offline tras la primera visita).
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((resp) => {
            if (resp && (resp.status === 200 || resp.status === 0)) {
              cache.put(req, resp.clone());
            }
            return resp;
          })
          .catch(() => cached);
        // Devolver cache si existe, si no esperar a la red.
        return cached || network;
      })()
    );
    return;
  }

  // 4) Resto de peticiones: probar red, fallback a cache.
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })()
  );
});

// ---------------------------------------------------------------------------
// MESSAGE: permite forzar actualización desde la página.
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
