/* Service worker: ทำให้ติดตั้งเป็นแอปได้ และเปิดดูข้อมูลล่าสุดที่โหลดไว้ได้ตอนออฟไลน์
   - ไฟล์หน้าเว็บ: ใช้ของในเครื่องก่อน แล้วอัปเดตเบื้องหลัง
   - ไฟล์ข้อมูล (data/, config/): ดึงใหม่จากเน็ตก่อนเสมอ ถ้าไม่ได้ค่อยใช้ของเก่า */
const VERSION = "v3";
const SHELL = ["./", "index.html", "assets/app.css", "assets/app.js", "assets/rules.js", "assets/indicators.js", "assets/export.js",
  "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open("shell-" + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const isData = url.origin === location.origin && /\/(data|config)\//.test(url.pathname);
  if (isData) {
    const key = url.origin + url.pathname; // ไม่สน ?t=
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open("data-" + VERSION).then(c => c.put(key, copy));
      return r;
    }).catch(async () => {
      const hit = await caches.match(key);
      if (!hit) throw new Error("offline");
      const h = new Headers(hit.headers); h.set("x-from-cache", "1");
      return new Response(await hit.blob(), { status: 200, headers: h });
    }));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => {
      if (r.ok && (url.origin === location.origin || url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com") || url.hostname === "cdnjs.cloudflare.com")) {
        const copy = r.clone(); caches.open("shell-" + VERSION).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});
