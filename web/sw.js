// Mô Hub — service worker tối giản để trình duyệt cho "Cài đặt ứng dụng".
// Nguyên tắc: LUÔN lấy bản mới từ mạng (dữ liệu vận hành phải đúng từng phút).
// Chỉ khi mất mạng mới hiện trang báo offline. Không đụng tới Supabase/CDN.
const BAN = "mo-hub-v1";
const OFFLINE = "offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(BAN).then((c) => c.addAll([OFFLINE, "assets/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== BAN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Chỉ xử lý việc mở trang của chính Mô Hub; mọi thứ khác đi thẳng ra mạng như bình thường
  if (req.mode !== "navigate" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
