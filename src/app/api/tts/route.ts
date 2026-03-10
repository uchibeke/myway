/**
 * TTS API — Multi-provider with local voice persistence.
 *
 * GET  /api/tts?assetId=xxx  — list saved voices for an asset
 * GET  /api/tts?jobId=xxx    — poll job status (generating/done/failed)
 * POST /api/tts { text, assetId, provider? } — kick off async generation, returns 202 + jobId
 *
 * Generation runs in-process after the 202 response (fire-and-forget promise).
 * PM2 fork mode keeps the process alive so the promise always completes.
 */

import { NextRequest } from 'next/server'
import { join } from 'path'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { VOICES_DIR, getDataDir } from '@/lib/db/config'
import { stripMarkdown } from '@/lib/tts'
import { getProvider } from '@/lib/tts'
import type { VoiceEntry, TTSProviderId } from '@/lib/tts'
import { IntegrationNotConfiguredError } from '@/lib/integrations'
import { getTenantId } from '@/lib/tenant'

/** Resolve voices directory — tenant-scoped in platform mode, global otherwise. */
function getVoicesDir(tenantId?: string): string {
  if (!tenantId) return VOICES_DIR
  return join(getDataDir(tenantId), 'voices')
}

// ─── In-memory job tracker ──────────────────────────────────────────────────

type Job =
  | { status: 'generating' }
  | { status: 'done'; entry: VoiceEntry }
  | { status: 'failed'; error: string }

const jobs = new Map<string, Job>()

/** Evict old jobs so the Map doesn't grow forever. */
const JOB_TTL_MS = 10 * 60 * 1000 // 10 minutes
const jobTimestamps = new Map<string, number>()

function trackJob(jobId: string, job: Job) {
  jobs.set(jobId, job)
  jobTimestamps.set(jobId, Date.now())
  // Lazy cleanup: if map is big, sweep expired
  if (jobs.size > 50) {
    const now = Date.now()
    for (const [id, ts] of jobTimestamps) {
      if (now - ts > JOB_TTL_MS) {
        jobs.delete(id)
        jobTimestamps.delete(id)
      }
    }
  }
}

// ─── GET: list voices OR poll job status ─────────────────────────────────────

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId')
  const assetId = req.nextUrl.searchParams.get('assetId')
  const tenantId = getTenantId(req)

  // Poll job status
  if (jobId) {
    const job = jobs.get(jobId)
    if (!job) return Response.json({ status: 'unknown' })
    if (job.status === 'done') return Response.json({ status: 'done', entry: job.entry })
    if (job.status === 'failed') return Response.json({ status: 'failed', error: job.error })
    return Response.json({ status: 'generating' })
  }

  // List saved voices
  if (!assetId) {
    return Response.json({ error: 'assetId or jobId is required' }, { status: 400 })
  }

  try {
    const voicesDir = getVoicesDir(tenantId)
    const assetDir = join(voicesDir, assetId)
    mkdirSync(assetDir, { recursive: true })

    const files = readdirSync(assetDir).filter((f) => f.endsWith('.json'))
    const voices: VoiceEntry[] = files
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(assetDir, f), 'utf-8')) as VoiceEntry
        } catch {
          return null
        }
      })
      .filter((v): v is VoiceEntry => v !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return Response.json(voices)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list voices'
    return Response.json({ error: msg }, { status: 500 })
  }
}

// ─── POST: kick off async TTS generation ─────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { text?: string; assetId?: string; provider?: string; voiceId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { text, assetId, provider, voiceId } = body
  if (!text?.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 })
  }
  if (!assetId?.trim()) {
    return Response.json({ error: 'assetId is required' }, { status: 400 })
  }

  // Return 202 immediately, generate in background
  const jobId = randomUUID()
  trackJob(jobId, { status: 'generating' })

  const cleanText = stripMarkdown(text)

  const tenantId = getTenantId(req)

  // Fire-and-forget — runs after response is sent
  generateInBackground(jobId, assetId, cleanText, provider as TTSProviderId | undefined, voiceId, tenantId)

  return Response.json({ jobId }, { status: 202 })
}

// ─── Background generation ──────────────────────────────────────────────────

async function generateInBackground(
  jobId: string,
  assetId: string,
  cleanText: string,
  providerId?: TTSProviderId,
  voiceId?: string,
  tenantId?: string,
) {
  try {
    const provider = getProvider(providerId)
    console.log(`[TTS:${provider.id}] Job ${jobId}: ${cleanText.split(/\s+/).length} words`)

    const result = await provider.generate(cleanText, { voiceId })

    // Save audio + metadata
    const entryId = randomUUID()
    const voicesDir = getVoicesDir(tenantId)
    const assetDir = join(voicesDir, assetId)
    mkdirSync(assetDir, { recursive: true })

    const ext = result.format === 'mp3' ? 'mp3' : 'wav'
    writeFileSync(join(assetDir, `${entryId}.${ext}`), result.audioData)

    const entry: VoiceEntry = {
      id: entryId,
      assetId,
      textPreview: cleanText.slice(0, 100),
      durationSec: result.durationSec,
      createdAt: new Date().toISOString(),
      format: result.format,
      provider: provider.id,
    }
    writeFileSync(join(assetDir, `${entryId}.json`), JSON.stringify(entry, null, 2))

    console.log(`[TTS:${provider.id}] Job ${jobId} done: ${entry.durationSec}s`)
    trackJob(jobId, { status: 'done', entry })
  } catch (err) {
    const msg = err instanceof IntegrationNotConfiguredError
      ? `${err.message}. ${err.setupHint}`
      : err instanceof Error ? err.message : 'TTS request failed'
    console.error(`[TTS] Job ${jobId} failed:`, err)
    trackJob(jobId, { status: 'failed', error: msg })
  }
}
