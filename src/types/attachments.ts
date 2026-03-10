/**
 * Shared attachment type used by FilePicker, AppShell, and message enrichment.
 * Represents a server-side file attached to a conversation message.
 */
export type MessageAttachment = {
  /** Display name (basename of the file). */
  name: string
  /** Absolute server-side path — validated by isPathAllowed() before use. */
  path: string
  size: number
  /** File category from file-types.ts (e.g. 'code', 'pdf', 'image'). */
  category: string
  ext: string
}
