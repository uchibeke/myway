/**
 * Onboarding TTS — auth-exempt, mirrors /api/tts for use during onboarding.
 *
 * GET  ?step=greeting       — list cached voices for a fixed phrase
 * GET  ?assetId=xxx         — list cached voices by asset ID (dynamic phrases)
 * GET  ?jobId=xxx           — poll job status
 * POST { step: "greeting" } — generate a fixed phrase, returns 202 + jobId
 * POST { text, assetId }    — generate dynamic text, returns 202 + jobId
 *
 * Security:
 *   - Rate-limited to 10 req/min per IP in middleware
 *   - Text capped at 300 chars (onboarding phrases are short)
 *   - Audio cached in shared _onboarding/ dir (not tenant-scoped)
 */

import { NextRequest } from 'next/server'
import { join } from 'path'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { VOICES_DIR } from '@/lib/db/config'
import { stableAssetId, stripMarkdown } from '@/lib/tts'
import { getProvider } from '@/lib/tts'
import type { VoiceEntry } from '@/lib/tts'
import { IntegrationNotConfiguredError } from '@/lib/integrations'
import { DEMO_WELCOME_TTS, DEMO_BRIEF_TTS, DEMO_QA_TTS, DEMO_QA_USER_TTS, DEMO_YOUR_TURN_TTS } from '@/lib/demo-content'

// ── Fixed onboarding phrases (whitelist) ─────────────────────────────────────

const ONBOARDING_PHRASES: Record<string, string> = {
  greeting:
    "Hey, I'm Myway. I'm going to be your personal AI — but first, what's your name?",
  name_retry:
    "Sorry, I didn't catch that — could you say your name again?",
  step2:
    "What's one thing on your mind today?",
  // Self-demo mode (E2) — pre-cached for visitors
  demo_welcome: DEMO_WELCOME_TTS,
  demo_brief: DEMO_BRIEF_TTS,
  demo_qa: DEMO_QA_TTS,
  demo_qa_user: DEMO_QA_USER_TTS,
  demo_your_turn: DEMO_YOUR_TURN_TTS,
}

/** Voice overrides per step (default voice is "Clive"). */
const STEP_VOICE_OVERRIDES: Record<string, string> = {
  demo_qa_user: 'Alex',
}

/** Max text length for TTS generation. */
const MAX_TEXT_LENGTH = 2000

/** Shared directory for onboarding audio — not tenant-scoped. */
const ONBOARDING_VOICES_DIR = join(VOICES_DIR, '_onboarding')

// ── In-memory job tracker (same pattern as /api/tts) ─────────────────────────

type Job =
  | { status: 'generating' }
  | { status: 'done'; entry: VoiceEntry }
  | { status: 'failed'; error: string }

const jobs = new Map<string, Job>()
const jobTimestamps = new Map<string, number>()
const JOB_TTL_MS = 10 * 60 * 1000

function trackJob(jobId: string, job: Job) {
  jobs.set(jobId, job)
  jobTimestamps.set(jobId, Date.now())
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

/** List cached voices for an asset in the onboarding directory. */
function listCachedVoices(assetId: string): VoiceEntry[] {
  const safeIdPattern = /^[a-zA-Z0-9_-]{1,128}$/
  if (!safeIdPattern.test(assetId)) return []

  const assetDir = join(ONBOARDING_VOICES_DIR, assetId)
  mkdirSync(assetDir, { recursive: true })

  const files = readdirSync(assetDir).filter(f => f.endsWith('.json'))
  return files
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(assetDir, f), 'utf-8')) as VoiceEntry
      } catch { return null }
    })
    .filter((v): v is VoiceEntry => v !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// ── GET: cache check OR poll job status ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId')
  const step = req.nextUrl.searchParams.get('step')
  const assetIdParam = req.nextUrl.searchParams.get('assetId')

  // Poll job status
  if (jobId) {
    const job = jobs.get(jobId)
    if (!job) return Response.json({ status: 'unknown' })
    if (job.status === 'done') return Response.json({ status: 'done', entry: job.entry })
    if (job.status === 'failed') return Response.json({ status: 'failed', error: job.error })
    return Response.json({ status: 'generating' })
  }

  // List cached voices by assetId (dynamic phrases)
  if (assetIdParam) {
    try {
      const voices = listCachedVoices(assetIdParam)
      return Response.json(voices)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list voices'
      return Response.json({ error: msg }, { status: 500 })
    }
  }

  // List cached voices for a fixed step
  if (step) {
    if (!(step in ONBOARDING_PHRASES)) {
      return Response.json(
        { error: 'Invalid step. Allowed: ' + Object.keys(ONBOARDING_PHRASES).join(', ') },
        { status: 400 },
      )
    }
    const text = ONBOARDING_PHRASES[step]
    const assetId = stableAssetId(text)
    try {
      const voices = listCachedVoices(assetId)
      return Response.json(voices)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list voices'
      return Response.json({ error: msg }, { status: 500 })
    }
  }

  return Response.json({ error: 'step, assetId, or jobId is required' }, { status: 400 })
}

