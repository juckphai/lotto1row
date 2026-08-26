const CACHE_NAME = 'pos-cache-v250869';
const STATIC_CACHE = 'pos-static-v250869';
const DYNAMIC_CACHE = 'pos-dynamic-v250869';

// เพิ่ม Static Files ให้ครบถ้วน
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './192.png',
  // เพิ่มไฟล์อื่นๆ ที่จำเป็น
  // './dashboard.html',
  // './report.html',
  // './icons/icon-512.png'
];

// 1. ติดตั้ง Service Worker และเก็บไฟล์ลงเครื่อง (Install)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('📦 Caching static assets...');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('✅ Service Worker installed!');
        return self.skipWaiting(); // อัปเดตทันที ไม่ต้องรอ
      })
  );
});

// 2. อัปเดต Cache เมื่อมีเวอร์ชันใหม่ (Activate)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // ลบ Cache เก่าทั้งหมด ยกเว้นของเวอร์ชันปัจจุบัน
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker activated!');
      return self.clients.claim(); // ควบคุมหน้าเว็บทันที
    })
  );
});

// 3. ดึงข้อมูลจากเครื่องหรือเน็ต (Fetch)
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // --- จุดสำคัญ: Firebase/Google API ปล่อยผ่านไปเลย (ห้าม Cache) ---
  if (url.origin.includes('googleapis.com') || 
      url.origin.includes('firebase') ||
      url.origin.includes('firestore.googleapis.com') ||
      url.pathname.includes('firestore')) {
    // ปล่อยให้โหลดจากเน็ตปกติ ไม่ต้องยุ่งกับ Cache
    event.respondWith(fetch(request));
    return;
  }

  // --- จุดสำคัญ: CDN ภายนอกให้ใช้ Cache First ---
  if (url.origin !== self.location.origin) {
    if (url.hostname.includes('cdn.jsdelivr.net') || 
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('unpkg.com')) {
      event.respondWith(
        caches.match(request)
          .then(response => response || fetch(request))
      );
      return;
    }
    // โดเมนอื่นที่ไม่ใช่ CDN ปล่อยผ่าน
    event.respondWith(fetch(request));
    return;
  }

  // --- Navigation (การเปลี่ยนหน้า) ใช้ Network First ---
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // ถ้าโหลดสำเร็จ ให้เก็บใน Dynamic Cache
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // ถ้า offline ให้ใช้ Cache หรือกลับไปหน้า index.html
          return caches.match(request)
            .then(response => response || caches.match('./index.html'));
        })
    );
    return;
  }

  // --- Static Files (CSS, JS, รูปภาพ) ใช้ Cache First ---
  if (request.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|webp|woff2|ttf)$/)) {
    event.respondWith(
      caches.match(request)
        .then(response => {
          if (response) {
            // เจอใน Cache ก็ใช้เลย
            return response;
          }
          // ถ้าไม่เจอ ให้ไปโหลดจากเน็ตแล้วเก็บ Cache
          return fetch(request).then(response => {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE).then(cache => {
              cache.put(request, responseClone);
            });
            return response;
          });
        })
    );
    return;
  }

  // --- กรณีอื่นๆ (API, JSON, etc.) ใช้ Network First ---
  event.respondWith(
    fetch(request)
      .then(response => {
        // ถ้าโหลดสำเร็จ ให้เก็บใน Dynamic Cache (เฉพาะ GET)
        if (request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // ถ้า offline และหา Cache ไม่เจอ
        return caches.match(request);
      })
  );
});