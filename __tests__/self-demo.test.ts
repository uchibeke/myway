/**
 * Tests for E2 — Self-Demo Mode
 *
 * Covers:
 *   - Demo content module (single source of truth)
 *   - Demo TTS phrases in ONBOARDING_PHRASES whitelist
 *   - /api/demo/respond endpoint behavior
 *   - /api/demo/stream endpoint behavior
 *   - Middleware auth exemption for demo endpoints
 *   - PRD alignment (US-006 through US-009)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ─── Mock model-registry ────────────────────────────────────────────────────

vi.mock('@/lib/model-registry', () => ({
  resolveModelForApp: vi.fn(() => ({
    model: 'test-model',
    baseUrl: 'http://localhost:9999',
    token: 'test-token',
  })),
}))

vi.mock('@/lib/ai-config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-config')>('@/lib/ai-config')
  return {
    ...actual,
    isAIConfigured: vi.fn(() => true),
    getAIConfig: vi.fn(() => ({ mode: 'byok' })),
  }
})

// ─── Mock fetch ─────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'A helpful demo response.' } }],
    }),
    text: async () => 'A helpful demo response.',
  })) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

// ─── Mock fs for TTS route ──────────────────────────────────────────────────

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}))

// ─── Demo content module ────────────────────────────────────────────────────

describe('Demo content module', () => {
  it('exports all required TTS scripts', async () => {
    const dc = await import('@/lib/demo-content')
    expect(dc.DEMO_WELCOME_TTS).toBeTruthy()
    expect(dc.DEMO_BRIEF_TTS).toBeTruthy()
    expect(dc.DEMO_QA_TTS).toBeTruthy()
    expect(dc.DEMO_QA_USER_TTS).toBeTruthy()
    expect(dc.DEMO_YOUR_TURN_TTS).toBeTruthy()
  })

  it('DEMO_QA_USER_TTS matches DEMO_QA_USER_MESSAGE (DRY)', async () => {
    const dc = await import('@/lib/demo-content')
    expect(dc.DEMO_QA_USER_TTS).toBe(dc.DEMO_QA_USER_MESSAGE)
  })

  it('exports streamable content', async () => {
    const dc = await import('@/lib/demo-content')
    expect(dc.DEMO_BRIEF_MARKDOWN).toContain('investor deck')
    expect(dc.DEMO_QA_USER_MESSAGE).toBeTruthy()
    expect(dc.DEMO_QA_RESPONSE).toContain('hardest deadline')
  })

  it('getDemoContent returns correct content for valid IDs', async () => {
    const { getDemoContent, DEMO_BRIEF_MARKDOWN, DEMO_QA_RESPONSE } = await import('@/lib/demo-content')
    expect(getDemoContent('brief')).toBe(DEMO_BRIEF_MARKDOWN)
    expect(getDemoContent('qa')).toBe(DEMO_QA_RESPONSE)
  })

  it('getDemoContent returns null for invalid ID', async () => {
    const { getDemoContent } = await import('@/lib/demo-content')
    expect(getDemoContent('invalid')).toBeNull()
  })

  it('getDemoStreamDuration returns positive values', async () => {
    const { getDemoStreamDuration } = await import('@/lib/demo-content')
    expect(getDemoStreamDuration('brief')).toBeGreaterThan(0)
    expect(getDemoStreamDuration('qa')).toBeGreaterThan(0)
  })
})

// ─── Demo TTS phrases ──────────────────────────────────────────────────────

describe('Demo TTS phrases', () => {
  it('ONBOARDING_PHRASES includes all demo step keys', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/app/api/onboarding/tts/route.ts'),
      'utf-8',
    )
    expect(source).toContain('demo_welcome:')
    expect(source).toContain('demo_brief:')
    expect(source).toContain('demo_qa:')
    expect(source).toContain('demo_qa_user:')
    expect(source).toContain('demo_your_turn:')
  })

  it('TTS route imports from demo-content module (DRY)', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/app/api/onboarding/tts/route.ts'),
      'utf-8',
    )
    expect(source).toContain("from '@/lib/demo-content'")
    expect(source).toContain('DEMO_WELCOME_TTS')
    expect(source).toContain('DEMO_BRIEF_TTS')
    expect(source).toContain('DEMO_QA_TTS')
    expect(source).toContain('DEMO_QA_USER_TTS')
    expect(source).toContain('DEMO_YOUR_TURN_TTS')
  })

  it('demo_qa_user step uses Alex voice override', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/app/api/onboarding/tts/route.ts'),
      'utf-8',
    )
    expect(source).toContain("demo_qa_user: 'Alex'")
    expect(source).toContain('STEP_VOICE_OVERRIDES')
    // voiceId is passed to generateInBackground and then to provider.generate
    expect(source).toContain('voiceOverride')
  })

  it('demo_brief matches PRD US-008 Part A script', async () => {
    const { DEMO_BRIEF_TTS } = await import('@/lib/demo-content')
    expect(DEMO_BRIEF_TTS).toContain('Good morning, Alex')
    expect(DEMO_BRIEF_TTS).toContain('finish the investor deck')
    expect(DEMO_BRIEF_TTS).toContain('confirm the 2pm call')
    expect(DEMO_BRIEF_TTS).toContain('pick up your prescription')
    expect(DEMO_BRIEF_TTS).toContain('Fed held rates steady')
  })

  it('demo_qa matches PRD US-008 Part B script', async () => {
    const { DEMO_QA_TTS } = await import('@/lib/demo-content')
    expect(DEMO_QA_TTS).toContain('The investor deck')
    expect(DEMO_QA_TTS).toContain('hardest deadline')
    expect(DEMO_QA_TTS).toContain('phone on silent')
  })
})

// ─── /api/demo/respond ──────────────────────────────────────────────────────

describe('/api/demo/respond', () => {
  it('returns AI response for valid question', async () => {
    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What is Myway?' }),
    })

    const res = await POST(req as any)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toHaveProperty('text')
    expect(typeof data.text).toBe('string')
    expect(data.text.length).toBeGreaterThan(0)
  })

  it('returns 400 for missing question', async () => {
    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty question', async () => {
    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 for question exceeding max length', async () => {
    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'a'.repeat(501) }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it('returns fallback response when AI is not configured', async () => {
    const { isAIConfigured } = await import('@/lib/ai-config')
    vi.mocked(isAIConfigured).mockReturnValueOnce(false)

    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Hello' }),
    })

    const res = await POST(req as any)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.text).toContain('create your Myway')
  })

  it('returns fallback when AI call fails', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'Internal error',
    })) as any

    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Test' }),
    })

    const res = await POST(req as any)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.text).toContain('create your Myway')
  })

  it('handles invalid JSON body', async () => {
    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it('calls AI with demo system prompt', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'I can help you with that. Want me to set that up for you?' }, finish_reason: 'stop' }],
      }),
    }))
    globalThis.fetch = mockFetch as any

    const { POST } = await import('@/app/api/demo/respond/route')
    const req = new Request('http://localhost/api/demo/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'How can you help me?' }),
    })

    await POST(req as any)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Myway'),
      }),
    )

    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body as string)
    expect(callBody.messages[0].role).toBe('system')
    expect(callBody.messages[0].content).toContain('Myway')
    expect(callBody.messages[1].role).toBe('user')
    expect(callBody.messages[1].content).toBe('How can you help me?')
    expect(callBody.max_completion_tokens).toBeLessThanOrEqual(2048)
  })
})

// ─── Middleware auth exemption ──────────────────────────────────────────────

describe('Middleware: demo endpoints', () => {
  it('/api/demo/respond is in AUTH_EXEMPT_PATHS', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/middleware.ts'),
      'utf-8',
    )
    expect(source).toContain("'/api/demo/respond'")
  })

  it('/api/demo/stream is in AUTH_EXEMPT_PATHS', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/middleware.ts'),
      'utf-8',
    )
    expect(source).toContain("'/api/demo/stream'")
  })

  it('/api/demo/realtime/session is in AUTH_EXEMPT_PATHS', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/middleware.ts'),
      'utf-8',
    )
    expect(source).toContain("'/api/demo/realtime/session'")
  })

  it('public demo/onboarding endpoints are not rate-limited (prevent 429 during demo)', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/middleware.ts'),
      'utf-8',
    )
    expect(source).not.toContain("prefix: '/api/demo/respond'")
    expect(source).not.toContain("prefix: '/api/demo/stream'")
    expect(source).not.toContain("prefix: '/api/onboarding/tts'")
    expect(source).not.toContain("prefix: '/api/onboarding/step'")
  })
})

// ─── PRD alignment ──────────────────────────────────────────────────────────

describe('E2 PRD alignment', () => {
  it('US-006: SelfDemoImmersive component exists with all phases', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain('SelfDemoImmersive')
    expect(source).toContain('tap_to_start') // Mobile autoplay compliance
    expect(source).toContain('demo_brief')
    expect(source).toContain('demo_qa')
    expect(source).toContain('demo_qa_user')
    expect(source).toContain('demo_your_turn')
    // New phases
    expect(source).toContain('qa_user_speaking')
    expect(source).toContain('your_turn')
    expect(source).toContain('visitor_listening')
    expect(source).toContain('visitor_responding')
    expect(source).toContain('visitor_response_playing')
  })

  it('US-006: Demo has welcome greeting before brief', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain("'welcome'")
    expect(source).toContain('DEMO_WELCOME_TTS')
    expect(source).toContain('demo_welcome')
  })

  it('US-006: Demo renders actual apps via GenericApp with CSS switching', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    // Uses GenericApp — same entry point as real app routes
    expect(source).toContain('<GenericApp')
    expect(source).toContain("from '@/components/GenericApp'")
    // Should NOT bypass GenericApp with direct shell imports
    expect(source).not.toContain("from '@/components/FeedShell'")
    expect(source).not.toContain("from '@/components/AppShell'")
    // CSS switching for zero layout shift (both mounted, visibility toggled)
    expect(source).toContain('isBriefPhase')
    expect(source).toContain("isBriefPhase ? 'h-full' : 'hidden'")
    expect(source).toContain("!isBriefPhase ? 'h-full' : 'hidden'")
    // Demo props passed through GenericApp to underlying shell
    expect(source).toContain('demo')
    expect(source).toContain('demoMessages={getBriefMessages()}')
    expect(source).toContain('demoMessages={getChatMessages()}')
  })

  it('US-006: GenericApp passes demo props through to shells', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/GenericApp.tsx'),
      'utf-8',
    )
    // GenericApp accepts demo props
    expect(source).toContain('demo?: boolean')
    expect(source).toContain('demoMessages?')
    expect(source).toContain('demoStreaming?: boolean')
    // Passes them to AppShell
    expect(source).toContain('demo={demo}')
    expect(source).toContain('demoMessages={demoMessages}')
    expect(source).toContain('demoStreaming={demoStreaming}')
    // Passes them to FeedShell
    expect(source).toContain('demoContent={demoContent}')
  })

  it('US-006: Demo content is imported from shared module (DRY)', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain("from '@/lib/demo-content'")
    // Should NOT have hardcoded demo strings
    expect(source).not.toContain("Good morning, Alex")
  })

  it('US-006: Audio-synced text reveal (requestAnimationFrame)', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain('requestAnimationFrame')
    expect(source).toContain('audio.currentTime')
    expect(source).toContain('audio.duration')
    expect(source).toContain('startReveal')
    expect(source).toContain('stopReveal')
  })

  it('US-007: Interrupt support with mic button', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain('handleInterrupt')
    expect(source).toContain('Interrupt and ask your own question')
    expect(source).toContain('VoiceImmersive')
    expect(source).toContain('/api/demo/respond')
  })

  it('US-007: CTA overlay after demo', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain('That was Myway.')
    expect(source).toContain('Create your Myway — free')
    expect(source).toContain('onSignup')
  })

  it('US-008: Demo content matches PRD script exactly', () => {
    const { readFileSync: realReadFileSync } = require('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/lib/demo-content.ts'),
      'utf-8',
    )

    // Brief script
    expect(source).toContain("Good morning, Alex. Here's your brief.")
    expect(source).toContain('finish the investor deck')
    expect(source).toContain('confirm the 2pm call')
    expect(source).toContain('pick up your prescription')
    expect(source).toContain('Fed held rates steady')

    // Q&A script
    expect(source).toContain("The investor deck. It has the hardest deadline")
    expect(source).toContain('phone on silent')

    // User question
    expect(source).toContain('What should I focus on first today?')
  })

  it('US-006: page.tsx routes visitors to SelfDemoImmersive', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/app/page.tsx'),
      'utf-8',
    )
    expect(source).toContain('SelfDemoImmersive')
    expect(source).toContain('isVisitor')
    // Visitor path should be first in the conditional
    expect(source).toMatch(/isVisitor\s*\?\s*\(\s*<SelfDemoImmersive/)
  })

  it('FeedShell supports demo mode with audio-synced reveal', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/FeedShell.tsx'),
      'utf-8',
    )
    expect(source).toContain('demo?: boolean')
    expect(source).toContain('demoContent?: string')
    expect(source).toContain('demoStreaming?: boolean')
    expect(source).toContain('pointer-events-none')
  })

  it('AppShell supports demo mode with audio-synced reveal', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/AppShell.tsx'),
      'utf-8',
    )
    expect(source).toContain('demo?: boolean')
    expect(source).toContain('demoMessages?')
    expect(source).toContain('demoStreaming?: boolean')
    expect(source).toContain('pointer-events-none')
  })

  it('US-009: Alex voice for simulated user question', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain('DEMO_QA_USER_TTS')
    expect(source).toContain("'demo_qa_user'")
    // qa_user_speaking phase replaces old qa_intro
    expect(source).toContain('qa_user_speaking')
    expect(source).not.toContain('qa_intro')
  })

  it('US-009: Interactive "your turn" step with visitor mic', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    expect(source).toContain('DEMO_YOUR_TURN_TTS')
    expect(source).toContain("'demo_your_turn'")
    expect(source).toContain('handleVisitorResult')
    expect(source).toContain('visitor_listening')
    // Opens mic after "your turn" TTS
    expect(source).toContain('setSttOpen(true)')
  })

  it('US-006: Auto-start on desktop (no delay)', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    // Should use setTimeout with 0ms, not 600ms
    expect(source).toContain('setTimeout')
    expect(source).not.toContain(', 600)')
  })

  it('FeedShell auto-scrolls in demo mode', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/FeedShell.tsx'),
      'utf-8',
    )
    // Should have a useEffect that scrolls based on content in demo mode
    expect(source).toContain('scrollRef.current.scrollTop = scrollRef.current.scrollHeight')
    // The scroll should appear at least twice: once for normal streaming, once for demo
    const scrollMatches = source.match(/scrollRef\.current\.scrollTop = scrollRef\.current\.scrollHeight/g)
    expect(scrollMatches?.length).toBeGreaterThanOrEqual(2)
  })

  it('App renders full screen — no preview scaling or borders', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    // App layer fills the full area (absolute inset-0), no shrunken preview
    expect(source).toContain('absolute inset-0 overflow-hidden')
    expect(source).not.toContain('scale-[0.92]')
    expect(source).not.toContain('h-[85%]')
    expect(source).not.toContain('origin-top')
  })

  it('Inworld WebRTC realtime: visitor_realtime phase with fallback', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/components/SelfDemoImmersive.tsx'),
      'utf-8',
    )
    // New phase for WebRTC realtime
    expect(source).toContain("'visitor_realtime'")
    // Uses the realtime hook
    expect(source).toContain('useInworldRealtime')
    expect(source).toContain('inworld.connect()')
    expect(source).toContain('inworld.disconnect()')
    // Pre-checks availability on mount
    expect(source).toContain('realtimeAvailable')
    expect(source).toContain('/api/demo/realtime/session')
    // Falls back to existing flow when WebRTC unavailable
    expect(source).toContain('visitor_listening')
    expect(source).toContain('setSttOpen(true)')
    // Shows realtime text in chat
    expect(source).toContain('realtimeText')
  })

  it('Inworld WebRTC hook exists with correct interface', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/hooks/useInworldRealtime.ts'),
      'utf-8',
    )
    // Exports the hook
    expect(source).toContain('export function useInworldRealtime')
    // WebRTC connection
    expect(source).toContain('RTCPeerConnection')
    expect(source).toContain('RTCDataChannel')
    expect(source).toContain('getUserMedia')
    // Inworld protocol
    expect(source).toContain('session.update')
    expect(source).toContain('response.output_text.delta')
    expect(source).toContain('response.done')
    // SDP exchange with Inworld
    expect(source).toContain('api.inworld.ai/v1/realtime/calls')
    // Cleanup
    expect(source).toContain('disconnect')
  })

  it('Inworld realtime session route exists with instructions', async () => {
    const { readFileSync: realReadFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = realReadFileSync(
      require('path').join(__dirname, '../src/app/api/demo/realtime/session/route.ts'),
      'utf-8',
    )
    // Fetches ICE servers
    expect(source).toContain('api.inworld.ai/v1/realtime/ice-servers')
    // Builds instructions with timezone
    expect(source).toContain('buildInstructions')
    expect(source).toContain('browserTimezone')
    // Returns config for client
    expect(source).toContain('apiKey')
    expect(source).toContain('iceServers')
    expect(source).toContain('instructions')
    expect(source).toContain('voice')
    // 503 when not configured
    expect(source).toContain('503')
  })
})
