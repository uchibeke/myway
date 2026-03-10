/**
 * Home Screen Proposal & Nudge Configuration
 *
 * All ambient messaging lives here — proposals, setup nudges, and visitor prompts.
 * The home page imports these and weaves them into the ambient layer.
 *
 * Design: proposals are time-aware, context-aware, and state-aware.
 * The same Suggestion type drives everything — no special components needed.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Suggestion = {
  appId: string
  title: string
  subtitle: string
  badge?: string
  prompt?: string
  /** Override the default app route (e.g. deep-link to a specific tab) */
  href?: string
}

export type SetupStatus = {
  hasProfile: boolean
  hasConnections: boolean
  hasNotes: boolean
  hasUsedChat: boolean
  hasTasks: boolean
}

export type VisitorHints = {
  city?: string
  region?: string
  country?: string
  timezone?: string
  /** Day of week 0-6 (Sun-Sat), derived client-side or from timezone */
  dayOfWeek?: number
  /** Month 0-11, derived client-side */
  month?: number
}

type TimeSlot = {
  start: number
  end: number
  proposals: (ctx: ProposalContext) => Suggestion[]
}

type ProposalContext = {
  taskLine: string | null
  mitLine: string | null
}

// ─── Visitor Proposals ────────────────────────────────────────────────────────
//
// Shown to unauthenticated visitors on myway.sh. The home page IS the landing
// page. No marketing site needed — the ambient layer sells the product.

