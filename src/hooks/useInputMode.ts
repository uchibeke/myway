'use client'

import { useState, useEffect } from 'react'

/**
 * Detects whether the device has a fine pointer (mouse/trackpad) — i.e. desktop.
 *
 * On desktop: Enter should send, Shift+Enter for newline.
 * On mobile:  Enter is newline, Send button sends (no reliable Shift+Enter on soft keyboards).
 *
 * Uses `(hover: hover) and (pointer: fine)` — the standard CSS media query for
 * "has a mouse". Avoids UA sniffing and responds to dynamic changes (e.g. tablet
 * with keyboard dock).
 *
 * SSR default: false (mobile-first) to avoid hydration mismatch on phones.
 */
export function useInputMode(): { isDesktop: boolean } {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    setIsDesktop(mq.matches)

    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return { isDesktop }
}
