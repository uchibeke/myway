/**
 * Demo content — single source of truth for all E2 self-demo content.
 *
 * Used by:
 *   - /api/onboarding/tts    (TTS scripts for pre-caching)
 *   - /api/demo/stream        (SSE streaming to demo shells)
 *   - SelfDemoImmersive       (phase machine references)
 */

// ── TTS scripts ─────────────────────────────────────────────────────────────

export const DEMO_WELCOME_TTS =
  "Hey, I'm Myway. Let me show you what your mornings could look like."

export const DEMO_BRIEF_TTS =
  "Good morning, Alex. Here's your brief. You have three things on your plate today: finish the investor deck, confirm the 2pm call with your team, and pick up your prescription before 6pm. The weather in Toronto is 4 degrees with clear skies this afternoon — good window for a walk. One thing worth knowing: the Fed held rates steady yesterday, which matters for the real estate position you flagged last week. That's your morning. What do you want to tackle first?"

export const DEMO_QA_TTS =
  "The investor deck. It has the hardest deadline and the highest stakes — everything else can flex around it. I'd block the next 90 minutes with your phone on silent. Want me to set that?"

// ── Streamable content ──────────────────────────────────────────────────────

/** Markdown content streamed to FeedShell during brief demo. */
export const DEMO_BRIEF_MARKDOWN = `**3 things on your plate today:**
1. Finish the investor deck
2. Confirm the 2pm call with your team
3. Pick up your prescription before 6pm

**Weather:** Toronto — 4°C, clear skies this afternoon. Good window for a walk.

**Worth knowing:** The Fed held rates steady yesterday — relevant to the real estate position you flagged last week.

That's your morning. What do you want to tackle first?`

/** User question shown in AppShell during Q&A demo. */
export const DEMO_QA_USER_MESSAGE = 'What should I focus on first today?'

/** Spoken version of Alex's question (TTS with Alex voice). */
export const DEMO_QA_USER_TTS = DEMO_QA_USER_MESSAGE

/** Myway's invitation for the visitor to try speaking. */
export const DEMO_YOUR_TURN_TTS =
  "Now it's your turn. Tap the mic and ask me anything."

/** Assistant response streamed to AppShell during Q&A demo. */
export const DEMO_QA_RESPONSE =
  "The investor deck. It has the hardest deadline and the highest stakes — everything else can flex around it. I'd block the next 90 minutes with your phone on silent. Want me to set that?"

// ── Content registry ────────────────────────────────────────────────────────

export type DemoContentId = 'brief' | 'qa'

const CONTENT_MAP: Record<DemoContentId, string> = {
  brief: DEMO_BRIEF_MARKDOWN,
  qa: DEMO_QA_RESPONSE,
}

/** Approximate streaming duration in ms for each content piece. */
const DURATION_MAP: Record<DemoContentId, number> = {
  brief: 14_000, // ~14s (TTS is ~18s, streaming finishes slightly before audio)
  qa: 6_000,     // ~6s  (TTS is ~8s)
}

/** Retrieve streamable content by ID. Returns null if ID is invalid. */
export function getDemoContent(contentId: string): string | null {
  return CONTENT_MAP[contentId as DemoContentId] ?? null
}

/** Get approximate streaming duration for a content piece. */
export function getDemoStreamDuration(contentId: DemoContentId): number {
  return DURATION_MAP[contentId]
}
