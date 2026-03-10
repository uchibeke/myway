/**
 * Generate a unique ID string for client-side use (React keys, message IDs).
 *
 * Uses crypto.randomUUID() where available (Chrome 92+, Safari 15.4+),
 * falls back to a Math.random-based generator for older browsers.
 *
 * NOT for security — use Web Crypto API directly for cryptographic needs.
 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: v4-style UUID from Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
