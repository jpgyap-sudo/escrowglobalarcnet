// Intentionally no financial/API caching. A stale balance must not appear freshly verified.
// The bundled standalone HTML is the supported offline experience.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
