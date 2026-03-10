/**
 * GET /api/files/download?path=<serverPath>&zip=<0|1>
 *
 * Download a single file or a directory as a ZIP archive.
 *
 * Query params:
 *   path  — absolute server path (must be within MYWAY_ROOT)
 *   zip   — "1" to force ZIP even for single files; auto-true for directories
 *
 * Security:
 *   - Path checked against isPathAllowed() (no path traversal)
 *   - Directories always zipped using jszip
 *   - Directories over 100 MB return an error with a split-download suggestion
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import type JSZipType from 'jszip'
import { getRoot, isPathAllowed } from '@/lib/fs-config'
import { isTenantUser, getHostedFile } from '@/lib/hosted-storage'
import { getArtifact } from '@/lib/store/artifacts'
import { ARTIFACTS_DIR } from '@/lib/db/config'
import { getDataDir } from '@/lib/db/config'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

const MAX_DIR_BYTES = 100 * 1024 * 1024  // 100 MB ZIP limit

/** Recursively compute directory size. */
function dirSize(dirPath: string): number {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) total += dirSize(full)
      else if (entry.isFile()) total += fs.statSync(full).size
    }
  } catch { /* ignore permission errors */ }
  return total
}

/** Recursively add all files in dirPath to the zip instance. */
function addDirToZip(zip: JSZipType, dirPath: string, prefix: string) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) addDirToZip(zip, full, rel)
    else if (entry.isFile()) zip.file(rel, fs.readFileSync(full))
  }
}

export async function GET(req: NextRequest) {
  // ── Hosted/tenant mode: serve from artifact store ──────────────────────────
  const tenantId = getTenantId(req)
  if (isTenantUser({ tenantId })) {
    const db = getDb(tenantId)
    const fileId = req.nextUrl.searchParams.get('path')
    if (!fileId) return NextResponse.json({ error: 'path (file ID) is required' }, { status: 400 })

    const artifact = getArtifact(db, fileId)
    if (!artifact || artifact.appId !== 'files') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const artifactsDir = path.join(getDataDir(tenantId), 'artifacts')
    const absPath = path.resolve(path.join(artifactsDir, artifact.filePath))

    // Defense-in-depth: ensure resolved path stays within artifacts dir
    if (!absPath.startsWith(artifactsDir)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    try {
      const content = fs.readFileSync(absPath)
      const uint8 = new Uint8Array(content)
      const name = artifact.originalName
      return new NextResponse(uint8, {
        headers: {
          'Content-Type': artifact.mimeType ?? 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Content-Length': String(uint8.length),
        },
      })
    } catch {
      return NextResponse.json({ error: 'File data not found on disk' }, { status: 500 })
    }
  }

  // ── Self-hosted mode ───────────────────────────────────────────────────────
  const rootResult = (() => {
    try { return { root: getRoot() } } catch {
      return { error: NextResponse.json({ error: 'File system not configured' }, { status: 503 }) }
    }
  })()
  if ('error' in rootResult) return rootResult.error
  const { root } = rootResult

  const rawPath = req.nextUrl.searchParams.get('path') ?? root
  const forceZip = req.nextUrl.searchParams.get('zip') === '1'
  const resolved = path.resolve(rawPath)

  if (!isPathAllowed(resolved)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const name = path.basename(resolved)

  // ── Directory → ZIP ────────────────────────────────────────────────────────
  if (stat.isDirectory() || forceZip) {
    if (stat.isDirectory()) {
      const size = dirSize(resolved)
      if (size > MAX_DIR_BYTES) {
        return NextResponse.json({
          error: `Directory too large to zip (${(size / 1024 / 1024).toFixed(0)} MB > 100 MB limit). Download subfolders individually.`,
        }, { status: 413 })
      }
    }

    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      if (stat.isDirectory()) {
        addDirToZip(zip, resolved, name)
      } else {
        zip.file(name, fs.readFileSync(resolved))
      }
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      const uint8 = new Uint8Array(buf)
      return new NextResponse(uint8, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.zip"; filename*=UTF-8''${encodeURIComponent(name)}.zip`,
          'Content-Length': String(uint8.length),
        },
      })
    } catch (e: unknown) {
      const msg = (e as Error).message ?? ''
      if (msg.includes('Cannot find module')) {
        return NextResponse.json({
          error: 'ZIP downloads require the "jszip" package. Install it: npm install jszip',
        }, { status: 501 })
      }
      console.error('[download] zip error:', e)
      return NextResponse.json({ error: 'Failed to create ZIP archive' }, { status: 500 })
    }
  }

  // ── Single file ────────────────────────────────────────────────────────────
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Path is not a file or directory' }, { status: 400 })
  }

  try {
    const content = fs.readFileSync(resolved)
    const ext = path.extname(name).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
    }
    const mime = mimeMap[ext] ?? 'application/octet-stream'
    const uint8 = new Uint8Array(content)

    return new NextResponse(uint8, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Length': String(uint8.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}
