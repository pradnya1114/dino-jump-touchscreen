/*
 * Dino Jump — offline service worker.
 *
 * Keeps a complete copy of the kiosk (pages, scripts, styles, fonts, images)
 * on the device, so the game opens and runs with no connection at all.
 *
 *  - Pages:          network first (always fresh when online); the device copy
 *                    is used when the server cannot be reached.
 *  - Build files:    /_next/static/* never change -> served from the device copy.
 *  - Images, fonts:  network first with a short timeout, device copy as fallback.
 *  - API calls:      never touched here. Game data is handled by the app itself
 *                    (saved on the device first, then synced — see src/lib/sync.ts).
 */
const PAGES = "dinojump-pages-v1";
const ASSETS = "dinojump-assets-v1";
const META = "dinojump-meta-v1";
const VERSION_KEY = "/__offline-version";
const MANIFEST_URL = "/api/offline";
const ROUTES = ["/", "/rules", "/play", "/results", "/hardware"];
const NET_TIMEOUT_MS = 3500;
const SERVER_DOWN_MS = 20000;

let serverDownUntil = 0;
let refreshJob = null;
let probing = false;

const isBuildFile = (path) => path.startsWith("/_next/static/");
const normalize = (path) => (path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path);

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("timeout"));
      }
    }, ms);
    fetch(request).then(
      (res) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(res);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      },
    );
  });
}

// After a failed request the device copy is used straight away for a short
// while, so a kiosk on a dead network does not wait for a timeout every time.
function markServerDown() {
  serverDownUntil = Date.now() + SERVER_DOWN_MS;
}

function probeServer() {
  if (probing) return;
  probing = true;
  fetchWithTimeout(new Request("/api/health", { cache: "no-store" }), NET_TIMEOUT_MS)
    .then(
      (res) => {
        if (res.ok) serverDownUntil = 0;
      },
      () => {},
    )
    .then(() => {
      probing = false;
    });
}

// Build files and optimised images a page refers to. Covers hosts that cannot
// list their own files for the manifest.
function filesInHtml(html) {
  const found = new Set();
  const build = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\\\s<>)]+/g;
  let m;
  while ((m = build.exec(html))) {
    found.add(m[0].startsWith("/_next/") ? m[0] : "/_next/" + m[0]);
  }
  const image = /\/_next\/image\?[^"'\s<>]+/g;
  while ((m = image.exec(html))) found.add(m[0].replace(/&amp;/g, "&"));
  return found;
}