export function getVisitorProposals(hour: number, hints: VisitorHints): Suggestion[] {
  // ── Contextual data (all derived, no DB, no async) ──────────────────────
  const city = hints.city
  const now = new Date()
  const dayOfWeek = hints.dayOfWeek ?? now.getDay() // 0=Sun
  const month = hints.month ?? now.getMonth()        // 0=Jan
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const isFriday = dayOfWeek === 5
  const isWinter = month >= 11 || month <= 1  // Dec-Feb
  const isSummer = month >= 5 && month <= 7   // Jun-Aug

  // Visitor proposals: hero card (time+context aware) + 2 personality + 2 depth.
  // The hero sells the moment. Personality cards make people screenshot.
  // Depth cards show this isn't a toy — it's a system.
  //
  // Key: visitors don't care about "Tasks" or "Files". They care about
  // things that feel alive, personal, and surprising. Show the magic first.

  // ── Hero card: hyper-contextual, sells the exact moment ─────────────────
  let hero: Suggestion

  if (hour >= 5 && hour < 9) {
    hero = isWeekend
      ? {
          appId: 'brief',
          title: 'Your lazy morning brief',
          subtitle: city ? `Weekend vibes in ${city}` : 'No alarm. Just the good stuff.',
          badge: 'now',
        }
      : {
          appId: 'brief',
          title: 'Your morning brief is waiting',
          subtitle: city ? `AI that already knows your day in ${city}` : 'AI that already knows your day',
          badge: 'now',
        }
  } else if (hour >= 9 && hour < 12) {
    hero = {
      appId: 'chat',
      title: isWeekend ? 'Weekend brain, meet AI' : 'Deep work mode',
      subtitle: city
        ? `Your AI assistant, awake in ${city}`
        : 'Ask anything. Full model access. Fully private.',
      badge: 'now',
    }
  } else if (hour >= 12 && hour < 14) {
    hero = {
      appId: 'mise',
      title: 'Quick lunch ideas',
      subtitle: city ? `What can you make in ${city} right now?` : 'Recipes from your own vault, AI-powered',
      badge: 'now',
    }
  } else if (hour >= 14 && hour < 17) {
    hero = isFriday
      ? {
          appId: 'roast',
          title: 'Friday afternoon roast',
          subtitle: 'Feed it your week. Get lovingly destroyed.',
          badge: 'fun',
        }
      : {
          appId: 'chat',
          title: 'An AI that actually knows you',
          subtitle: city
            ? `Not a chatbot. A personal intelligence in ${city}.`
            : 'Not a chatbot. A personal intelligence.',
          badge: 'now',
        }
  } else if (hour >= 17 && hour < 21) {
    hero = {
      appId: 'mise',
      title: "What's for dinner?",
      subtitle: city ? `Your recipe vault in ${city}` : 'Your recipe vault, powered by AI',
      badge: 'now',
    }
  } else {
    // Night 9pm-5am
    hero = {
      appId: 'somni',
      title: isWinter
        ? 'A cozy bedtime story'
        : isSummer
        ? 'A summer night story'
        : 'A bedtime story that knows you',
      subtitle: 'Personalized. Never repeats. Every night is different.',
      badge: 'now',
    }
  }

  // ── Personality cards: the "screenshot" apps ────────────────────────────
  // Time-and-context-aware subtitles make these feel alive, not canned.
  const personalityPool: Suggestion[] = [
    {
      appId: 'somni',
      title: isWinter ? 'Cozy AI bedtime stories' : 'AI bedtime stories',
      subtitle: isWeekend
        ? 'No alarm tomorrow. Let the story go long.'
        : 'It knows your day and writes you a new story every night.',
      badge: 'preview',
    },
    {
      appId: 'roast',
      title: isFriday ? 'Friday roast session' : 'Get roasted by AI',
      subtitle: isWeekend
        ? "You've got time. Let it see your resume."
        : 'Feed it anything. Resume, idea, text. Get lovingly destroyed.',
      badge: 'fun',
    },
    {
      appId: 'oracle',
      title: hour >= 20 ? 'Late-night Oracle' : 'Ask The Oracle',
      subtitle: isWeekend
        ? 'Weekend questions deserve cosmic answers.'
        : 'Cosmic wisdom. Absolute confidence. Zero guarantees.',
      badge: 'fun',
    },
    {
      appId: 'drama',
      title: 'Make it dramatic',
      subtitle: isFriday
        ? "Paste your boss's Friday email. You deserve this."
        : 'Paste anything boring. Get the telenovela treatment.',
      badge: 'fun',
    },
    {
      appId: 'decode',
      title: 'Decode any message',
      subtitle: 'Paste a text. Get the subtext, strategy, and perfect reply.',
      badge: 'preview',
    },
    {
      appId: 'compliment-avalanche',
      title: isWeekend ? 'Weekend self-care' : 'Compliment Avalanche',
      subtitle: isWeekend
        ? "You made it. Tap for five reasons you're incredible."
        : 'One button. Five escalating, wildly specific compliments.',
      badge: 'fun',
    },
  ]

  // ── Depth cards: show this is a real system ─────────────────────────────
  const depthPool: Suggestion[] = [
    {
      appId: 'tasks',
      title: 'Tasks that think for themselves',
      subtitle: isWeekend
        ? 'Even your to-do list gets a weekend mode.'
        : 'Not a to-do list. An autonomous system that nudges you.',
    },
    {
      appId: 'guardrails',
      title: 'You control the AI. Always.',
      subtitle: 'Every agent action — visible, auditable, blockable.',
    },
    {
      appId: 'chat',
      title: 'Full AI access, fully private',
      subtitle: city
        ? `Your conversations never leave ${city}.`
        : 'Your conversations. Your data. Your machine.',
    },
    {
      appId: 'notes',
      title: hour >= 22 || hour < 5 ? 'Capture midnight thoughts' : 'Capture thoughts instantly',
      subtitle: 'Voice or text — AI organizes everything.',
    },
  ]

  // Pick personality and depth cards that don't duplicate the hero
  const personality = personalityPool.filter(s => s.appId !== hero.appId)
  const depth = depthPool.filter(s => s.appId !== hero.appId)

  // Use hour as a stable rotation index so cards vary by time slot
  const pIdx = Math.floor(hour / 3) % personality.length
  const dIdx = Math.floor(hour / 4) % depth.length

  return [
    hero,
    personality[pIdx],
    personality[(pIdx + 1) % personality.length],
    depth[dIdx],
    depth[(dIdx + 1) % depth.length],
  ]
}

// ─── Visitor Context Lines ────────────────────────────────────────────────────

