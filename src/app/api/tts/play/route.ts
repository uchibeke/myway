/**
 * GET /api/tts/play?assetId=xxx&voiceId=yyy — serve a saved audio file
 *
 * Reads the .json metadata to determine format (wav/mp3).
 * Falls back to .wav for old files without metadata format field.
 */

import { NextRequest } from 'next/server'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { VOICES_DIR, getDataDir } from '@/lib/db/config'
import type { VoiceEntry } from '@/lib/tts'
import { getTenantId } from '@/lib/tenant'

function getVoicesDir(tenantId?: string): string {
  if (!tenantId) return VOICES_DIR
  return join(getDataDir(tenantId), 'voices')
}

const CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
}

export async function GET(req: NextRequest) {
  const assetId = req.nextUrl.searchParams.get('assetId')
  const voiceId = req.nextUrl.searchParams.get('voiceId')

  if (!assetId || !voiceId) {
    return Response.json({ error: 'assetId and voiceId are required' }, { status: 400 })
  }

  // Sanitize: strict alphanumeric + hyphen/underscore only to prevent path traversal
  const safeIdPattern = /^[a-zA-Z0-9_-]{1,128}$/
  if (!safeIdPattern.test(assetId) || !safeIdPattern.test(voiceId)) {
    return Response.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const tenantId = getTenantId(req)
  const voicesDir = getVoicesDir(tenantId)
  const assetDir = join(voicesDir, assetId)

  // Read metadata to determine format
  const ALLOWED_FORMATS = ['wav', 'mp3']
  let format = 'wav' // default for backward compat
  const metaPath = join(assetDir, `${voiceId}.json`)
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as VoiceEntry
      if (meta.format && ALLOWED_FORMATS.includes(meta.format)) format = meta.format
    } catch {
      // fall back to wav
    }
  }

  const audioPath = join(assetDir, `${voiceId}.${format}`)

  // Fall back to .wav if the format-specific file doesn't exist (old files)
  const fallbackPath = join(assetDir, `${voiceId}.wav`)
  const finalPath = existsSync(audioPath) ? audioPath : fallbackPath

  if (!existsSync(finalPath)) {
    return Response.json({ error: 'Voice not found' }, { status: 404 })
  }

  try {
    const audioData = readFileSync(finalPath)
    const contentType = CONTENT_TYPES[format] ?? 'audio/wav'
    return new Response(audioData, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(audioData.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return Response.json({ error: 'Failed to read audio file' }, { status: 500 })
  }
}
