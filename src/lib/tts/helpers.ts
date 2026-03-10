/**
 * TTS helpers — pure functions, no provider logic.
 */

/**
 * Deterministic asset ID from content. Same text -> same ID -> audio persists
 * across sessions regardless of ephemeral component IDs.
 *
 * Uses FNV-1a hash of full content, returns a short base-36 string prefixed with 'v'.
 */
export function stableAssetId(text: string): string {
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Include length to reduce collisions for texts with same chars
  h ^= text.length
  h = Math.imul(h, 0x01000193)
  return `v${(h >>> 0).toString(36)}`
}

/**
 * Strip markdown formatting for clean TTS input.
 * Removes headings, bold, italic, code, blockquotes, list markers, links, images.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^[-*_]{3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Estimate expected audio duration from text.
 *
 * Uses ~130 WPM for a slow, soothing bedtime/deep voice pace.
 * Returns seconds.
 */
export function estimateDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  const minutes = words / 130
  return Math.max(3, Math.round(minutes * 60))
}