export function getVisitorContextLine(hints: VisitorHints): string {
  const now = new Date()
  const hour = now.getHours()
  const dayOfWeek = hints.dayOfWeek ?? now.getDay()
  const month = hints.month ?? now.getMonth()
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const city = hints.city

  // Time + context-aware taglines — the visitor should feel like the page
  // was written for them, at this exact moment, in their city.

  // Night visitors
  if (hour >= 23 || hour < 5) {
    if (city) return `Still up in ${city}? Your AI never sleeps either.`
    return 'The most honest hour. Your AI is awake too.'
  }

  // Early morning
  if (hour >= 5 && hour < 8) {
    if (isWeekend) {
      if (city) return `Quiet morning in ${city}. 14 apps, all yours.`
      return 'No alarm. No rush. Your AI home is ready when you are.'
    }
    if (city) return `Good morning, ${city}. Your AI home is ready.`
    return 'Before the noise. 14 apps. One AI. Entirely yours.'
  }

  // Morning
  if (hour >= 8 && hour < 12) {
    if (city) return `Your personal AI, running in ${city}. Private by design.`
    return 'Your AI, your data, your machine. No compromises.'
  }

  // Lunch
  if (hour >= 12 && hour < 14) {
    if (city) return `Lunch hour in ${city}. Let your AI handle the rest.`
    return 'Midday break. 14 apps that think so you don\'t have to.'
  }

  // Afternoon
  if (hour >= 14 && hour < 17) {
    if (dayOfWeek === 5) {
      if (city) return `Friday afternoon in ${city}. You made it.`
      return 'Friday mode. Your AI has opinions about your weekend.'
    }
    if (city) return `Afternoon in ${city}. Private AI that actually knows you.`
    return 'Private by default. Personal by design.'
  }

  // Evening
  if (hour >= 17 && hour < 20) {
    const seasonHint = month >= 11 || month <= 1 ? 'Cozy evening.' : ''
    if (city) return `Evening in ${city}. ${seasonHint} Your AI is winding down with you.`
    if (seasonHint) return `${seasonHint} 14 apps. Bedtime stories included.`
    return 'Golden hour. Your AI home, glowing.'
  }

  // Late evening
  if (isWeekend) {
    if (city) return `Weekend night in ${city}. Stories, wisdom, roasts — all yours.`
    return 'Weekend night. The Oracle is waiting. So is Somni.'
  }
  if (city) return `Night falls in ${city}. Your AI home is still glowing.`
  return 'The day is writing its summary. Your AI remembers all of it.'
}

// ─── Setup Nudges ─────────────────────────────────────────────────────────────
//
// Shown to authenticated users who haven't completed setup steps.
// Priority order: profile > chat > notes > tasks > connections.
// Nudges replace the lowest-priority proposal slot(s).

const SETUP_NUDGE_DEFS: { key: keyof SetupStatus; nudge: Suggestion }[] = [
  {
    key: 'hasProfile',
    nudge: {
      appId: 'settings',
      title: 'Make Myway yours',
      subtitle: 'Set your name and timezone — 30 seconds',
      badge: 'setup',
      href: '/apps/settings?tab=profile',
    },
  },
  {
    key: 'hasUsedChat',
    nudge: {
      appId: 'chat',
      title: 'Say hello',
      subtitle: 'Your AI assistant is ready',
      badge: 'start',
      prompt: "Hey! I'm new here. What can you help me with?",
    },
  },
  {
    key: 'hasNotes',
    nudge: {
      appId: 'notes',
      title: 'Capture your first thought',
      subtitle: 'Voice or text — AI organizes it',
    },
  },
  {
    key: 'hasTasks',
    nudge: {
      appId: 'tasks',
      title: 'What are you working on?',
      subtitle: 'Add your first task — AI keeps it alive',
      prompt: 'Help me create my first task',
    },
  },
  {
    key: 'hasConnections',
    nudge: {
      appId: 'settings',
      title: 'Connect your world',
      subtitle: 'Calendar, email — one tap each',
      href: '/apps/settings?tab=connections',
    },
  },
]

export function getSetupNudges(setup: SetupStatus | undefined): Suggestion[] {
  if (!setup) return []
  return SETUP_NUDGE_DEFS
    .filter(def => !setup[def.key])
    .map(def => def.nudge)
}

// ─── Time-Aware Proposals (authenticated users) ──────────────────────────────