// ── POST: kick off async generation ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { step?: string; text?: string; assetId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let text: string
  let assetId: string

  if (body.step && body.step in ONBOARDING_PHRASES) {
    // Fixed phrase by step key
    text = ONBOARDING_PHRASES[body.step]
    assetId = stableAssetId(text)
  } else if (body.text?.trim() && body.assetId?.trim()) {
    // Dynamic phrase with explicit text + assetId
    text = body.text.trim()
    if (text.length > MAX_TEXT_LENGTH) {
      return Response.json({ error: `Text too long (max ${MAX_TEXT_LENGTH} chars)` }, { status: 400 })
    }
    assetId = body.assetId.trim()
    const safeIdPattern = /^[a-zA-Z0-9_-]{1,128}$/
    if (!safeIdPattern.test(assetId)) {
      return Response.json({ error: 'Invalid assetId' }, { status: 400 })
    }
  } else {
    return Response.json({ error: 'Provide { step } or { text, assetId }' }, { status: 400 })
  }

  // Check if audio already exists — return immediately (idempotent)
  const existing = listCachedVoices(assetId)
  if (existing.length > 0) {
    const syntheticJobId = `cached-${assetId}`
    trackJob(syntheticJobId, { status: 'done', entry: existing[0] })
    return Response.json({ jobId: syntheticJobId, assetId }, { status: 202 })
  }

  const cleanText = stripMarkdown(text)

  const jobId = randomUUID()
  trackJob(jobId, { status: 'generating' })

  // Fire-and-forget — runs after response is sent
  const voiceOverride = body.step ? STEP_VOICE_OVERRIDES[body.step] : undefined
  generateInBackground(jobId, assetId, cleanText, voiceOverride)

  return Response.json({ jobId, assetId }, { status: 202 })
}

// ── Background generation ────────────────────────────────────────────────────

async function generateInBackground(jobId: string, assetId: string, cleanText: string, voiceId?: string) {
  try {
    const provider = getProvider()
    console.log(`[onboarding-tts:${provider.id}] Job ${jobId}: ${cleanText.split(/\s+/).length} words${voiceId ? ` (voice: ${voiceId})` : ''}`)

    const result = await provider.generate(cleanText, voiceId ? { voiceId } : undefined)

    const entryId = randomUUID()
    const assetDir = join(ONBOARDING_VOICES_DIR, assetId)
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

    console.log(`[onboarding-tts:${provider.id}] Job ${jobId} done: ${entry.durationSec}s`)
    trackJob(jobId, { status: 'done', entry })
  } catch (err) {
    const msg = err instanceof IntegrationNotConfiguredError
      ? `${err.message}. ${err.setupHint}`
      : err instanceof Error ? err.message : 'TTS generation failed'
    console.error(`[onboarding-tts] Job ${jobId} failed:`, err)
    trackJob(jobId, { status: 'failed', error: msg })
  }
}
