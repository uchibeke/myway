/**
 * POST /api/files/upload
 *
 * Multipart upload to the server filesystem.
 * Supports single files and folder uploads (via webkitdirectory — files have relative paths).
 *
 * Body (multipart/form-data):
 *   files[]         — one or more File objects
 *   targetPath      — absolute server path to upload into (must be within MYWAY_ROOT)
 *   relativePaths[] — optional: one per file, mirrors browser webkitdirectory path
 *                     e.g. "recipes/italian/pasta.md"
 *                     If provided, subdirectories are created automatically.
 *
 * Security:
 *   - All resolved paths checked against isPathAllowed() (no path traversal)
 *   - Filenames sanitized (strip .., null bytes, leading slashes)
 *   - Max 50MB per file, 500MB per request
 *
 * Response:
 *   { ok: true, saved: [{ name, path, size }], errors: [...] }
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getRoot, isPathAllowed } from '@/lib/fs-config'
import { isTenantUser, checkQuota, uploadHostedFile, getStorageUsage } from '@/lib/hosted-storage'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

const MAX_FILE_BYTES = 50 * 1024 * 1024    // 50 MB per file
const MAX_TOTAL_BYTES = 500 * 1024 * 1024  // 500 MB per request

/** Strip dangerous path components from a filename or relative path segment. */
function sanitizeName(name: string): string {
  return name
    .replace(/\0/g, '')           // null bytes
    .replace(/^\/+/, '')          // leading slashes
    .split('/')
    .map(seg => seg.replace(/\.\./g, '__').trim()) // .. → __
    .filter(Boolean)
    .join('/')
}

export async function POST(req: NextRequest) {
  // ── Hosted/tenant mode: upload to artifact store with quota enforcement ──
  const tenantId = getTenantId(req)
  if (isTenantUser({ tenantId })) {
    const db = getDb(tenantId)

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
    }

    const files = formData.getAll('files[]') as File[]
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const saved: { name: string; id: string; size: number }[] = []
    const errors: { name: string; error: string }[] = []

    for (const file of files) {
      const check = checkQuota(db, file.size, file.name)
      if (!check.allowed) {
        errors.push({ name: file.name, error: check.reason })
        continue
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer())
        const result = uploadHostedFile(db, file.name, buffer, file.type || undefined)
        saved.push({ name: file.name, id: result.id, size: file.size })
      } catch {
        errors.push({ name: file.name, error: 'Failed to save file' })
      }
    }

    return NextResponse.json({
      ok: true,
      saved: saved.map(s => ({ name: s.name, path: s.id, size: s.size })),
      errors,
      storage: getStorageUsage(db),
    })
  }

  // ── Self-hosted mode: direct filesystem ──────────────────────────────────
  const rootResult = (() => {
    try { return { root: getRoot() } } catch {
      return { error: NextResponse.json({ error: 'File system not configured' }, { status: 503 }) }
    }
  })()
  if ('error' in rootResult) return rootResult.error
  const { root } = rootResult

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const targetPathRaw = (formData.get('targetPath') as string | null) ?? root
  const targetPath = path.resolve(targetPathRaw)

  if (!isPathAllowed(targetPath)) {
    return NextResponse.json({ error: 'Access denied: target path is outside allowed root' }, { status: 403 })
  }

  // Ensure target is a directory (or create it)
  try {
    const stat = fs.statSync(targetPath)
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'targetPath must be a directory' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Target directory does not exist' }, { status: 404 })
  }

  const files = formData.getAll('files[]') as File[]
  const relativePaths = formData.getAll('relativePaths[]') as string[]

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  let totalBytes = 0
  const saved: { name: string; path: string; size: number }[] = []
  const errors: { name: string; error: string }[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const relativePath = relativePaths[i] ? sanitizeName(relativePaths[i]) : sanitizeName(file.name)

    if (!relativePath) {
      errors.push({ name: file.name, error: 'Invalid filename' })
      continue
    }

    if (file.size > MAX_FILE_BYTES) {
      errors.push({ name: file.name, error: `File exceeds 50 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)` })
      continue
    }

    totalBytes += file.size
    if (totalBytes > MAX_TOTAL_BYTES) {
      errors.push({ name: file.name, error: 'Total upload size exceeds 500 MB limit' })
      break
    }

    const destPath = path.resolve(path.join(targetPath, relativePath))

    // Security: verify resolved path is still within root
    if (!isPathAllowed(destPath)) {
      errors.push({ name: file.name, error: 'Path traversal attempt blocked' })
      continue
    }

    try {
      // Create subdirectories if needed (for folder uploads)
      const dir = path.dirname(destPath)
      fs.mkdirSync(dir, { recursive: true })

      // Write file
      const buffer = Buffer.from(await file.arrayBuffer())
      fs.writeFileSync(destPath, buffer)

      saved.push({ name: file.name, path: destPath, size: file.size })
    } catch (e: unknown) {
      errors.push({ name: file.name, error: 'Failed to save file' })
    }
  }

  return NextResponse.json({ ok: true, saved, errors })
}
