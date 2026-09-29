/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] }

self.skipWaiting()
clientsClaim()

// App shell (HTML, JS, CSS, WASM decoder, icons) for offline start.
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Barcode images come from short-lived signed URLs. Cache them by object path,
// ignoring the token query string, so a previously viewed image works offline.
// Supabase API responses (card data) are NOT cached here; the app's own
// IndexedDB query cache handles offline data and is wiped on sign-out.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.includes('/storage/v1/object/sign/card-images/'),
  new CacheFirst({
    cacheName: 'card-images',
    plugins: [
      {
        cacheKeyWillBeUsed: async ({ request }) => {
          const url = new URL(request.url)
          return `${url.origin}${url.pathname}`
        },
      },
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 }),
    ],
  }),
)
