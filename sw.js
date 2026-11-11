/*
 * Офлайн-кэш сайта (Service Worker). Работает, когда сайт открыт по ссылке (http/https).
 * При первом открытии сохраняет в браузере все страницы, звуки и картинки —
 * дальше викторина идёт даже без интернета.
 *
 * Страница, код и стили: сначала из сети (чтобы видеть свежие правки), без сети — из кэша.
 * Звуки и картинки: сразу из кэша, а свежая копия тихо подкачивается в фоне.
 */
const CACHE = "quiz-v1";

self.window = self;
importScripts("js/data.js");

function assetList() {
  const files = [
    "./", "index.html", "css/style.css", "js/data.js", "js/sound.js", "js/app.js",
    "assets/fonts/onest-cyrillic-wght-normal.woff2", "assets/fonts/onest-latin-wght-normal.woff2",
  ];
  for (const r of self.QUIZ.rounds) {
    (r.sounds || []).forEach((s) => s.file && files.push(s.file));
    if (r.type === "closeup") r.items.forEach((it) => files.push(`assets/closeup/${it.prefix}_1.jpg`, `assets/closeup/${it.prefix}_2.jpg`));
    if (r.type === "frames") r.items.forEach((it) => files.push(`assets/frames/${it.file}.jpg`));
    (r.questions || []).forEach((q) => q.image && files.push(q.image));
  }
  return files;
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // по одному: если какой-то файл не скачался, остальные всё равно сохранятся
    await Promise.all(assetList().map((f) => cache.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Плееры звука просят файл кусками (Range). Отдаём нужный кусок из полной копии в кэше.
async function withRange(request, response) {
  const range = request.headers.get("range");
  if (!range) return response;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return response;
  const buf = await response.arrayBuffer();
  const size = buf.byteLength;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

// Свежая копия в кэш (только полные ответы, не куски)
async function refresh(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (res.ok && res.status === 200) await (await caches.open(CACHE)).put(url, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const key = url.origin + url.pathname; // без #хэша и ?параметров

  if (url.pathname.includes("/assets/")) {
    e.respondWith((async () => {
      const cached = await caches.match(key);
      if (cached) {
        e.waitUntil(refresh(key).catch(() => {}));
        return withRange(req, cached);
      }
      try {
        const res = await refresh(key);
        return withRange(req, res.clone());
      } catch {
        return fetch(req);
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = (await caches.match(key)) || (url.pathname.endsWith("/") && (await caches.match(key + "index.html")));
    const net = refresh(key);
    e.waitUntil(net.catch(() => {}));
    if (!cached) {
      try { return await net; } catch { return Response.error(); }
    }
    // плохой интернет: если сеть молчит дольше 3 секунд — берём из кэша
    const slow = new Promise((res) => setTimeout(() => res(null), 3000));
    try {
      const res = await Promise.race([net, slow]);
      if (res && res.ok) return res;
    } catch { /* нет сети */ }
    return cached;
  })());
});
