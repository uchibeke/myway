'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

type AuthState =
  | { status: 'idle' }       // No partner token in URL — self-hosted mode
  | { status: 'loading' }    // Exchanging token
  | { status: 'authenticated'; sessionToken: string }
  | { status: 'error'; message: string }

export default function PartnerAuthProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const partnerToken = searchParams.get('partnerToken')
  const [auth, setAuth] = useState<AuthState>(
    partnerToken ? { status: 'loading' } : { status: 'idle' },
  )
  const fetchOverrideInstalled = useRef(false)
  const originalFetchRef = useRef<typeof window.fetch | null>(null)

  function installFetchOverride(sessionToken: string) {
    if (fetchOverrideInstalled.current) return

    const originalFetch = window.fetch
    originalFetchRef.current = originalFetch
    fetchOverrideInstalled.current = true

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url

      if (url.startsWith('/api/') && !url.startsWith('/api/partner/auth')) {
        const headers = new Headers(init?.headers)
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${sessionToken}`)
        }
        return originalFetch(input, { ...init, headers })
      }

      return originalFetch(input, init)
    }
  }

  useEffect(() => {
    if (!partnerToken) return

    let cancelled = false

    async function authenticate() {
      try {
        // Use the real fetch (not any overridden version)
        const res = await window.fetch('/api/partner/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: partnerToken }),
        })

        if (cancelled) return

        const data = await res.json()

        if (!data.success) {
          setAuth({ status: 'error', message: data.error || 'Authentication failed' })
          return
        }

        // Install fetch override BEFORE setting state (so children render with auth ready)
        installFetchOverride(data.sessionToken)
        setAuth({ status: 'authenticated', sessionToken: data.sessionToken })
      } catch {
        if (!cancelled) {
          setAuth({ status: 'error', message: 'Network error during authentication' })
        }
      }
    }

    authenticate()
    return () => { cancelled = true }
  }, [partnerToken])

  // Cleanup fetch override on unmount
  useEffect(() => {
    return () => {
      if (fetchOverrideInstalled.current && originalFetchRef.current) {
        window.fetch = originalFetchRef.current
        fetchOverrideInstalled.current = false
      }
    }
  }, [])

  // No partner token — self-hosted mode, render immediately
  if (auth.status === 'idle') {
    return <>{children}</>
  }

  // Loading
  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          <p className="text-sm text-white/60">Authenticating…</p>
        </div>
      </div>
    )
  }

  // Error
  if (auth.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-center">
          <p className="mb-2 text-sm font-medium text-red-400">Authentication failed</p>
          <p className="text-xs text-white/40">{auth.message}</p>
        </div>
      </div>
    )
  }

  // Authenticated
  return <>{children}</>
}
