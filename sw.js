/* Service worker — offline keš. Aplikacija radi i bez interneta posle prve posete. */
const CACHE = "razumem-nalaz-v6";
const CORE = [
  "./","./index.html","./styles.css","./app.js","./db.js","./fonts/fonts.css",
  "./manifest.webmanifest","./icons/icon.svg","./icons/icon-192.png","./icons/icon-512.png"
];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method!=="GET") return;
  // stale-while-revalidate: brzo iz keša, u pozadini osveži (uklj. Tesseract CDN)
  e.respondWith(
    caches.open(CACHE).then(async cache=>{
      const cached = await cache.match(req);
      const network = fetch(req).then(res=>{
        if(res && (res.ok || res.type==="opaque")) cache.put(req, res.clone()).catch(()=>{});
        return res;
      }).catch(()=>cached);
      return cached || network;
    })
  );
});