const TIME_SLOTS: TimeSlot[] = [
  {
    start: 5, end: 9,
    proposals: ({ taskLine, mitLine }) => [
      {
        appId: 'brief',
        title: 'Your morning brief',
        subtitle: mitLine ? `MIT: ${mitLine}` : (taskLine ?? 'Start with what matters today'),
        badge: 'now',
        prompt: 'Give me my morning brief',
      },
      {
        appId: 'tasks',
        title: "Today's focus",
        subtitle: taskLine ?? 'See what needs doing',
        prompt: "What should I focus on today?",
      },
      {
        appId: 'chat',
        title: 'Clear your head',
        subtitle: 'Before the day begins',
        prompt: 'Help me clear my head and plan the morning',
      },
    ],
  },
  {
    start: 9, end: 12,
    proposals: ({ taskLine, mitLine }) => [
      {
        appId: 'chat',
        title: 'Deep work mode',
        subtitle: 'Ask anything — full AI access',
        badge: 'focus',
      },
      {
        appId: 'tasks',
        title: mitLine ? `Ship it: ${mitLine}` : 'Your tasks',
        subtitle: taskLine ?? 'What are you working on?',
        prompt: mitLine ? `Help me ship: ${mitLine}` : "What should I work on right now?",
      },
      {
        appId: 'files',
        title: 'Pick up where you left off',
        subtitle: 'Browse your server files',
      },
    ],
  },
  {
    start: 12, end: 14,
    proposals: () => [
      {
        appId: 'roast',
        title: 'Lunch break entertainment',
        subtitle: 'Get humbled by your own files',
        badge: 'fun',
      },
      {
        appId: 'mise',
        title: 'Quick lunch ideas',
        subtitle: 'What can you make right now?',
        prompt: 'Suggest quick lunch ideas I can make in under 20 minutes',
      },
      {
        appId: 'oracle',
        title: 'Ask the unanswerable',
        subtitle: 'The Oracle is always confident',
        prompt: 'Oracle, what should I ponder today?',
      },
    ],
  },
  {
    start: 14, end: 17,
    proposals: ({ taskLine }) => [
      {
        appId: 'office',
        title: 'Fix that email',
        subtitle: 'Corporate → human translation',
      },
      {
        appId: 'tasks',
        title: 'Afternoon check-in',
        subtitle: taskLine ?? 'How is the day going?',
        prompt: 'Give me an afternoon check-in on my tasks',
      },
      {
        appId: 'drama',
        title: 'Make something boring epic',
        subtitle: 'Paste anything for the telenovela treatment',
      },
    ],
  },
  {
    start: 17, end: 20,
    proposals: () => [
      {
        appId: 'mise',
        title: "What's for dinner?",
        subtitle: 'Recipes from your vault',
        badge: 'dinner',
        prompt: "What should I make for dinner tonight? Suggest recipes from my vault",
      },
      {
        appId: 'compliment-avalanche',
        title: 'You deserve this',
        subtitle: '5 escalating compliments. One tap.',
      },
      {
        appId: 'chat',
        title: 'Wrap up the day',
        subtitle: 'Process, plan, or just chat',
        prompt: 'Help me wrap up the day — what did I get done and what should I carry forward?',
      },
    ],
  },
  {
    start: 20, end: 22,
    proposals: () => [
      {
        appId: 'oracle',
        title: 'Evening wisdom',
        subtitle: 'Ask the cosmic question',
        prompt: 'Oracle, share your evening wisdom',
      },
      {
        appId: 'decode',
        title: 'Decode that message',
        subtitle: 'What did they really mean?',
      },
      {
        appId: 'somni',
        title: 'Wind down tonight',
        subtitle: 'A story made just for you',
        badge: 'rest',
        prompt: 'Tell me a winding-down story for tonight',
      },
    ],
  },
]

// Night fallback: 10pm - 5am
const NIGHT_PROPOSALS: Suggestion[] = [
  {
    appId: 'somni',
    title: 'Ready for sleep?',
    subtitle: 'A story that knows your day',
    badge: 'rest',
    prompt: 'I want to sleep. Tell me a story',
  },
  {
    appId: 'oracle',
    title: 'Night wisdom',
    subtitle: 'The Oracle never sleeps',
    prompt: 'Oracle, what wisdom do you have for the late night?',
  },
  {
    appId: 'notes',
    title: 'Capture that thought',
    subtitle: 'Before you forget it',
  },
]

export function getTimeProposals(hour: number, ctx: ProposalContext): Suggestion[] {
  const slot = TIME_SLOTS.find(s => hour >= s.start && hour < s.end)
  return slot ? slot.proposals(ctx) : [...NIGHT_PROPOSALS]
}

/**
 * Build the final proposal list for an authenticated user.
 * Time-aware proposals with setup nudges woven into the last slot(s).
 *
 * @param contextCallback - US-012: if truthy, user is on their first return
 *   visit after onboarding. Show goal-oriented proposals instead of generic ones.
 */
