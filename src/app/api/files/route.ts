import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getRoot, isPathAllowed, getLinks, findLinkForPath } from '@/lib/fs-config'
import { getCategory, isEditable } from '@/lib/file-types'
import { isTenantUser, isHostedMode, listHostedFiles, getHostedFile, getStorageUsage } from '@/lib/hosted-storage'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

// Text-previewable extensions (≤ 200KB read as UTF-8)
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.mdx', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config',
  '.env', '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.go',
  '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.php', '.css', '.scss',
  '.html', '.xml', '.svg', '.sql', '.csv', '.log', '.gitignore',
  '.dockerignore', '.lock', '.prisma', '.graphql', '.tf',
])

const MAX_PREVIEW_BYTES = 200_000

function getRoot_orError(): { root: string } | { response: NextResponse } {
  try {
    return { root: getRoot() }
  } catch {
    return {
      response: NextResponse.json(
        { error: 'File system not configured' },
        { status: 503 }
      ),
    }
  }
}

// ── GET ────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // In hosted mode, require a tenant ID — never expose the shared/server filesystem
  const tenantId = getTenantId(req)
  if (isHostedMode() && !tenantId) {
    return NextResponse.json({
      path: 'Home',
      displayPath: 'Home',
      parent: null,
      isRoot: true,
      type: 'dir',
      entries: [],
      count: 0,
      hosted: true,
    })
  }

  // Hosted/tenant mode: serve files from artifact store (never expose server filesystem)
  if (isTenantUser({ tenantId })) {
    const db = getDb(tenantId)
    const fileId = req.nextUrl.searchParams.get('path')

    // Single file by ID
    if (fileId && fileId !== 'Home') {
      const file = getHostedFile(db, fileId)
      if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({
        path: file.id,
        displayPath: file.name,
        name: file.name,
        parent: 'Home',
        isRoot: false,
        type: 'file',
        ext: file.ext,
        category: file.category,
        size: file.size,
        modified: file.modified,
        editable: false, // hosted files are not editable in-place
        isLink: false,
        content: null,
        binary: true,
      })
    }

    // Directory listing (root)
    const files = listHostedFiles(db)
    const usage = getStorageUsage(db)
    return NextResponse.json({
      path: 'Home',
      displayPath: 'Home',
      parent: null,
      isRoot: true,
      type: 'dir',
      entries: files.map(f => ({
        name: f.name,
        path: f.id,
        type: 'file',
        size: f.size,
        modified: f.modified,
        birthtime: f.modified,
        ext: f.ext,
        category: f.category,
        isLink: false,
        childCount: null,
      })),
      count: files.length,
      hosted: true,
      storage: usage,
    })
  }

  const result = getRoot_orError()
  if ('response' in result) return result.response
  const { root } = result

  const rawPath = req.nextUrl.searchParams.get('path') || root
  const resolved = path.resolve(rawPath)

  if (!isPathAllowed(resolved)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    const stat = fs.statSync(resolved)

    if (stat.isDirectory()) {
      const isRoot = resolved === root

      const entries = fs
        .readdirSync(resolved)
        .filter((name) => !name.startsWith('.') || name.startsWith('.env'))
        .map((name) => {
          const fullPath = path.join(resolved, name)
          try {
            const s = fs.statSync(fullPath)
            const ext = s.isDirectory() ? null : path.extname(name).toLowerCase()
            // For directories, count visible children for the size column
            let childCount: number | null = null
            if (s.isDirectory()) {
              try {
                childCount = fs.readdirSync(fullPath)
                  .filter((n) => !n.startsWith('.') || n.startsWith('.env'))
                  .length
              } catch {
                childCount = null
              }
            }
            return {
              name,
              path: fullPath,
              type: s.isDirectory() ? 'dir' : 'file',
              size: s.size,
              modified: s.mtime.toISOString(),
              birthtime: s.birthtime.toISOString(),
              ext,
              category: ext ? getCategory(ext) : null,
              isLink: false,
              childCount,
            }
          } catch {
            return { name, path: fullPath, type: 'unknown', size: 0, modified: '', birthtime: '', ext: null, category: null, isLink: false, childCount: null }
          }
        })
        .sort((a: { type: string; name: string }, b: { type: string; name: string }) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1
          if (a.type !== 'dir' && b.type === 'dir') return 1
          return a.name.localeCompare(b.name)
        })

      // Inject virtual link entries at home root
      if (isRoot) {
        for (const link of getLinks()) {
          try {
            const t = path.resolve(link.target)
            const s = fs.statSync(t)
            const ext = s.isDirectory() ? null : path.extname(link.name).toLowerCase()
            let childCount: number | null = null
            if (s.isDirectory()) {
              try {
                childCount = fs.readdirSync(t)
                  .filter((n) => !n.startsWith('.') || n.startsWith('.env'))
                  .length
              } catch {
                childCount = null
              }
            }
            entries.push({
              name: link.name,
              path: t,
              type: s.isDirectory() ? 'dir' : 'file',
              size: s.size,
              modified: s.mtime.toISOString(),
              birthtime: s.birthtime.toISOString(),
              ext,
              category: ext ? getCategory(ext ?? '') : null,
              isLink: true,
              childCount,
            })
          } catch {
            // Broken link — skip silently
          }
        }
      }

      // Compute display path and parent, accounting for link context
      const linkMatch = findLinkForPath(resolved)
      let displayPath: string
      let parent: string | null

      if (isRoot) {
        displayPath = 'Home'
        parent = null
      } else if (linkMatch) {
        // Inside a link target — show as "linkName/relative/subpath"
        displayPath = linkMatch.link.name + linkMatch.relative
        // At the root of the link (relative = '') → parent is Home
        // Inside the link → parent is the real parent dir (also allowed)
        parent = linkMatch.relative ? path.dirname(resolved) : root
      } else {
        displayPath = resolved.slice(root.length) || '/'
        parent = path.dirname(resolved)
      }

      return NextResponse.json({
        path: resolved,
        displayPath,
        parent,
        isRoot,
        type: 'dir',
        entries,
        count: entries.length,
      })
    }

    // ── File ──────────────────────────────────────────────────────────────────
    const ext = path.extname(resolved).toLowerCase()
    const category = getCategory(ext)
    const canPreview = TEXT_EXTENSIONS.has(ext) && stat.size <= MAX_PREVIEW_BYTES

    // Compute display path and parent for files (including linked files)
    const linkMatch = findLinkForPath(resolved)
    let displayPath: string
    let parent: string

    if (linkMatch) {
      displayPath = linkMatch.link.name + linkMatch.relative
      // At the root of a linked file (no subpath) → parent is Home root
      parent = linkMatch.relative ? path.dirname(resolved) : root
    } else {
      displayPath = resolved.slice(root.length) || path.basename(resolved)
      parent = path.dirname(resolved)
    }

    const base = {
      path: resolved,
      displayPath,
      name: path.basename(resolved),
      parent,
      isRoot: false,
      type: 'file' as const,
      ext,
      category,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      editable: isEditable(category),
      isLink: !!linkMatch,
    }

    if (canPreview) {
      const content = fs.readFileSync(resolved, 'utf-8')
      return NextResponse.json({ ...base, content, binary: false })
    }

    return NextResponse.json({
      ...base,
      content: null,
      binary: true,
      reason: !TEXT_EXTENSIONS.has(ext) ? 'Binary or unsupported format' : 'File too large to preview',
    })
  } catch (err: unknown) {
    const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (code === 'EACCES') return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    console.error('[GET /api/files]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PUT ────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  // Hosted/tenant users use artifact storage — direct filesystem edits are not allowed
  const tenantId = getTenantId(req)
  if (isTenantUser({ tenantId })) {
    return NextResponse.json({ error: 'File editing not supported in hosted mode' }, { status: 400 })
  }

  const result = getRoot_orError()
  if ('response' in result) return result.response
  const { root } = result

  let body: { path: string; content: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { path: filePath, content } = body

  if (!filePath || typeof content !== 'string') {
    return NextResponse.json({ error: 'path and content are required' }, { status: 400 })
  }

  const resolved = path.resolve(filePath)

  if (!isPathAllowed(resolved)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const ext = path.extname(resolved).toLowerCase()
  const category = getCategory(ext)

  if (!isEditable(category)) {
    return NextResponse.json({ error: 'File type is not editable' }, { status: 400 })
  }

  try {
    fs.writeFileSync(resolved, content, 'utf-8')
    const stat = fs.statSync(resolved)
    return NextResponse.json({ ok: true, modified: stat.mtime.toISOString() })
  } catch (err: unknown) {
    const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
    if (code === 'EACCES') return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    console.error('[PUT /api/files]', err)
    return NextResponse.json({ error: 'Write failed' }, { status: 500 })
  }
}

// ── DELETE ──────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  // Only supported in hosted/tenant mode (self-hosted uses OS-level file management)
  const tenantId = getTenantId(req)
  if (!isTenantUser({ tenantId })) {
    return NextResponse.json({ error: 'Delete not supported in self-hosted mode. Use your file manager.' }, { status: 400 })
  }

  const { deleteHostedFile } = await import('@/lib/hosted-storage')
  const db = getDb(tenantId)
  const { id } = await req.json() as { id?: string }

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const deleted = deleteHostedFile(db, id)
  if (!deleted) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, storage: getStorageUsage(db) })
}
