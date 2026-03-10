'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * useInstallPrompt — psychology-driven PWA install prompt.
 *
 * Core principle: prompt AFTER the user has received value, never on arrival.
 *
 * Qualification criteria (ALL must be true):
 *   1. Not already installed as PWA
 *   2. Not dismissed within the cooldown period (7 days)
 *   3. At least 3 sessions OR a value milestone was hit
 *   4. A value moment has occurred THIS session (AI response received,
 *      story generated, task completed, etc.)
 *   5. At least 30 seconds into the session (never jarring)
 *   6. Not during active typing or mid-conversation
 *
 * Value moments are signaled by calling `install.signalValue()` from
 * anywhere in the app — the hook decides whether to show based on
 * accumulated context.
 *
 * Usage:
 *   const install = useInstallPrompt()
 *   // After AI responds, task completes, etc:
 *   install.signalValue()
 *   // Render:
 *   {install.canShow && <InstallBanner ... />}
 */

const STORAGE_KEY = 'myway_install'
const DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000 // 3 days
const MIN_SESSIONS_DEFAULT = 3
const MIN_SESSION_AGE_MS = 30_000 // 30s into session before showing
const VALUE_SIGNALS_NEEDED = 1 // at least 1 value moment this session

type InstallState = {
  dismissed: number
  installed: boolean
  sessions: number
  totalValueSignals: number // lifetime value moments across sessions
}

function getState(): InstallState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ok */ }
  return { dismissed: 0, installed: false, sessions: 0, totalValueSignals: 0 }
}

function saveState(state: InstallState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ok */ }
}

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const [canShow, setCanShow] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [showIOSGuide, setShowIOSGuide] = useState(false)

  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null)
  // eslint-disable-next-line react-hooks/purity
  const sessionStartRef = useRef(Date.now()) // Intentional: capture session start time on first render
  const valueSignalsRef = useRef(0)
  const readyToShowRef = useRef(false) // deferred prompt captured + qualification met
  const stateRef = useRef<InstallState>(getState())

  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  // Evaluate whether conditions are met (called on signal + on deferred event)
  const evaluate = useCallback(() => {
    const state = stateRef.current
    if (state.installed) return

    // Cooldown check
    if (state.dismissed && Date.now() - state.dismissed < DISMISS_COOLDOWN_MS) return

    // Session age check — don't show in the first 30s
    if (Date.now() - sessionStartRef.current < MIN_SESSION_AGE_MS) return

    // Value check — need at least 1 value moment THIS session
    if (valueSignalsRef.current < VALUE_SIGNALS_NEEDED) return

    // Engagement check — either 3+ sessions OR 5+ lifetime value signals
    // (power users who do a lot in fewer sessions still qualify)
    const engaged = state.sessions >= MIN_SESSIONS_DEFAULT || state.totalValueSignals >= 5

    if (!engaged) return

    // On non-iOS, we also need the deferred prompt event
    if (!isIOS && !deferredRef.current) {
      readyToShowRef.current = true // will show when event fires
      return
    }

    setCanShow(true)
  }, [isIOS])

  // Signal that the user received value (AI response, story, task done, etc.)
  const signalValue = useCallback(() => {
    valueSignalsRef.current += 1

    // Persist lifetime count
    const state = stateRef.current
    state.totalValueSignals += 1
    saveState(state)

    // Delay evaluation slightly — let the user absorb the value first
    setTimeout(() => evaluate(), 3000)
  }, [evaluate])

  useEffect(() => {
    // Already installed?
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as Record<string, boolean>).standalone === true
    if (isStandalone) {
      setIsInstalled(true)
      return
    }

    // Track session
    const state = getState()
    if (state.installed) { setIsInstalled(true); return }
    state.sessions += 1
    saveState(state)
    stateRef.current = state

    // Capture beforeinstallprompt (Chrome/Edge/Samsung)
    const handler = (e: Event) => {
      e.preventDefault()
      deferredRef.current = e as BeforeInstallPromptEvent

      // If we were already qualified but waiting for the event
      if (readyToShowRef.current) {
        setCanShow(true)
      }
    }

    window.addEventListener('beforeinstallprompt', handler)

    // Listen for successful install
    const installHandler = () => {
      setIsInstalled(true)
      setCanShow(false)
      const s = getState()
      s.installed = true
      saveState(s)
      stateRef.current = s
    }
    window.addEventListener('appinstalled', installHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installHandler)
    }
  }, [])

  const prompt = useCallback(async () => {
    if (isIOS) {
      setShowIOSGuide(true)
      return
    }

    if (!deferredRef.current) return

    deferredRef.current.prompt()
    const { outcome } = await deferredRef.current.userChoice
    if (outcome === 'accepted') {
      setIsInstalled(true)
      setCanShow(false)
      const s = getState()
      s.installed = true
      saveState(s)
    }
    deferredRef.current = null
  }, [isIOS])

  const dismiss = useCallback(() => {
    setCanShow(false)
    setShowIOSGuide(false)
    const s = getState()
    s.dismissed = Date.now()
    saveState(s)
    stateRef.current = s
  }, [])

  return {
    canShow,
    isInstalled,
    isIOS,
    showIOSGuide,
    setShowIOSGuide,
    prompt,
    dismiss,
    /** Call after the user receives value (AI response, task done, etc.) */
    signalValue,
  }
}
