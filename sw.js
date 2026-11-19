/* 오프라인 동작: 앱 파일은 인터넷이 되면 최신으로 받고 저장, 안 되면 저장본 사용 */
const VERSION = "tango-v7";
const SHELL = ["./", "index.html", "app.js", "segment.js", "recognizer.js", "patterns.js", "manifest.webmanifest",
               "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // 글꼴(Google Fonts): 저장된 것 먼저, 없으면 받아서 저장
  if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    e.respondWith(caches.open(VERSION).then(c => c.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; }))));
    return;
  }
  // 앱 파일: 인터넷이 되면 항상 최신 파일, 안 되면 저장된 파일
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(c =>
      fetch(e.request, {cache: "no-cache"}).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; })
        .catch(() => c.match(e.request, {ignoreSearch: true}))));
  }
});
