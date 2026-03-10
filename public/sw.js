/**
 * Myway Service Worker
 *
 * Mobile-only caching: detects device via User-Agent in the install event.
 * Desktop and dev environments get no caching to avoid stale-content issues.
 *
 * Cache strategy: Network-first with cache fallback for app shell assets.
 * API routes and streaming endpoints are never cached.
 */

const CACHE_NAME = 'myway-v1'

// Assets to pre-cache on mobile install
const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
]

// True if the user agent looks like a mobile device
function isMobileUA(ua) {
  return /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(ua)
}

// Never cache these patterns
function shouldSkipCache(url) {
  const path = new URL(url).pathname
  return (
    path.startsWith('/api/') ||
    path.startsWith('/_next/webpack-hmr') ||
    path.includes('__nextjs') ||
    path.includes('hot-update')
  )
}

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately
  self.skipWaiting()

  // Only pre-cache on mobile
  const ua = self.navigator?.userAgent || ''
  if (!isMobileUA(ua)) return

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  )
})

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  // Clean old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ─── Fetch ────────────────────────────────────────────────────────────────────
// Network-first: try network, fall back to cache on mobile only.
// Desktop gets pure pass-through (no caching).

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GET requests
  if (request.method !== 'GET') return

  // Never cache API routes, HMR, or streaming
  if (shouldSkipCache(request.url)) return

  // Only cache on mobile devices
  const ua = request.headers.get('user-agent') || self.navigator?.userAgent || ''
  if (!isMobileUA(ua)) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses for offline fallback
        if (response.ok && response.type === 'basic') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(request).then((cached) => {
          if (cached) return cached
          // Fallback to app shell for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/') || new Response('Offline', { status: 503 })
          }
          return new Response('Offline', { status: 503 })
        })
      })
  )
})
