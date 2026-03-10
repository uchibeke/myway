/**
 * Demo SSE streaming endpoint — streams pre-set demo content.
 *
 * GET ?contentId=brief|qa
 *
 * Produces SSE in the same format as /api/openclaw/chat so streamDeltas()
 * can parse it: data: {"choices":[{"delta":{"content":"..."}}]}\n\n
 *
 * Security:
 *   - Auth-exempt (visitors only)
 *   - Rate-limited to 10 req/min per IP in middleware
 *   - Read-only: no LLM calls, just pre-set content
 */

import { NextRequest } from 'next/server'
import { getDemoContent, getDemoStreamDuration, type DemoContentId } from '@/lib/demo-content'

export async function GET(req: NextRequest) {
  const contentId = req.nextUrl.searchParams.get('contentId')
  if (!contentId) {
    return Response.json({ error: 'contentId is required' }, { status: 400 })
  }

  const content = getDemoContent(contentId)
  if (content === null) {
    return Response.json({ error: 'Invalid contentId' }, { status: 400 })
  }

  const duration = getDemoStreamDuration(contentId as DemoContentId)
  const chunks = splitIntoChunks(content, 4)
  const delayMs = Math.max(10, Math.floor(duration / chunks.length))

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        const payload = JSON.stringify({
          choices: [{ delta: { content: chunk } }],
        })
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        await sleep(delayMs)
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

/** Split text into chunks of approximately `size` characters. */
function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, Math.min(i + size, text.length)))
    i += size
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
