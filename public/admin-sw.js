'use strict';

// Never store the authenticated workspace, patient records, or API responses.
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    'PHC Doctor requires an internet connection. Reconnect and reload to continue.',
    {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}}
  )));
});
