/**
 * Streams binary files (images, video, audio) directly to the browser.
 * Security: same path-within-root check as the main files API.
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getRoot, isPathAllowed } from '@/lib/fs-config'
import { isTenantUser } from '@/lib/hosted-storage'
import { getArtifact } from '@/lib/store/artifacts'
import { getDataDir } from '@/lib/db/config'
import { getDb } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
}

export async function GET(req: NextRequest) {
  // ── Hosted/tenant mode: serve from artifact store ──────────────────────────
  const tenantId = getTenantId(req)
  if (isTenantUser({ tenantId })) {
    const db = getDb(tenantId)
    const fileId = req.nextUrl.searchParams.get('path')
    if (!fileId) return new NextResponse('path (file ID) is required', { status: 400 })

    const artifact = getArtifact(db, fileId)
    if (!artifact || artifact.appId !== 'files') {
      return new NextResponse('Not found', { status: 404 })
    }
    const artifactsDir = path.join(getDataDir(tenantId), 'artifacts')
    const absPath = path.resolve(path.join(artifactsDir, artifact.filePath))

    // Defense-in-depth: ensure resolved path stays within artifacts dir
    if (!absPath.startsWith(artifactsDir)) {
      return new NextResponse('Access denied', { status: 403 })
    }

    try {
      const stat = fs.statSync(absPath)
      const contentType = artifact.mimeType ?? MIME_MAP[path.extname(artifact.originalName).toLowerCase()] ?? 'application/octet-stream'

      const rangeHeader = req.headers.get('range')
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
        const chunkSize = end - start + 1
        const stream = fs.createReadStream(absPath, { start, end })
        const webStream = new ReadableStream({
          start(controller) {
            stream.on('data', (chunk) => controller.enqueue(chunk))
            stream.on('end', () => controller.close())
            stream.on('error', (err) => controller.error(err))
          },
        })
        return new NextResponse(webStream, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
          },
        })
      }

      const stream = fs.createReadStream(absPath)
      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => controller.enqueue(chunk))
          stream.on('end', () => controller.close())
          stream.on('error', (err) => controller.error(err))
        },
      })
      return new NextResponse(webStream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',
        },
      })
    } catch {
      return new NextResponse('File data not found', { status: 500 })
    }
  }

  // ── Self-hosted mode ───────────────────────────────────────────────────────
  let root: string
  try { root = getRoot() } catch (e: any) {
    return new NextResponse('Server misconfiguration', { status: 503 })
  }

  const rawPath = req.nextUrl.searchParams.get('path')
  if (!rawPath) return new NextResponse('path is required', { status: 400 })

  const resolved = path.resolve(rawPath)

  if (!isPathAllowed(resolved)) {
    return new NextResponse('Access denied', { status: 403 })
  }

  try {
    const stat = fs.statSync(resolved)
    if (!stat.isFile()) return new NextResponse('Not a file', { status: 400 })

    const ext = path.extname(resolved).toLowerCase()
    const contentType = MIME_MAP[ext] ?? 'application/octet-stream'
    const fileSize = stat.size

    // Support Range requests so video/audio seeking works
    const rangeHeader = req.headers.get('range')

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = end - start + 1

      const stream = fs.createReadStream(resolved, { start, end })
      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => controller.enqueue(chunk))
          stream.on('end', () => controller.close())
          stream.on('error', (err) => controller.error(err))
        },
      })

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
        },
      })
    }

    // Full file
    const stream = fs.createReadStream(resolved)
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk))
        stream.on('end', () => controller.close())
        stream.on('error', (err) => controller.error(err))
      },
    })

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') return new NextResponse('Not found', { status: 404 })
    if (err.code === 'EACCES') return new NextResponse('Permission denied', { status: 403 })
    console.error('[GET /api/files/raw]', err)
    return new NextResponse('Server error', { status: 500 })
  }
}
