/**
 * Haptics service — centralized haptic feedback for voice interactions.
 *
 * Wraps navigator.vibrate with event-specific patterns. Fails silently on
 * unsupported platforms (iOS PWA, desktop). No component should call
 * navigator.vibrate directly — use this service instead.
 *
 * Vibration is gated behind user interaction — browsers block vibrate()
 * until the user has tapped/clicked. We listen once for any interaction
 * and only then allow calls through.
 *
 * CLIENT SAFE — works in both 'use client' components and plain modules.
 */

let activated = false

if (typeof window !== 'undefined') {
  const activate = () => { activated = true }
  window.addEventListener('pointerdown', activate, { once: true, capture: true })
  window.addEventListener('keydown', activate, { once: true, capture: true })
}

function vibrate(pattern: number | number[]): void {
  if (!activated) return
  try { navigator.vibrate?.(pattern) } catch { /* unsupported — silent */ }
}

/** Mic activated — short pulse. Call alongside recognition.start() / getUserMedia(). */
export function micStart(): void { vibrate(50) }

/** Mic deactivated — double pulse. Call on recognition end / stream stop. */
export function micStop(): void { vibrate([30, 30, 30]) }

/** TTS/speech started playing — soft pulse. Call alongside audio.play(). */
export function speechStart(): void { vibrate(20) }
