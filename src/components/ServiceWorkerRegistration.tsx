'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker on mount.
 * Only registers in production — dev uses Next.js HMR which conflicts with SW caching.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV === 'production'
    ) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[SW] Registration failed:', err)
      })
    }
  }, [])

  return null
}
