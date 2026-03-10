'use client'

import { useState, useEffect } from 'react'

export interface HistoryItem {
  conversationId: string
  title: string | null
  messageCount: number
  lastContent: string
  lastMetadata: Record<string, unknown>
  lastMessageAt: number
}

/**
 * Fetch recent app history items (conversations + last assistant message).
 * Generic hook — apps transform HistoryItem into domain-specific cards.
 */
export function useAppHistory(appId: string, limit = 5) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetch(`/api/store/history?appId=${encodeURIComponent(appId)}&limit=${limit}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: HistoryItem[]) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [appId, limit])

  return { items, loading }
}
