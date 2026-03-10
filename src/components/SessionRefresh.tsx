'use client'

import { useEffect, useRef, useCallback } from 'react'
import { uid } from '@/lib/uid'

/**
 * Silent session refresh for direct-access (cookie-based) users.
 *
 * How it works:
 * 1. Every 60s, checks session expiry via /api/auth/status
 * 2. When < 2 min remaining, opens a hidden iframe to AppRoom's /auth/myway?silent=true
 * 3. AppRoom generates a fresh partner token and sends it via postMessage
 * 4. We POST the token to /auth/callback to get a fresh session cookie
 * 5. No user interruption — completely invisible
 *
 * Only active when NEXT_PUBLIC_APPROOM_URL is set (direct-access mode).
 * Iframe users (PartnerAuthProvider) manage their own sessions.
 */
export default function SessionRefresh() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const refreshingRef = useRef(false)
  const appRoomUrl = process.env.NEXT_PUBLIC_APPROOM_URL || ''

  const handleMessage = useCallback(async (event: MessageEvent) => {
    if (!appRoomUrl) return

    // Verify origin
    try {
      const expected = new URL(appRoomUrl).origin
      if (event.origin !== expected) return
    } catch { return }

    if (event.data?.type === 'myway_auth' && event.data.partnerToken) {
      // POST the fresh token to our callback to get a new session cookie
      try {
        const callbackUrl = new URL('/auth/callback', window.location.origin)
        const body = new URLSearchParams()
        body.set('partnerToken', event.data.partnerToken)
        body.set('state', event.data.state || '')

        await fetch(callbackUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          credentials: 'same-origin',
          redirect: 'manual', // Don't follow the redirect
        })
      } catch {
        // Silent failure — next check will retry
      } finally {
        refreshingRef.current = false
        cleanup()
      }
    } else if (event.data?.type === 'myway_auth_error') {
      // AppRoom session expired — user will need to re-login on next page nav
      refreshingRef.current = false
      cleanup()
    }
  }, [appRoomUrl])

  function cleanup() {
    if (iframeRef.current) {
      iframeRef.current.remove()
      iframeRef.current = null
    }
  }

  async function createBoundState(): Promise<string> {
    const nonce = uid()
    const callbackUrl = new URL('/auth/callback', window.location.origin).toString()
    // HMAC-bind state to the callback URL (same scheme as server-side middleware)
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(callbackUrl),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(nonce))
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return `${nonce}.${sigHex}`
  }

  function triggerSilentRefresh() {
    if (refreshingRef.current || !appRoomUrl) return
    refreshingRef.current = true

    // HMAC-bound state cookie — prevents reuse for different redirect targets
    createBoundState().then(state => {
      document.cookie = `myway_auth_state=${state}; path=/; max-age=120; SameSite=Lax; Secure`

      const callbackUrl = new URL('/auth/callback', window.location.origin).toString()
      const src = `${appRoomUrl}/auth/myway?redirect=${encodeURIComponent(callbackUrl)}&state=${state}&silent=true`

      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.src = src
      document.body.appendChild(iframe)
      iframeRef.current = iframe

      // Timeout: if no response in 45s, clean up
      setTimeout(() => {
        if (refreshingRef.current) {
          refreshingRef.current = false
          cleanup()
        }
      }, 45000)
    }).catch(() => {
      refreshingRef.current = false
    })
  }

  useEffect(() => {
    if (!appRoomUrl) return

    window.addEventListener('message', handleMessage)

    // Check session status periodically
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/status', { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json()
        // If session expires in < 2 minutes, trigger silent refresh
        if (data.expiresIn && data.expiresIn < 120) {
          triggerSilentRefresh()
        }
      } catch {
        // Status check failed — not critical
      }
    }, 60000)

    return () => {
      window.removeEventListener('message', handleMessage)
      clearInterval(interval)
      cleanup()
    }
  }, [appRoomUrl, handleMessage])

  return null // Invisible component
}
