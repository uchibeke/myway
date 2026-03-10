'use client'

import type { MessageAttachment } from '@/types/attachments'
import { formatSize } from '@/lib/file-types'

/** Max characters of file content injected per attachment (prevents prompt blowout). */
const MAX_ATTACH_CHARS = 4_000

/** Categories whose content can be read and injected inline. */
const TEXT_CATEGORIES = new Set(['code', 'data', 'text', 'markdown'])

/**
 * Enriches a user message with attached file context before sending to the AI.
 *
 * Text-readable files (code, data, text, markdown):
 *   Content is fetched from /api/files and appended as a fenced block.
 *
 * Images / PDFs / binary files:
 *   A short metadata note is appended instead (no content fetch).
 *
 * Security: all fetches go through /api/files which enforces isPathAllowed().
 * Content is capped at MAX_ATTACH_CHARS per file to prevent injection.
 */
export async function enrichWithAttachments(
  text: string,
  attachments: MessageAttachment[],
): Promise<string> {
  if (attachments.length === 0) return text

  const parts: string[] = [text.trim()]

  for (const att of attachments) {
    if (TEXT_CATEGORIES.has(att.category)) {
      try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(att.path)}`)
        if (res.ok) {
          const data = await res.json() as { content?: string | null; binary?: boolean }
          if (data.content && !data.binary) {
            const excerpt = data.content.length > MAX_ATTACH_CHARS
              ? data.content.slice(0, MAX_ATTACH_CHARS) + '\n… [truncated]'
              : data.content
            parts.push(`\n---\nAttached file: \`${att.name}\`\n\`\`\`${att.ext.replace('.', '')}\n${excerpt}\n\`\`\``)
            continue
          }
        }
      } catch {
        // Fall through to metadata note
      }
    }

    // Non-text or fetch failed — include metadata only
    const sizeStr = formatSize(att.size)
    if (att.category === 'image') {
      parts.push(`\n[Image attached: ${att.name} (${sizeStr})]`)
    } else if (att.category === 'pdf') {
      parts.push(`\n[PDF attached: ${att.name} (${sizeStr}) — cannot read content inline]`)
    } else {
      parts.push(`\n[File attached: ${att.name} (${sizeStr}, ${att.category})]`)
    }
  }

  return parts.join('')
}
