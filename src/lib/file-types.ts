/**
 * Central file type system.
 * Used by: FileIcon, FileViewer, FileEditor, API route.
 * No Node.js imports — safe for client and server.
 */

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'markdown'
  | 'code'
  | 'data'
  | 'text'
  | 'archive'
  | 'binary'

const EXT_MAP: Record<string, FileCategory> = {
  // Images
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
  '.webp': 'image', '.svg': 'image', '.bmp': 'image', '.ico': 'image', '.avif': 'image',
  // PDF
  '.pdf': 'pdf',
  // Documents
  '.docx': 'document', '.doc': 'document',
  // Spreadsheets
  '.xlsx': 'spreadsheet', '.xls': 'spreadsheet',
  // Video
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.avi': 'video',
  '.mkv': 'video', '.m4v': 'video',
  // Audio
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.aac': 'audio', '.m4a': 'audio',
  // Markdown
  '.md': 'markdown', '.mdx': 'markdown',
  // Code
  '.ts': 'code', '.tsx': 'code', '.js': 'code', '.jsx': 'code',
  '.mjs': 'code', '.cjs': 'code', '.py': 'code', '.rb': 'code',
  '.go': 'code', '.rs': 'code', '.java': 'code', '.c': 'code',
  '.cpp': 'code', '.h': 'code', '.cs': 'code', '.php': 'code',
  '.sh': 'code', '.bash': 'code', '.zsh': 'code', '.fish': 'code',
  '.css': 'code', '.scss': 'code', '.less': 'code', '.html': 'code',
  '.xml': 'code', '.sql': 'code', '.graphql': 'code', '.tf': 'code',
  '.prisma': 'code',
  // Data
  '.json': 'data', '.yaml': 'data', '.yml': 'data', '.toml': 'data',
  '.ini': 'data', '.conf': 'data', '.env': 'data', '.csv': 'data',
  '.lock': 'data',
  // Text
  '.txt': 'text', '.log': 'text', '.gitignore': 'text',
  '.dockerignore': 'text', '.editorconfig': 'text',
  // Archives
  '.zip': 'archive', '.tar': 'archive', '.gz': 'archive',
  '.rar': 'archive', '.7z': 'archive', '.bz2': 'archive',
}

export function getCategory(ext: string): FileCategory {
  return EXT_MAP[ext.toLowerCase()] ?? 'binary'
}

/** Maps file extension to a CodeMirror language string */
export function getLanguageKey(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'tsx', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.rb': 'ruby',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.css': 'css', '.scss': 'css',
    '.html': 'html', '.xml': 'html',
    '.md': 'markdown', '.mdx': 'markdown',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  }
  return map[ext.toLowerCase()] ?? 'text'
}

/** Only allow editing of text-based file categories */
export function isEditable(category: FileCategory): boolean {
  return ['markdown', 'code', 'data', 'text'].includes(category)
}

/** Whether the file can be previewed inline (not just metadata) */
export function isPreviewable(category: FileCategory): boolean {
  return category !== 'binary' && category !== 'archive'
}

/** Whether the file can be shown inline in a conversation attachment chip */
export function isInlinePreviewable(category: FileCategory): boolean {
  return category === 'image' || category === 'pdf'
}

/** Whether the file needs server-side conversion to preview */
export function needsConversion(category: FileCategory): boolean {
  return category === 'document' || category === 'spreadsheet'
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffDays === 0) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  if (diffDays === 1) {
    return `Yesterday, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: diffDays > 365 ? 'numeric' : undefined,
  })
}
