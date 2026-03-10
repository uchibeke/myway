/**
 * GET /api/roast/context
 *
 * Returns a text summary of the user's recent files from MYWAY_ROOT.
 * This is injected as context into the roast prompt so the AI can roast
 * the user based on their *actual* files — not generic nonsense.
 *
 * Returns: { context: string, fileCount: number }
 */

import { readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const MYWAY_ROOT = process.env.MYWAY_ROOT ?? process.cwd()
const MAX_FILES = 15
const MAX_DEPTH = 3

type FileEntry = {
  rel: string
  size: number
  mtime: Date
}

function walk(dir: string, depth = 0): FileEntry[] {
  if (depth > MAX_DEPTH) return []
  let results: FileEntry[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isFile()) {
        const st = statSync(full)
        results.push({ rel: relative(MYWAY_ROOT, full), size: st.size, mtime: st.mtime })
      } else if (e.isDirectory()) {
        results = results.concat(walk(full, depth + 1))
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results
}

function fmtSize(b: number) {
  if (b < 1024) return `${b}B`
  if (b < 1_048_576) return `${(b / 1024).toFixed(0)}KB`
  return `${(b / 1_048_576).toFixed(1)}MB`
}

function fmtAge(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export async function GET() {
  const files = walk(MYWAY_ROOT)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, MAX_FILES)

  if (files.length === 0) {
    return Response.json({
      context: 'User\'s vault appears empty or inaccessible.',
      fileCount: 0,
    })
  }

  const lines = files.map(f => `  • ${f.rel} (${fmtSize(f.size)}, ${fmtAge(f.mtime)})`)
  const context = [
    `User's vault — ${files.length} most recently modified files:`,
    ...lines,
  ].join('\n')

  return Response.json({ context, fileCount: files.length })
}
