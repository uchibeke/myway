'use client'

/**
 * Frontend hook — fetches integration status once per page session.
 *
 * Config doesn't change at runtime, so we cache at module level and
 * never re-fetch. All components sharing this hook see the same data.
 */

import { useState, useEffect } from 'react'

type StatusPayload = {
  integrations: Record<string, { configured: boolean; name: string; setupHint: string }>
  ttsAvailable: boolean
}

// Module-level cache — survives re-renders and component remounts.
let cached: StatusPayload | null = null
let fetchPromise: Promise<StatusPayload | null> | null = null

function fetchStatus(): Promise<StatusPayload | null> {
  if (cached) return Promise.resolve(cached)
  if (fetchPromise) return fetchPromise

  fetchPromise = fetch('/api/integrations/status')
    .then((r) => (r.ok ? (r.json() as Promise<StatusPayload>) : null))
    .then((data) => {
      if (data) cached = data
      return data
    })
    .catch(() => null)
    .finally(() => { fetchPromise = null })

  return fetchPromise
}

export function useIntegrationStatus() {
  const [data, setData] = useState<StatusPayload | null>(cached)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    if (cached) {
      setData(cached)
      setLoading(false)
      return
    }
    fetchStatus().then((result) => {
      setData(result)
      setLoading(false)
    })
  }, [])

  return {
    ttsAvailable: data?.ttsAvailable ?? false,
    isConfigured: (id: string) => data?.integrations[id]?.configured ?? false,
    loading,
  }
}
