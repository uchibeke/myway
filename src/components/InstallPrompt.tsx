'use client'

import { useEffect } from 'react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { Download, X, Share } from 'lucide-react'

/**
 * InstallPrompt — psychology-driven PWA install banner.
 *
 * Never shows on arrival. Waits for value moments signaled via:
 *   - `signalInstallValue()` helper (from any component)
 *   - Custom DOM event 'myway:value' (for non-React callers)
 *
 * Qualification: 3+ sessions, value received this session, 30s+ in session.
 * Dismiss → 7-day cooldown. Install → never shows again.
 *
 * Position: bottom toast, above safe area. Non-blocking.
 */

export default function InstallPrompt() {
  const install = useInstallPrompt()

  // Listen for value signals from anywhere in the app
  useEffect(() => {
    const handler = () => install.signalValue()
    window.addEventListener('myway:value', handler)
    return () => window.removeEventListener('myway:value', handler)
  }, [install.signalValue])

  if (!install.canShow || install.isInstalled) return null

  // iOS manual install guide overlay
  if (install.showIOSGuide) {
    return (
      <div className="fixed inset-0 z-[10001] flex items-end justify-center bg-black/60 backdrop-blur-sm
                      animate-[fade-in_0.3s_ease-out]">
        <div className="w-full max-w-md mx-4 mb-[calc(var(--sab)+16px)] bg-zinc-900 rounded-2xl
                        border border-white/10 p-5 shadow-2xl
                        animate-[slide-up_0.4s_cubic-bezier(0.16,1,0.3,1)]">
          <div className="flex items-start justify-between mb-4">
            <h3 className="text-white font-semibold text-base">Add to Home Screen</h3>
            <button onClick={install.dismiss}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10
                         text-white/60 hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm">1</span>
              </div>
              <p className="text-white/70 text-sm leading-relaxed">
                Tap the <Share size={14} className="inline text-blue-400 -mt-0.5" /> <span className="text-white">Share</span> button in Safari&apos;s toolbar
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm">2</span>
              </div>
              <p className="text-white/70 text-sm leading-relaxed">
                Scroll down and tap <span className="text-white">&quot;Add to Home Screen&quot;</span>
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm">3</span>
              </div>
              <p className="text-white/70 text-sm leading-relaxed">
                Tap <span className="text-white">&quot;Add&quot;</span> — Myway opens instantly like a native app
              </p>
            </div>
          </div>

          <button onClick={install.dismiss}
            className="w-full mt-5 py-2.5 rounded-xl bg-white/10 text-white/60 text-sm
                       hover:bg-white/15 transition-colors">
            Got it
          </button>
        </div>
      </div>
    )
  }

  // Standard install banner (Chrome/Edge/Samsung)
  return (
    <div className="fixed bottom-[calc(var(--sab)+16px)] left-4 right-4 z-[9998]
                    max-w-md mx-auto
                    animate-[slide-up_0.5s_cubic-bezier(0.16,1,0.3,1)]">
      <div className="bg-zinc-900/95 backdrop-blur-xl rounded-2xl border border-white/10
                      shadow-2xl shadow-black/50 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-[var(--brand-primary)]/20 flex items-center justify-center shrink-0">
          <Download size={18} className="text-[var(--brand-primary)]" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">Add Myway to your home screen</p>
          <p className="text-white/40 text-xs mt-0.5">Opens instantly. No app store needed.</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={install.dismiss}
            className="text-white/30 text-xs hover:text-white/60 transition-colors px-2 py-1">
            Later
          </button>
          <button onClick={install.prompt}
            className="px-4 py-2 rounded-xl bg-[var(--brand-primary)] text-white text-sm font-medium
                       hover:brightness-110 transition-all active:scale-95">
            Install
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Signal that the user received value. Call from anywhere.
 * Fires a custom DOM event that InstallPrompt listens for.
 *
 * Good moments to call:
 *   - After AI finishes a response
 *   - After a task is completed
 *   - After a note is saved
 *   - After a Somni story is generated
 *   - After a Roast is delivered
 */
export function signalInstallValue(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('myway:value'))
  }
}
