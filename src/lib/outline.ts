export type OutlineItem = {
  id: string    // matches heading anchor ID from slugify()
  text: string  // display text
  level: number // 1-6 for markdown headings
}

/**
 * Converts heading text to a URL-safe slug for anchor IDs.
 * Shared between outline parser and FileViewer heading rendering.
 */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
}

/**
 * Extracts a structured outline from file content.
 * Currently supports markdown headings; extensible via category switch.
 */
export function parseOutline(content: string, category: string): OutlineItem[] {
  switch (category) {
    case 'markdown':
      return parseMarkdownOutline(content)
    default:
      return []
  }
}

function parseMarkdownOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = content.split('\n')
  let inCodeBlock = false

  for (const line of lines) {
    // Track fenced code blocks to avoid matching headings inside them
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = match[2].trim()
      items.push({ id: slugify(text), text, level })
    }
  }

  return items
}
