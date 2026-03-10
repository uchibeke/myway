/**
 * POST /api/demo/respond — live LLM call for visitor demo.
 *
 * Auth-exempt, rate-limited at 5 req/min per IP.
 * Accepts { question: string }, returns { text: string }.
 *
 * Includes a completeness check: if the model returns a truncated response
 * (ends mid-sentence), falls back to a canned response rather than
 * speaking gibberish.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isAIConfigured, chatCompletionsUrl } from '@/lib/ai-config'
import { resolveModelForApp } from '@/lib/model-registry'

const DEMO_SYSTEM_PROMPT = `You are Myway, a warm personal AI assistant. A visitor is trying a demo of you. They don't have a profile yet. Answer their question helpfully, warmly, and in 2-3 complete sentences. Be direct and show personality. Always finish your sentences. End with a natural handoff like "Want me to set that up for you?" or "I can help with that once you're set up."`

const FALLBACK_RESPONSE =
  "Great question. I'd love to dig into that with you — once we're set up, I'll have your full context to give you a proper answer. Ready to create your Myway?"

const MAX_QUESTION_LENGTH = 500

/** Check if a response looks like a complete thought (ends with sentence-ending punctuation). */
function isComplete(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 10) return false
  return /[.!?…"']$/.test(trimmed)
}

export async function POST(req: NextRequest) {
  let body: { question?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const question = body.question?.trim()
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: `Question too long (max ${MAX_QUESTION_LENGTH} chars)` }, { status: 400 })
  }

  if (!isAIConfigured()) {
    return NextResponse.json({ text: FALLBACK_RESPONSE })
  }

  try {
    const resolved = resolveModelForApp(undefined, undefined, 'fast')
    console.log(`[demo/respond] Using model: ${resolved.model}`)

    const res = await fetch(chatCompletionsUrl(resolved.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.token}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        max_completion_tokens: 2048,
        temperature: 0.7,
        messages: [
          { role: 'system', content: DEMO_SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      console.warn(`[demo/respond] AI call failed: ${res.status}`)
      return NextResponse.json({ text: FALLBACK_RESPONSE })
    }

    const data = await res.json() as {
      choices?: Array<{
        message?: { content?: string }
        finish_reason?: string
      }>
    }

    const choice = data.choices?.[0]
    const text = choice?.message?.content?.trim()

    if (!text) {
      console.warn('[demo/respond] Empty response from model')
      return NextResponse.json({ text: FALLBACK_RESPONSE })
    }

    // If the model hit the token limit or the response ends mid-sentence, use fallback
    if (choice?.finish_reason === 'length' || !isComplete(text)) {
      console.warn(`[demo/respond] Incomplete response (finish_reason=${choice?.finish_reason}): "${text.slice(0, 80)}..."`)
      return NextResponse.json({ text: FALLBACK_RESPONSE })
    }

    return NextResponse.json({ text })
  } catch (err) {
    console.warn('[demo/respond] Error:', err)
    return NextResponse.json({ text: FALLBACK_RESPONSE })
  }
}