export function getProposals(
  hour: number,
  tasks: { totalOpen: number; dueToday: number; mit: string | null } | null,
  setup: SetupStatus | undefined,
  contextCallback?: string,
): Suggestion[] {
  const taskLine = tasks
    ? `${tasks.totalOpen} open${tasks.dueToday ? ` · ${tasks.dueToday} due today` : ''}`
    : null
  const mitLine = tasks?.mit || null

  // US-012: First return after onboarding — user has a profile but may not
  // have used the system yet. Show proposals that build on their onboarding
  // context (goal, interests) rather than generic "say hello" cards.
  if (contextCallback && setup) {
    const returnProposals: Suggestion[] = [
      {
        appId: 'chat',
        title: 'Pick up where you left off',
        subtitle: 'Your AI remembers your onboarding conversation',
        badge: 'now',
        prompt: "Let's continue from where we left off. What should I focus on?",
      },
      hour >= 17 && hour < 21
        ? {
            appId: 'mise',
            title: "What's for dinner?",
            subtitle: 'Your AI recipe assistant is ready',
            badge: 'fun',
            prompt: 'Suggest something easy for dinner tonight',
          }
        : hour >= 20 || hour < 5
        ? {
            appId: 'somni',
            title: 'Try a bedtime story',
            subtitle: 'Personalized, never repeats',
            badge: 'rest',
            prompt: 'Tell me a story',
          }
        : {
            appId: 'tasks',
            title: 'Turn your goal into tasks',
            subtitle: 'AI breaks big goals into actionable steps',
            badge: 'start',
            prompt: 'Help me break down my main goal into actionable tasks',
          },
      {
        appId: 'brief',
        title: 'Your daily briefing',
        subtitle: 'AI-curated morning overview — customized for you',
        prompt: 'Give me my briefing',
      },
    ]
    // Still weave in top setup nudge if there are incomplete setup steps
    const nudges = getSetupNudges(setup)
    if (nudges.length > 0) {
      returnProposals[returnProposals.length - 1] = nudges[0]
    }
    return returnProposals
  }

  // Brand-new user (no profile, no chat): skip data-dependent proposals
  // and show the setup nudge + interactive apps that work without context.
  // Time-aware: evening users see Somni first, morning users see Chat first.
  const isNewUser = setup && !setup.hasProfile && !setup.hasUsedChat
  if (isNewUser) {
    const nudges = getSetupNudges(setup)

    // Pick the second card based on time — something that works with zero data
    const secondCard: Suggestion = hour >= 20 || hour < 5
      ? {
          appId: 'somni',
          title: 'Try a bedtime story',
          subtitle: 'AI-generated, personalized, never repeats',
          badge: 'fun',
          prompt: 'Tell me a story',
        }
      : hour >= 12 && hour < 17
      ? {
          appId: 'roast',
          title: 'Get roasted by AI',
          subtitle: 'Feed it anything. Get lovingly destroyed.',
          badge: 'fun',
        }
      : hour >= 17 && hour < 20
      ? {
          appId: 'mise',
          title: "What's for dinner?",
          subtitle: 'Try your AI recipe assistant',
          badge: 'fun',
          prompt: 'Suggest something easy for dinner tonight',
        }
      : {
          appId: 'somni',
          title: 'Try a bedtime story',
          subtitle: 'AI-generated, personalized, never repeats',
          badge: 'fun',
          prompt: 'Tell me a story',
        }

    const firstTry: Suggestion[] = [
      {
        appId: 'chat',
        title: 'Say hello to your AI',
        subtitle: 'Start a conversation — it remembers everything',
        badge: 'start',
        prompt: "Hey! I'm new here. What can you help me with?",
      },
      secondCard,
      // Third slot: top setup nudge or fallback
      nudges.length > 0
        ? nudges[0]
        : {
            appId: 'oracle',
            title: 'Ask The Oracle',
            subtitle: 'Cosmic wisdom. Absolute confidence.',
            badge: 'fun',
            prompt: 'Oracle, what should I know?',
          },
    ]
    return firstTry
  }

  const proposals = getTimeProposals(hour, { taskLine, mitLine })

  // Weave in setup nudges — replace the last slot(s) with the highest-priority
  // nudge the user hasn't completed yet.
  const nudges = getSetupNudges(setup)
  if (nudges.length > 0) {
    const slotsToReplace = 1
    const insertNudges = nudges.slice(0, slotsToReplace)
    proposals.splice(proposals.length - slotsToReplace, slotsToReplace, ...insertNudges)
  }

  return proposals
}

// ─── Context line ─────────────────────────────────────────────────────────────

export function getContextLine(
  tasks: { totalOpen: number; dueToday: number; mit: string | null } | null,
  setup: SetupStatus | undefined,
  ambientThought: string,
): string {
  // New user: warm welcome
  if (setup && !setup.hasProfile && !setup.hasUsedChat) {
    return 'Welcome home. Try anything — it all learns from you.'
  }
  // Has tasks: show summary
  if (tasks && tasks.totalOpen > 0) {
    const parts: string[] = [`${tasks.totalOpen} task${tasks.totalOpen !== 1 ? 's' : ''}`]
    if (tasks.dueToday > 0) parts.push(`${tasks.dueToday} due today`)
    if (tasks.mit) parts.push(tasks.mit)
    return parts.join(' · ')
  }
  // Fallback: time-of-day ambient thought
  return ambientThought
}