async function pool(items, size, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

async function offlineStatus() {
  const pages = await caches.open(PAGES);
  const keys = await pages.keys();
  const meta = await caches.open(META);
  const stored = await meta.match(VERSION_KEY);
  return { ready: keys.length >= ROUTES.length, version: stored ? await stored.text() : null };
}

// Downloads a complete, consistent copy of the kiosk. Files first, pages last:
// an update that is cut off half-way can never leave a page that points at
// files which are not on the device.
async function refreshOfflineCopy() {
  const res = await fetchWithTimeout(new Request(MANIFEST_URL, { cache: "no-store" }), 15000);
  if (!res.ok) throw new Error("offline manifest answered " + res.status);
  const manifest = await res.json();
  const before = await offlineStatus();
  if (before.ready && before.version === manifest.version) {
    return { ready: true, updated: false, version: manifest.version };
  }

  const routes = Array.isArray(manifest.routes) && manifest.routes.length ? manifest.routes : ROUTES;
  const wanted = new Set(Array.isArray(manifest.files) ? manifest.files : []);
  const fetched = [];
  for (const route of routes) {
    let page = await fetch(route, { cache: "no-store", credentials: "same-origin" });
    if (!page.ok) throw new Error(route + " answered " + page.status);
    const html = await page.clone().text();
    filesInHtml(html).forEach((file) => wanted.add(file));
    if (page.redirected) {
      // a redirected response cannot be replayed for a page load
      page = new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    fetched.push([route, page]);
  }

  const assets = await caches.open(ASSETS);
  await pool(Array.from(wanted), 6, async (file) => {
    const url = new URL(file, self.location.origin);
    if (url.origin !== self.location.origin) return;
    const immutable = isBuildFile(url.pathname);
    if (immutable && (await assets.match(url.href))) return;
    const r = await fetch(url.href, { cache: "no-store", credentials: "same-origin" });
    if (r.ok) await assets.put(url.href, r);
    else if (immutable) throw new Error(url.pathname + " answered " + r.status);
  });

  const pages = await caches.open(PAGES);
  for (const [route, page] of fetched) await pages.put(route, page);
  const meta = await caches.open(META);
  await meta.put(VERSION_KEY, new Response(String(manifest.version)));
  return { ready: true, updated: true, version: manifest.version, files: wanted.size };
}

function refreshOnce() {
  if (!refreshJob) {
    refreshJob = refreshOfflineCopy().then(
      (result) => {
        refreshJob = null;
        return result;
      },
      (err) => {
        refreshJob = null;
        throw err;
      },
    );
  }
  return refreshJob;
}

// Installing only succeeds once the whole kiosk is stored on the device.
self.addEventListener("install", (event) => {
  event.waitUntil(refreshOnce().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// The app asks for a refresh when it is online (new version / changed images)
// and for the status when it is not.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (payload) => {
    if (port) port.postMessage(payload);
  };
  if (data.type === "refresh-offline-copy") {
    event.waitUntil(
      refreshOnce().then(
        (result) => reply(Object.assign({ ok: true }, result)),
        async (err) =>
          reply(
            Object.assign({ ok: false, error: String((err && err.message) || err) }, await offlineStatus()),
          ),
      ),
    );
  } else if (data.type === "offline-status") {
    event.waitUntil(offlineStatus().then((status) => reply(Object.assign({ ok: true }, status))));
  }
});

async function pageResponse(request, url) {
  const pages = await caches.open(PAGES);
  const cached = await pages.match(normalize(url.pathname), { ignoreSearch: true, ignoreVary: true });
  if (cached && Date.now() < serverDownUntil) {
    probeServer();
    return cached;
  }
  try {
    const fresh = await fetchWithTimeout(request, cached ? NET_TIMEOUT_MS : 20000);
    if (fresh.status >= 500 && cached) {
      markServerDown();
      return cached;
    }
    serverDownUntil = 0;
    return fresh;
  } catch (err) {
    markServerDown();
    if (cached) return cached;
    const home = await pages.match("/", { ignoreVary: true });
    if (home) return home;
    return new Response(
      "<!doctype html><meta charset='utf-8'><title>Dino Jump — offline</title>" +
        "<body style='margin:0;font-family:sans-serif;background:#0b0620;color:#fff;display:grid;place-items:center;height:100vh;text-align:center'>" +
        "<div><h1>Dino Jump is offline</h1><p>Open the kiosk once while connected to finish setting up offline mode.</p></div>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

async function buildFile(request) {
  const assets = await caches.open(ASSETS);
  const cached = await assets.match(request, { ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) assets.put(request, res.clone()).catch(() => {});
  return res;
}

async function publicFile(request) {
  const assets = await caches.open(ASSETS);
  const cached = await assets.match(request, { ignoreVary: true });
  if (cached && Date.now() < serverDownUntil) {
    probeServer();
    return cached;
  }
  try {
    const fresh = await fetchWithTimeout(request, cached ? NET_TIMEOUT_MS : 20000);
    if (fresh.status === 200 && fresh.type === "basic") {
      assets.put(request, fresh.clone()).catch(() => {});
    }
    if (fresh.status >= 500 && cached) return cached;
    return fresh;
  } catch (err) {
    markServerDown();
    if (cached) return cached;
    throw err;
  }
}

// /_next/image resizes pictures on the server. Offline, the original picture
// from the device copy is used instead.
async function optimizedImage(request, url) {
  const assets = await caches.open(ASSETS);
  if (Date.now() >= serverDownUntil) {
    try {
      const fresh = await fetchWithTimeout(request, NET_TIMEOUT_MS);
      if (fresh.ok) {
        assets.put(request, fresh.clone()).catch(() => {});
        return fresh;
      }
    } catch (err) {
      markServerDown();
    }
  }
  const cached = await assets.match(request, { ignoreVary: true });
  if (cached) return cached;
  const original = url.searchParams.get("url");
  if (original && original.charAt(0) === "/") {
    const raw = await assets.match(new URL(original, self.location.origin).href, { ignoreVary: true });
    if (raw) return raw;
  }
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/") || path === "/sw.js") return;
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (isBuildFile(path)) {
    event.respondWith(buildFile(request));
    return;
  }
  if (path === "/_next/image") {
    event.respondWith(optimizedImage(request, url));
    return;
  }
  if (path.startsWith("/_next/")) return;

  const looksLikeFile = /\.[a-z0-9]{2,5}$/i.test(path);
  if (request.mode === "navigate" && !looksLikeFile) {
    event.respondWith(pageResponse(request, url));
    return;
  }
  event.respondWith(publicFile(request));
});
