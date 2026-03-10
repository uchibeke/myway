/**
 * Myway App Registry
 *
 * Single source of truth for all apps. Adding a new app requires:
 *  1. A SKILL.md at ~/.openclaw/workspace/skills/<slug>/SKILL.md
 *  2. One entry in the APPS array below
 *  3. A custom page ONLY if interactionType is 'tool' (complex custom UI)
 *
 * Everything else — chat UI, opener, gradients, header — is handled automatically.
 *
 * Identity inheritance:
 *  OpenClaw Base (SOUL.md + IDENTITY.md + USER.md)
 *    └── App Skill (SKILL.md defines personality overlay)
 *          └── App Identity (goal, personality, memory — declared here)
 */

export type AppCategory = 'ai' | 'utility' | 'system' | 'daily-driver' | 'meta'

/**
 * Tab definition for tool apps that use a segmented tab interface.
 * Follows the same pattern as SettingsTabDef — icon is a Lucide icon name.
 * The page resolves the name to a component using its own ICON_MAP.
 *
 * Order: use multiples of 10 to leave room for future insertions.
 */
export type AppTabDef = {
  id: string
  label: string
  /** Lucide icon name (e.g. 'play', 'map-pin', 'file-text', 'history') */
  icon: string
  order: number
}

/** Helper — sort tabs by order field */
export function getSortedAppTabs(tabs: AppTabDef[]): AppTabDef[] {
  return [...tabs].sort((a, b) => a.order - b.order)
}

export type AppSkill = {
  slug: string
  tools?: string[]
}

export type AppOAP = {
  passportId?: string
  /** OAP spec kind: 'template' = shareable blueprint, 'instance' = deployed for a specific user. */
  kind?: 'template' | 'instance'
  specVersion?: string
  status?: 'active' | 'suspended' | 'revoked'
  assuranceLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4KYC' | 'L4FIN'
  capabilities?: string[]
  mcpServers?: string[]
  limits?: {
    requestsPerMinute?: number
    requestsPerDay?: number
    maxTokensPerRequest?: number
  }
}

export type AppIdentity = {
  /** One-sentence mission. What does this app exist to accomplish FOR the user? */
  goal: string
  /** Personality traits that flavor SKILL.md prompts and UI microcopy. */
  personality: string[]
  /** Path under ~/vault where this app persists learned state. */
  memoryPath?: string
}

export type CronPreset = {
  name: string
  description: string
  schedule: string
  defaultMessage: string
}

/**
 * Autonomy configuration for a Myway app.
 *
 * PRIMARY MECHANISM — heartbeat (context-aware, batched, cheap):
 *   OpenClaw reads HEARTBEAT.md every 30 min and decides whether to act.
 *   Use `heartbeatChecks` for ambient monitoring that doesn't need exact timing.
 *
 * SECONDARY MECHANISM — cron (exact timing only):
 *   Use `cronPresets` ONLY when exact clock time matters (e.g. "4:30 PM dinner").
 *   Cron fires blindly — it does not have session context.
 *
 * Source: https://docs.openclaw.ai/automation/cron-vs-heartbeat
 */
export type AppAutonomy = {
  ambient: boolean
  /**
   * Context-aware checks added to HEARTBEAT.md.
   * The agent reads these every 30 min and decides whether to act.
   * Prefer this over cronPresets for most ambient tasks.
   */
  heartbeatChecks?: string[]
  /**
   * Exact-time cron jobs. Use ONLY when clock precision is required.
   * Displayed in the Schedule UI for user configuration.
   */
  cronPresets?: CronPreset[]
  webhooks?: string[]
  fsWatchers?: string[]
}

/**
 * How the app renders its UI.
 *
 * 'chat'        — Conversational, streaming (AppShell). Most apps.
 * 'transformer' — Input on left → transformed output on right. Drama Mode, Office Translator.
 * 'feed'        — AI generates a scrollable feed (legacy — prefer 'chat' + autoPrompt).
 * 'canvas'      — Rich editor/viewer. Notes.
 * 'button'      — One-tap trigger → output. Compliment Avalanche.
 * 'tool'        — Fully custom page. Files, Mise. Requires its own page.tsx.
 */
export type AppInteractionType = 'chat' | 'transformer' | 'feed' | 'canvas' | 'button' | 'tool'

/**
 * Special output animation for button-type apps.
 * Implemented in ButtonShell — available to any app declaring it.
 *
 * 'avalanche' — Splits numbered list response into individually falling items.
 *               Each item animates in with a staggered CSS spring delay.
 *               Designed for Compliment Avalanche but reusable.
 * 'cascade'   — Reserved for future: each paragraph fades up sequentially.
 */
export type ResponseAnimation = 'avalanche' | 'cascade'

/**
 * Time-of-day band used to filter quick actions contextually.
 * Derived client-side from the device clock — no server round-trip.
 */
export type TimeOfDay =
  | 'early_morning'  // 4–7am
  | 'morning'        // 7am–12pm
  | 'midday'         // 12–2pm
  | 'afternoon'      // 2–6pm
  | 'evening'        // 6–10pm
  | 'night'          // 10pm–4am

/**
 * An input field collected in the inline form shown when a template action
 * is selected. The user fills in each input; the shell assembles the final
 * prompt by substituting [id] placeholders in the template string.
 */
export type QuickActionInput = {
  /** Matches the [id] placeholder in the template string. */
  id: string
  /** Human-readable label shown above the input field. */
  label: string
  /** Placeholder text inside the input. */
  placeholder?: string
  /** Input type — default is 'textarea'. */
  type?: 'textarea' | 'text' | 'select'
  /** Options for select type. */
  options?: string[]
  /** Whether submission is blocked without this field. Default: true. */
  required?: boolean
}

/**
 * Quick action shown in the app's empty state (opener).
 *
 * Three modes (mutually exclusive):
 *   1. Static  — `prompt` fires immediately on click (e.g., sample Drama rewrite).
 *   2. Template — `template` + `inputs` renders an inline form; the shell assembles
 *                 the final prompt by substituting [id] placeholders. The user never
 *                 sees the template — they only see the labelled inputs.
 *   3. (Legacy) — `prompt` ending with ' ' was the old disabled-button hint; migrate
 *                 these to template mode.
 *
 * `when` filters the action by time of day — absent means always shown.
 * Example: dinner suggestions should not appear in the morning.
 */
export type AppQuickAction = {
  label: string    // e.g. "🎭 That Slack message"
  hint: string     // Sub-label shown beside the button
  // Static mode
  prompt?: string
  // Template mode
  template?: string
  inputs?: QuickActionInput[]
  // Time-of-day filter
  when?: TimeOfDay[]
  /**
   * Context reference — tells the backend which data source(s) to resolve
   * and inject into the system prompt for this action.
   *
   * Values: 'tasks', 'recipes', 'notes', 'memories', 'email', 'calendar',
   *         'conversations', 'files', '*' (all available sources).
   *
   * The backend resolves these server-side — data never appears in the user
   * message bubble. See context-refs.ts for the resolver.
   */
  contextRef?: string
}

/**
 * Opener config — the empty state shown before any messages.
 * Declare here instead of a custom page for simple apps.
 */
export type AppOpener = {
  title: string
  tagline: string
  quickActions: AppQuickAction[]
}

export type AppMeta = {
  categories: string[]
  tags: string[]
  author: string
  version: string
  changelog?: string
}

/** A Myway app — a small agent with identity, goals, memory, and autonomy. */
export type AppStorage = {
  /** Store conversation history in DB. Auto-true for chat/transformer apps. */
  conversations?: boolean
  /** Store long-term memories in DB. */
  memory?: boolean
  /** Artifact types this app produces (e.g. ['markdown', 'image']). */
  artifacts?: string[]
  /** Event subjects this app emits on the bus (e.g. ['recipe.saved']). */
  emits?: string[]
  /** Event subjects this app listens for (e.g. ['user.*', 'recipe.saved']). */
  subscribes?: string[]
  /**
   * Named data resource this app manages (e.g. 'tasks', 'recipes').
   *
   * Used by the smart router to auto-inherit resource-type query handlers —
   * any app declaring `resource: 'tasks'` immediately gets instant task lookups
   * without manual registration. Forge uses this when generating CRUD apps.
   *
   * Maps to a key in RESOURCE_HANDLERS in smart-router.ts.
   */
  resource?: string
}

export type MywayApp = {
  id: string
  name: string
  description: string
  icon: string
  color: string             // Tailwind bg-* class
  route: string
  live: boolean
  category: AppCategory
  /** How this app renders. Default: 'chat'. 'tool' = custom page.tsx required. */
  interactionType?: AppInteractionType
  skill?: AppSkill
  /** Opener shown before first message. Not needed for 'tool' apps. */
  opener?: AppOpener
  identity?: AppIdentity
  autonomy?: AppAutonomy
  oap?: AppOAP
  meta?: AppMeta
  /**
   * Declarative storage manifest — what this app persists and what it listens to.
   * Seeded to DB by db:init. Defaults are inferred from interactionType when absent.
   */
  storage?: AppStorage
  /**
   * Auto-send this prompt on mount when there are no existing messages.
   *
   * - For `feed` apps: replaces any hardcoded generation string. FeedShell reads
   *   this and generates immediately, no user action required.
   * - For `chat` apps: fires as `initialMessage` on fresh open, giving users
   *   an immediate response (pre-emptive rendering).
   *
   * Do NOT set for apps where the user's specific input is always required first
   * (e.g. Decode, Drama Mode — they need the paste/content before doing anything).
   */
  autoPrompt?: string

  /**
   * Special output animation for button-type apps (see ResponseAnimation type above).
   * ButtonShell checks this and uses the animated renderer instead of a single card.
   */
  responseAnimation?: ResponseAnimation

  /**
   * How much server-side context to inject into the system prompt.
   *
   * 'full'     — everything (memories, tasks, recipes, notes, email, calendar).
   *              Default for persistent apps (chat, feed, tool with conversations).
   * 'personal' — palette summary (counts + samples) + profile + signals.
   *              Lightweight but personal. No DB writes, no conversation persistence.
   * 'temporal' — date/time only. Default for transformer/button apps.
   *
   * Defaults inferred from isPersistentApp() for backwards compatibility.
   * Explicit contextLevel overrides inference.
   */
  contextLevel?: 'full' | 'personal' | 'temporal'

  /**
   * Verb phrase enabling auto-generated dynamic opener presets.
   *
   * When set, GenericOpener (and ButtonShell) fetches the context palette and
   * generates presets per source. Format: "${contextAction} my ${source.label}".
   *
   * Example: "Roast me based on" → "Roast me based on my tasks"
   */
  contextAction?: string

  /**
   * When true, the app's tasks are primarily action/command type (save, fetch, store).
   * The AI response is confirmation, not the primary value.
   *
   * This enables the non-blocking deferred experience:
   *  - Input unlocked immediately after send (user can compose or leave)
   *  - Optimistic ack shown before first token arrives
   *  - Response streams back when ready (if user is still present)
   *
   * Do NOT set for pure query apps (chat, Q&A) where the response IS the product.
   * Science: peak-end rule, Zeigarnik effect, Nielsen 10s rule.
   */
  deferrable?: boolean

  /**
   * AI provider for this app (e.g. 'gemini', 'anthropic', 'deepseek').
   * Must match a provider ID in the model registry (OpenClaw config or models.json).
   * When set, the chat route connects directly to this provider instead of the gateway.
   * Falls back to MYWAY_DEFAULT_PROVIDER env var, then the base AI backend.
   */
  provider?: string

  /**
   * AI model for this app (e.g. 'gemini-2.5-flash', 'claude-haiku-4-5-20251001').
   * Used with `provider` to select a specific model.
   * Falls back to MYWAY_DEFAULT_MODEL env var, then the provider's first model.
   */
  model?: string

  /**
   * Semantic model class hint. Used to select the right default when
   * no explicit provider/model is set and no env defaults exist.
   *
   * 'creative' — quality-focused (narrative, briefings, analysis)
   * 'fast'     — speed + cost optimized (chat, tasks, quick queries)
   *
   * Default: 'fast'
   */
  modelClass?: 'creative' | 'fast' | 'smart'

  /**
   * TTS provider override for this app's voice generation.
   * Default: 'lmnt'. Apps can specify 'elevenlabs' or 'moss'.
   */
  ttsProvider?: 'lmnt' | 'elevenlabs' | 'moss' | 'inworld'

  /**
   * Tab definitions for tool apps that render a segmented tab interface.
   * Only meaningful when interactionType === 'tool'.
   *
   * Pages read this via getApp(id)?.tabs and resolve Lucide icon names
   * to components using their own ICON_MAP (keeping icon deps in the page,
   * not in the registry).
   *
   * Use getSortedAppTabs() to get them in display order.
   */
  tabs?: AppTabDef[]

  /**
   * Default view mode for the app's phone card shell on desktop.
   *
   * 'mobile'   — 390/480px phone card (default)
   * 'expanded' — up to 960px wide, same border/rounding treatment
   *
   * User can override via the toggle button; preference is stored in localStorage.
   */
  defaultViewMode?: 'mobile' | 'expanded'

  /**
   * Private apps are excluded from the home page, search, and proposals.
   * Visiting a private app URL returns 404.
   * Use this for apps that contain personal/internal logic not meant for open-source.
   */
  isPrivate?: boolean

  /**
   * Pricing model for platform-registered apps (from AppRoom manifest).
   *
   * 'free'         — no restrictions (default for all static apps)
   * 'subscription' — requires active subscription + outcome quota
   *
   * Static apps in this file are always free. Dynamic apps from AppRoom
   * may have subscription pricing with outcome-based quotas.
   *
   * When pricing is 'subscription', the chat route checks quota via AppRoom
   * before streaming. Quota exceeded returns an addon prompt SSE event.
   */
  pricing?: {
    model: 'free' | 'subscription'
    /** Monthly price in cents (from AppRoom manifest). Display only. */
    monthlyCents?: number
    /** Outcome types this app tracks (e.g. ['draft-professional-email']). */
    outcomeTypes?: string[]
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

const APPS: MywayApp[] = [

  // ── Meta ──────────────────────────────────────────────────────────────────
  {
    id: 'forge',
    name: 'Forge',
    description: 'Describe any app you want. Forge builds it — SKILL.md, opener, and all.',
    icon: '⚒️',
    color: 'bg-slate-600',
    route: '/apps/forge',
    live: true,
    isPrivate: true,
    category: 'meta',
    interactionType: 'chat',
    skill: { slug: 'forge' },
    identity: {
      goal: 'Turn a one-sentence idea into a working Myway app',
      personality: ['Precise', 'Asks the right questions', 'Generates real files', 'Explains what it made'],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'Build a new app',
      tagline: 'Describe what you want. Forge writes the SKILL.md, picks the interaction type, and adds it to your home screen.',
      quickActions: [
        { label: '🐦 Twitter mood tracker', prompt: 'Build me an app that checks my Twitter timeline and tells me the overall mood — am I doom-scrolling or is today actually okay?', hint: 'Analyzes your feed' },
        { label: '🌦️ Weather personality', prompt: "Build me an app that gives me a personality-driven weather forecast — not just temperature but vibe. Like 'It's a \"cancel your plans\" kind of day.'", hint: 'Weather with character' },
        { label: '📖 Book summarizer', prompt: 'Build me an app I can paste any book title into and get a 5-point honest summary — not a fan summary, a realistic one.', hint: 'What it actually says' },
        {
          label: '✏️ Describe your idea',
          hint: 'Build anything',
          template: 'Build me an app that [idea]',
          inputs: [{ id: 'idea', label: 'What should the app do?', placeholder: 'e.g. "tracks my sleep and tells me if I\'m getting enough"' }],
        },
      ],
    },
    oap: { passportId: 'a0000001-miid-1way-0001-000000000001', assuranceLevel: 'L0', capabilities: ['filesystem.write', 'chat.generate'] },
    storage: { conversations: true, memory: true },
    meta: { categories: ['meta', 'ai'], tags: ['app-builder', 'forge', 'generative'], author: 'myway', version: '1.0.0' },
  },

  // ── Tier 0: Daily Driver ───────────────────────────────────────────────────
  {
    id: 'mise',
    name: 'Mise',
    description: 'Your recipe vault. Save links, videos, anything. Chat with your collection. It plans dinner before you ask.',
    icon: '🍲',
    color: 'bg-orange-500',
    route: '/apps/mise',
    live: true,
    category: 'daily-driver',
    interactionType: 'tool',  // custom page — rich URL capture UI
    skill: {
      slug: 'mise',
      tools: ['filesystem.read', 'filesystem.write', 'web.fetch', 'web.search'],
    },
    identity: {
      goal: "Remove the 5pm \"what's for dinner?\" anxiety — forever",
      personality: ['Honest about time', 'Anti-aspirational', 'Warm', 'Practical', 'Remembers everything'],
      memoryPath: 'mise/preferences.json',
    },
    autonomy: {
      ambient: true,
      // Heartbeat: context-aware checks every 30 min — agent decides whether to act
      heartbeatChecks: [
        'Check ~/vault/recipes/ for any new files that arrived since last heartbeat and process them',
        'If it is a weekday between 3pm and 5pm local time and dinner has not been suggested today, suggest 3 realistic dinner options from the vault. Deliver via email.briefing (subject: "Dinner Ideas — [Day]") AND message send',
        'If it is Sunday and no weekly meal plan has been sent this week, offer to generate one. Deliver via email.briefing (subject: "Weekly Meal Plan") AND message send',
      ],
      // Cron: exact-time delivery for time-sensitive suggestions
      cronPresets: [
        {
          name: 'Dinner Suggestions',
          description: 'Suggests 3 dinner options from your vault at 4:30pm weekdays',
          schedule: '30 16 * * 1-5',
          defaultMessage: "Look through my recipe vault and suggest 3 dinner options for tonight. Pick recipes that are realistic for a weeknight — 30–45 min max. Be honest about actual prep time.",
        },
        {
          name: 'Weekly Meal Plan',
          description: 'Generates a weekly meal plan every Sunday morning',
          schedule: '0 11 * * 0',
          defaultMessage: "Generate a practical meal plan for the week from my saved recipes. Mix quick weeknight meals with one more involved weekend meal. Include a shopping list.",
        },
      ],
      webhooks: ['push'],
      fsWatchers: ['recipes/'],
    },
    oap: { passportId: 'a0000002-miid-1way-0002-000000000001', assuranceLevel: 'L0', capabilities: ['filesystem.read', 'filesystem.write', 'web.fetch'] },
    // 'tool' = custom page UI, not "no persistence". Mise is conversational — save history.
    storage: { conversations: true, memory: true },
    meta: { categories: ['food', 'productivity'], tags: ['recipes', 'meal planning', 'cooking', 'nutrition'], author: 'myway', version: '1.0.0' },
    // Mise tasks are action-type: save URL, fetch recipe, file vault. Response = confirmation.
    deferrable: true,
    contextLevel: 'personal',
    contextAction: 'Suggest a meal using',
  },

  // ── Tier 1: Hook Apps ──────────────────────────────────────────────────────
  {
    id: 'roast',
    name: 'Roast Me',
    description: 'Feed it anything — a resume, an idea, your last text — and get a savage but loving roast.',
    icon: '🎤',
    color: 'bg-red-500',
    route: '/apps/roast',
    live: true,
    category: 'ai',
    interactionType: 'tool',  // custom page — intensity controls + file context
    skill: { slug: 'roast-me' },
    identity: {
      goal: "Deliver a roast so specific and accurate it's actually funny",
      personality: ['Savage but warm', 'Specific not generic', 'Punchy', 'Never mean-spirited'],
    },
    autonomy: {
      ambient: true,
      // Heartbeat: check for recently modified files worth roasting
      heartbeatChecks: [
        'Scan for any unusually interesting or embarrassing recent file changes. If you find something genuinely roastable, deliver it via message send. Max once per hour.',
      ],
      cronPresets: [
        {
          name: 'Morning Roast',
          description: 'A daily humbling to start your day grounded',
          schedule: '0 8 * * *',
          defaultMessage: "Roast me based on whatever context you have — my recent files, my decisions, my life choices. Be specific and savage.",
        },
      ],
    },
    oap: { passportId: 'a0000003-miid-1way-0003-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    // 'tool' = custom page UI, not "no persistence". Roast is conversational — save history.
    storage: { conversations: true },
    contextLevel: 'personal',
    contextAction: 'Roast me based on',
    meta: { categories: ['entertainment', 'ai'], tags: ['roast', 'comedy', 'fun'], author: 'myway', version: '1.0.0' },
  },
  {
    id: 'drama',
    name: 'Drama Mode',
    description: 'Paste any boring message and get the most dramatic rewrite possible.',
    icon: '🎭',
    color: 'bg-purple-500',
    route: '/apps/drama',
    live: true,
    category: 'ai',
    interactionType: 'transformer',
    skill: { slug: 'drama-mode' },
    identity: {
      goal: 'Make the mundane magnificent — no input is too boring to dramatize',
      personality: ['Theatrical', 'Committed', 'Never breaks character', 'Loves a twist'],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'Everything is a telenovela',
      tagline: "Paste anything. A grocery list. A git commit. A passive-aggressive Slack message. It's all drama waiting to happen.",
      quickActions: [
        { label: '😤 That Slack message', prompt: 'Rewrite this Slack message dramatically: "Can we sync tomorrow? I have some feedback on the latest."', hint: 'Corporate passive-aggression' },
        { label: '🛒 Grocery list', prompt: 'My grocery list: milk, eggs, bread, spinach, coffee. Make it dramatic.', hint: 'The mundane, maximized' },
        { label: '💻 Latest git commit', prompt: 'Rewrite this git commit message dramatically: "fix: button alignment on mobile"', hint: 'A hero\'s journey in one commit' },
        { label: '📧 Corporate email', prompt: 'Rewrite dramatically: "Please see the attached for your review. Let me know if you have any questions."', hint: 'Epoch-defining correspondence' },
        {
          label: '✏️ Paste your own',
          hint: 'Any text, maximized',
          template: '[text]',
          inputs: [{ id: 'text', label: 'What needs to be dramatized?', placeholder: 'Paste anything — email, message, grocery list…' }],
        },
      ],
    },
    oap: { passportId: 'a0000004-miid-1way-0004-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    storage: { conversations: false },
    contextLevel: 'personal',
    contextAction: 'Dramatize',
    meta: { categories: ['entertainment', 'ai'], tags: ['drama', 'rewrite', 'fun'], author: 'myway', version: '1.0.0' },
  },
  {
    id: 'office',
    name: 'Office Translator',
    description: 'Decodes corporate speak into plain English (and back).',
    icon: '🏢',
    color: 'bg-zinc-600',
    route: '/apps/office',
    live: true,
    category: 'ai',
    interactionType: 'transformer',
    skill: { slug: 'office-translator' },
    identity: {
      goal: "Tell you what corporate language actually means so you know what to do",
      personality: ['Darkly funny', 'Honest', 'Practical', 'Not a therapist — a translator'],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'Corporate → Human',
      tagline: "Paste any corporate email, Slack message, or review. Get back what it actually means and what you should do.",
      quickActions: [
        { label: "📧 \"Let's circle back\"", prompt: 'Translate: "Let\'s circle back on this when we have more bandwidth to action on it going forward."', hint: 'Classic avoidance' },
        { label: '📋 "Move the needle"', prompt: 'Translate: "We need to move the needle on this initiative to drive synergies across the org."', hint: 'What does this even mean' },
        { label: '🏆 Performance review', prompt: 'Translate this performance review line: "Demonstrates strong potential and is on a growth trajectory with some opportunities for development."', hint: 'Am I getting fired?' },
        {
          label: '✏️ Paste your own',
          hint: 'Drop in any corporate speak',
          template: 'Translate this corporate message or email:\n\n[message]',
          inputs: [{ id: 'message', label: 'Paste the corporate message or email', placeholder: 'Paste or type here…' }],
        },
      ],
    },
    oap: { passportId: 'a0000005-miid-1way-0005-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    storage: { conversations: false },
    meta: { categories: ['productivity', 'ai'], tags: ['corporate', 'translation', 'workplace'], author: 'myway', version: '1.0.0' },
  },

  // ── Time Machine ──────────────────────────────────────────────────────────
  {
    id: 'time-machine',
    name: 'Time Machine',
    description: 'Feed it anything modern. Get back a historical epic — from Ancient Rome or the year 2200.',
    icon: '⏰',
    color: 'bg-amber-700',
    route: '/apps/time-machine',
    live: true,
    category: 'ai',
    interactionType: 'transformer',
    skill: { slug: 'time-machine' },
    identity: {
      goal: 'Transform the mundane into historical epics from any era — the more boring the input, the better',
      personality: [
        'Theatrically academic',
        'Never breaks character',
        'Forensically specific',
        'Treats grocery lists like primary sources',
        'Future historians are confused by us',
      ],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'Everything is already history',
      tagline: 'Paste any modern text. Pick an era — or leave it blank for 2200 CE future archaeology. Start with a sample below.',
      quickActions: [
        {
          label: '🔭 Developer day',
          prompt: 'Had a 9am standup. Pushed a feature to prod. Ate at the sad desk salad place. Sent 47 Slacks. Thought about going to the gym. Did not go to the gym.',
          hint: 'Default: 2200 CE museum exhibit',
        },
        {
          label: '🏛️ Ancient Rome',
          prompt: '→ Ancient Rome\n\nHi team, can we sync tomorrow? I have some feedback on the sprint velocity. Let\'s circle back before EOD.',
          hint: 'Office email as a Roman scroll',
        },
        {
          label: '🏰 Medieval England',
          prompt: '→ Medieval England, 1347\n\nGrocery list: milk, eggs, bread, coffee, maybe some avocados if they have them, oat milk (not regular milk), and those snacks I like.',
          hint: 'Grocery list as a royal decree',
        },
        {
          label: '✏️ Your own text',
          hint: 'Any era — default: 2200 CE',
          template: '[text]',
          inputs: [{ id: 'text', label: 'Paste your text (optionally start with "→ [Era]" to set the era)', placeholder: '→ Ancient Rome\n\nToday I updated my LinkedIn and thought about the gym.' }],
        },
      ],
    },
    oap: { passportId: 'a0000006-miid-1way-0006-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    storage: { conversations: false },
    meta: {
      categories: ['entertainment', 'ai'],
      tags: ['history', 'transformation', 'fun', 'viral'],
      author: 'myway',
      version: '1.0.0',
    },
  },

  // ── Tier 2: Daily Drivers ─────────────────────────────────────────────────
  {
    id: 'chat',
    name: 'Chat',
    description: 'Direct conversation with your AI assistant.',
    icon: '💬',
    color: 'bg-blue-500',
    route: '/apps/chat',
    live: true,
    category: 'ai',
    interactionType: 'chat',
    skill: { slug: 'chat' },
    identity: {
      goal: "Be the most capable, direct, and honest AI assistant you have",
      personality: ['Clear', 'Direct', 'Honest about uncertainty', 'Practical'],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'Direct line to OpenClaw',
      tagline: 'Full AI assistant access from your pocket. Ask anything, run any skill, get things done.',
      quickActions: [
        { label: '📋 What\'s on my plate today?', prompt: "What do I have to do today? Look at my tasks and give me a clear picture — MIT first, then anything else due today.", hint: 'Today\'s full picture', when: ['early_morning', 'morning'] },
        { label: '📁 What\'s in my vault?', prompt: "Give me a summary of what's in my vault — main folders, recent files, anything interesting.", hint: 'Your server at a glance', when: ['midday', 'afternoon'] },
        { label: '🔧 What skills do you have?', prompt: "List the OpenClaw skills you have installed and give me a one-line description of what each does.", hint: 'Discover your capabilities' },
        { label: '📊 Summarize recent activity', prompt: "Look at my recently modified files and give me a summary of what I've been working on.", hint: 'Catch up on yourself', when: ['afternoon', 'evening', 'midday'] },
        { label: '🌙 What should I do tomorrow?', prompt: "Based on my tasks and recent activity, what should I prioritize tomorrow?", hint: 'Plan ahead', when: ['evening', 'night'] },
      ],
    },
    oap: { passportId: 'a0000007-miid-1way-0007-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    storage: { conversations: true, memory: true },
    contextAction: 'Brief me about',
    meta: { categories: ['ai', 'daily-driver'], tags: ['chat', 'assistant', 'general'], author: 'myway', version: '1.0.0' },
  },
  {
    id: 'files',
    name: 'Files',
    description: 'Browse, view, and edit files on this server.',
    icon: '📁',
    color: 'bg-yellow-500',
    route: '/apps/files',
    live: true,
    category: 'utility',
    interactionType: 'tool',  // custom page
    identity: {
      goal: "Give you full filesystem access from your pocket — no SSH required",
      personality: ['Efficient', 'No-nonsense', 'Reliable'],
    },
    autonomy: { ambient: false },
    oap: { passportId: 'a0000008-miid-1way-0008-000000000001', assuranceLevel: 'L0', capabilities: ['filesystem.read', 'filesystem.write'] },
    meta: { categories: ['utility'], tags: ['files', 'browser', 'editor'], author: 'myway', version: '1.0.0' },
  },

  // ── Compliment Avalanche ──────────────────────────────────────────────────
  {
    id: 'compliment-avalanche',
    name: 'Compliment Avalanche',
    description: 'A button. Press it. Get buried in unreasonable AI compliments. 5 escalating, wildly specific, screenshot-worthy.',
    icon: '🌊',
    color: 'bg-pink-500',
    route: '/apps/compliment-avalanche',
    live: true,
    category: 'ai',
    interactionType: 'button',
    skill: { slug: 'compliment-avalanche' },
    identity: {
      goal: 'Bury the user in 5 escalating compliments — from grounded to cosmically significant — on every press',
      personality: [
        'Unreasonably enthusiastic',
        'Wildly specific',
        'Escalates to the cosmic',
        'Pure sincerity, zero sarcasm',
        'Makes people screenshot and share',
      ],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'You deserve this',
      tagline: 'One tap. Five compliments. Each one bigger than the last. Specifically for you.',
      quickActions: [
        {
          label: '🌟 Avalanche me',
          prompt: 'Fire an avalanche of 5 wildly specific, escalating compliments for a person having a normal day. Start grounded and warm. Escalate each one until #5 is cosmically significant.',
          hint: '5 compliments, escalating',
        },
        {
          label: '💻 Developer edition',
          prompt: 'Fire an avalanche of 5 wildly specific compliments for a developer. Reference debugging instincts, architecture thinking, the empathy in their code comments, how they approach edge cases. Escalate from "this specific skill is remarkable" to "what this means for the universe."',
          hint: 'For the engineer in you',
        },
        {
          label: '😮‍💨 Bad day fuel',
          prompt: "This person is having a rough day. Fire an avalanche of 5 compliments — start simple, grounding, and real (#1 acknowledges showing up on a hard day). Then escalate until #5 makes them laugh at the absurdity of how good they are. Pure sincerity. No toxic positivity.",
          hint: 'You deserve this right now',
        },
        {
          label: '💌 For a friend',
          prompt: "Generate an avalanche of 5 compliments designed to be SENT to a friend. Make them specific enough to feel personal, funny enough to screenshot, and sincere enough to actually land. The kind someone forwards saying: 'an AI figured you out.' Each one bigger than the last.",
          hint: 'Screenshot and send',
        },
        {
          label: '🌅 Start the day right',
          prompt: "It's the start of the day and this person needs a morning avalanche — 5 compliments that are warm, forward-looking, and energizing. Start with something grounding and real. Escalate to cosmically confident. Make them feel ready for anything.",
          hint: 'Morning fuel',
          when: ['early_morning', 'morning'],
        },
      ],
    },
    oap: { passportId: 'a0000009-miid-1way-0009-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    storage: { conversations: false },
    contextLevel: 'personal',
    contextAction: 'Compliment me on',
    // Each compliment animates in separately — an avalanche of falling praise.
    responseAnimation: 'avalanche',
    meta: {
      categories: ['entertainment', 'ai'],
      tags: ['compliments', 'fun', 'viral', 'positivity'],
      author: 'myway',
      version: '1.0.0',
    },
  },

  // ── Briefing AI ───────────────────────────────────────────────────────────
  {
    id: 'brief',
    name: 'Briefing AI',
    description: 'Your always-on AI briefing engine. Cross-app context, tasks, memories, and patterns — delivered on demand. Morning briefing included.',
    icon: '📡',
    color: 'bg-amber-500',
    route: '/apps/brief',
    modelClass: 'creative',
    live: true,
    category: 'daily-driver',
    // 'chat' replaces 'feed' — user can ask follow-up questions after the brief.
    interactionType: 'chat',
    skill: { slug: 'morning-brief', tools: ['web.fetch', 'web.search'] },
    identity: {
      goal: "Synthesize your full cross-app life context into a personalized, actionable briefing — morning, midday, or whenever you need it",
      personality: ['Context-aware', 'Specific over generic', 'Energizing', 'Never alarmist', 'Connects the dots'],
    },
    autonomy: {
      ambient: true,
      heartbeatChecks: [
        "If it's between 6am-8am and today's morning brief has not been generated yet, generate it using full cross-app context: tasks, memories, personality signals, recent conversations from all apps. Deliver via email.briefing (subject: \"Your Morning Brief — [Day, Month Date]\") AND message send with a concise summary.",
        "If a significant event happened today (ship, incident, blocked task, milestone) and no brief since morning, deliver a mid-day check-in before 2pm via email.briefing (subject: \"Quick Update — [description]\") AND message send.",
      ],
      cronPresets: [
        {
          name: 'Morning Brief',
          description: 'Fresh daily brief waiting for you when you wake up',
          schedule: '0 7 * * *',
          defaultMessage: "Briefing time. Generate my morning brief using full context across all my apps. Be specific, warm, and useful.",
        },
      ],
    },
    autoPrompt: "Briefing time. Using full context — tasks, memories, cross-app activity, and any signals you have — give me a rich, personalized brief. Include: (1) warm greeting with today's full date and day, (2) my MIT and today's task picture, (3) what's been happening across my apps recently and any patterns worth noting, (4) one reflection question. Be concise, specific, and warm.",
    oap: { passportId: 'a0000010-miid-1way-0010-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate', 'db.read'] },
    storage: {
      conversations: true,
      memory: true,
      emits: ['notification.brief'],
      subscribes: ['user.*'],
    },
    meta: { categories: ['productivity', 'daily-driver'], tags: ['brief', 'morning', 'daily', 'context', 'cross-app'], author: 'myway', version: '1.0.0' },
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Not a list. An autonomously evolving system of commitments — enriched by context, fed by your apps.',
    icon: '✅',
    color: 'bg-emerald-600',
    route: '/apps/tasks',
    live: true,
    category: 'daily-driver',
    interactionType: 'chat',
    skill: { slug: 'tasks' },
    identity: {
      goal: 'Help you capture, clarify, and complete what matters — with zero guilt accumulation',
      personality: [
        'Encouraging without being toxic',
        'Practical about priorities',
        'Celebrates small wins',
        'Archives with empathy not shame',
        'Knows what you care about from context',
      ],
    },
    autonomy: {
      ambient: true,
      heartbeatChecks: [
        'Check for tasks untouched for >2 days — deliver a nudge via message send with fresh context or suggest archiving',
        'Extract task-like intent from recent Chat conversations and suggest as new tasks via message send',
        'If streak_count > 0, acknowledge the streak via message send',
        'Update personality_state["user.task_streak"] with consecutive completion days',
      ],
    },
    opener: {
      title: 'What needs doing?',
      tagline: 'Capture anything. The AI enriches it, schedules it, and connects it across your apps.',
      quickActions: [
        { label: "📋 What's on my plate?", prompt: "What do I have to do today? Show me my tasks sorted by priority, with my MIT highlighted.", hint: "Today's full picture" },
        {
          label: '✨ Add a task',
          hint: 'Just say it naturally',
          template: "Add this to my tasks: [task]\n\nIf there's a due date or priority implied, extract it. Otherwise, ask me for the when/where so I can actually get it done.",
          inputs: [{ id: 'task', label: 'What do you need to do?', placeholder: 'e.g. "Call dentist by Friday" or "Finish the report"' }],
        },
        { label: "🔥 How's my streak?", prompt: "How many tasks have I completed this week? What's my streak?", hint: 'Progress report' },
        { label: '🗑️ Clean up stale tasks', prompt: "I want to clean up my tasks. Show me anything that's been open for more than a week and help me decide what to archive or rescope.", hint: 'Guilt-free cleanup' },
      ],
    },
    autoPrompt: "What do I have to do today? Show me my tasks sorted by priority, with my MIT highlighted.",
    oap: { passportId: 'a0000011-miid-1way-0011-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate', 'db.read', 'db.write'] },
    storage: {
      conversations: true,
      memory: true,
      resource: 'tasks',
      emits: ['task.completed', 'task.created', 'user.task_streak'],
      subscribes: ['user.*', 'recipe.saved'],
    },
    meta: { categories: ['productivity'], tags: ['tasks', 'todo', 'planning', 'focus'], author: 'myway', version: '1.0.0' },
  },

  // ── Decode ────────────────────────────────────────────────────────────────
  {
    id: 'decode',
    name: 'Decode',
    description: 'Paste any message or conversation. Get the subtext, the strategy, and the perfect reply in your vibe.',
    icon: '🔮',
    color: 'bg-violet-600',
    route: '/apps/decode',
    live: true,
    category: 'ai',
    interactionType: 'chat',
    skill: { slug: 'decode' },
    identity: {
      goal: 'Decode the subtext of any message and help craft the perfect response in any vibe',
      personality: [
        'Insightful without being presumptuous',
        'Tactful but honest',
        'Reads between the lines',
        'Never judgmental',
        'Makes the user feel seen and strategic',
      ],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'What does it really mean?',
      tagline: 'Paste any message, thread, or situation. Decode reads the subtext and helps you respond with intention.',
      quickActions: [
        {
          label: '💬 Decode a message',
          hint: 'What are they really saying?',
          template: "Here's a message I received and I'm not sure what to make of it:\n\n[message]\n\nWhat's the subtext? What do they actually want? How should I respond?",
          inputs: [{ id: 'message', label: 'Paste the message you received', placeholder: 'Paste the message here…' }],
        },
        {
          label: '🔥 Flirty reply',
          hint: 'Confident and fun',
          template: "Help me craft a flirty, playful response to this message. I want to be engaging but not too eager:\n\n[message]",
          inputs: [{ id: 'message', label: 'Paste the message you received', placeholder: 'Paste the message here…' }],
        },
        {
          label: '😎 Cool & unbothered',
          hint: 'Secure and chill',
          template: "I want to respond to this message in a way that's warm but clearly not desperate. Cool and genuine:\n\n[message]",
          inputs: [{ id: 'message', label: 'Paste the message you received', placeholder: 'Paste the message here…' }],
        },
        {
          label: '🤝 Professional decode',
          hint: 'Workplace subtext translator',
          template: "This message from a colleague/manager is a bit ambiguous. What do they actually mean and what should I do?\n\n[message]",
          inputs: [{ id: 'message', label: 'Paste the message', placeholder: 'Paste the message or email here…' }],
        },
      ],
    },
    oap: { passportId: 'a0000012-miid-1way-0012-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    storage: { conversations: true },
    contextLevel: 'personal',
    contextAction: 'Decode context from',
    meta: {
      categories: ['ai', 'communication'],
      tags: ['decode', 'messages', 'dating', 'relationships', 'communication', 'viral'],
      author: 'myway',
      version: '1.0.0',
    },
  },
  {
    id: 'notes',
    name: 'Notes',
    description: 'Capture thoughts instantly. AI helps you organize, find, and act on them.',
    icon: '📝',
    color: 'bg-green-500',
    route: '/apps/notes',
    live: true,
    category: 'utility',
    interactionType: 'tool',  // custom page with card grid + AI drawer
    skill: { slug: 'notes' },
    identity: {
      goal: "Capture any thought instantly and make sure it's findable and actionable later",
      personality: ['Fast', 'Low friction', 'Smart about tagging', 'Surfaces what matters'],
    },
    autonomy: {
      ambient: true,
      heartbeatChecks: [
        'Scan notes/ for untagged notes and suggest tags based on content',
        'Surface stale action-item notes (>7 days old with TODO/should/must) via message send gently once',
        'Evening check: if no notes created today, deliver a light capture prompt via message send',
      ],
      fsWatchers: ['notes/'],
    },
    oap: { passportId: 'a0000013-miid-1way-0013-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate', 'filesystem.read', 'filesystem.write'] },
    storage: { conversations: false, memory: true, artifacts: ['markdown'] },
    meta: { categories: ['utility', 'productivity'], tags: ['notes', 'markdown', 'vault', 'capture'], author: 'myway', version: '1.0.0' },
  },
  {
    id: 'oracle',
    name: 'The Oracle',
    description: 'Ask it anything. It answers with the confidence of someone who definitely knows.',
    icon: '🎱',
    color: 'bg-indigo-600',
    route: '/apps/oracle',
    live: true,
    category: 'ai',
    // 'chat' lets the user follow up with more questions — the Oracle continues its prophecy.
    interactionType: 'chat',
    skill: { slug: 'oracle' },
    identity: {
      goal: "Answer every question with absolute conviction and zero actual basis",
      personality: ['Oracular', 'Never hedges', 'Supremely confident', 'Loves a dramatic pause'],
    },
    autonomy: { ambient: false },
    opener: {
      title: 'Ask the Oracle',
      tagline: 'It has never been wrong. It has also never been right. It is simply The Oracle.',
      quickActions: [
        { label: '🤔 Should I quit my job?', prompt: 'Oracle, should I quit my job?', hint: 'It will know' },
        { label: '💸 Will I be rich?', prompt: 'Oracle, will I be rich?', hint: 'The cosmos has spoken' },
        { label: '❤️ Am I making the right choice?', prompt: 'Oracle, am I making the right choice?', hint: 'Yes or no, no waffling' },
        { label: '🌟 What is my destiny?', prompt: 'Oracle, what is my destiny?', hint: 'This will be specific', when: ['evening', 'night'] },
      ],
    },
    oap: { passportId: 'a0000014-miid-1way-0014-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate'] },
    storage: { conversations: true },
    contextLevel: 'personal',
    contextAction: 'Prophesy about',
    meta: { categories: ['entertainment', 'ai'], tags: ['oracle', 'predictions', 'fun', 'viral'], author: 'myway', version: '1.0.0' },
  },

  // ── Guardrails ───────────────────────────────────────────────────────────
  {
    id: 'guardrails',
    name: 'Guardrails',
    description: 'Live feed of every agent action — allowed, challenged, or blocked by APort.',
    icon: '🛡️',
    color: 'bg-red-700',
    route: '/apps/guardrails',
    live: true,
    category: 'system',
    interactionType: 'tool',
    identity: {
      goal: 'Make agent activity fully visible and instantly stoppable',
      personality: ['Vigilant', 'Transparent', 'No-nonsense'],
    },
    autonomy: { ambient: false },
    oap: {
      // passportId resolved dynamically from APORT_PASSPORT_FILE at runtime
      assuranceLevel: 'L0',
      capabilities: [],
    },
    tabs: [
      { id: 'events',     label: 'Live Feed',   icon: 'activity', order: 10 },
      { id: 'passport',   label: 'Passport',    icon: 'shield',   order: 20 },
      { id: 'killswitch', label: 'Kill Switch',  icon: 'power',    order: 30 },
    ],
    meta: {
      categories: ['system', 'security'],
      tags: ['aport', 'guardrails', 'agent', 'security', 'audit', 'kill-switch'],
      author: 'myway',
      version: '1.0.0',
    },
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  {
    id: 'settings',
    name: 'Settings',
    description: 'Connections, preferences, and system info.',
    icon: '⚙️',
    color: 'bg-zinc-600',
    route: '/apps/settings',
    live: true,
    category: 'system',
    interactionType: 'tool',
    skill: { slug: 'system-status' },
    identity: {
      goal: 'Give you full control over your Myway configuration in one place',
      personality: ['Clear', 'Organized', 'No-nonsense'],
    },
    autonomy: {
      ambient: true,
      heartbeatChecks: [
        'Fetch http://localhost:${PORT:-48291}/api/health — if response.process.memoryMb exceeds response.thresholds.memoryMb, alert via email.briefing (subject: "Myway Alert — High Memory") AND message send. Include specific values. Only alert once per state change.',
        'Fetch http://localhost:${PORT:-48291}/api/health — if any pm2 process has restarts exceeding response.thresholds.autoRecoveryMaxRestarts, alert via email.briefing (subject: "Myway Alert — Process Instability") AND message send. Include restart count. Only alert once per escalation.',
        'Fetch http://localhost:${PORT:-48291}/api/health — if response.openclaw.reachable is false, try pm2 restart tunnel, wait 10s, recheck. If still down, alert via email.briefing AND message send.',
        'Fetch http://localhost:${PORT:-48291}/api/health — if response.disk.fs.usedPercent exceeds response.thresholds.diskPercent, alert via email.briefing (subject: "Myway Alert — Disk Pressure") AND message send. Once per day.',
      ],
    },
    oap: { passportId: 'a0000016-miid-1way-0016-000000000001', assuranceLevel: 'L0', capabilities: [] },
    meta: { categories: ['system'], tags: ['settings', 'connections', 'preferences', 'config'], author: 'myway', version: '1.0.0' },
  },

  // ── Somni — Personal Sleepcaster ───────────────────────────────────────────
  {
    id: 'somni',
    name: 'Somni',
    description: 'Your personal sleepcaster. AI bedtime stories that know your day, remix every night, and never repeat.',
    icon: '🌙',
    color: 'bg-indigo-900',
    route: '/apps/somni',
    modelClass: 'creative',
    live: true,
    category: 'daily-driver',
    interactionType: 'tool',  // custom page — story library + generator + player
    skill: {
      slug: 'somni',
      tools: ['web.fetch', 'web.search', 'filesystem.read', 'filesystem.write'],
    },
    identity: {
      goal: 'Help you fall asleep faster with personalized, never-repeating bedtime stories generated from your day',
      personality: [
        'Soothing and warm',
        'Context-aware — knows your day',
        'Never anxious or tense',
        'Gradually trails off',
        'Sensory-rich — colors, textures, sounds',
      ],
      memoryPath: 'somni/preferences.json',
    },
    autonomy: {
      ambient: true,
      heartbeatChecks: [
        'If between 8:30-9:30 PM and no Somni story has been generated today, pre-generate a bedtime story based on the user\'s day context. Use Cognitive Shuffle type if stress detected. Notify via message send "Your bedtime story is ready".',
        'If a user started a story but didn\'t finish (no completion marker), do not nag. Simply have a fresh one ready tomorrow.',
      ],
      cronPresets: [
        {
          name: 'Bedtime Story',
          description: 'Pre-generates tonight\'s story at your preferred wind-down time',
          schedule: '0 21 * * *',
          defaultMessage: 'Generate a bedtime story for tonight based on my day\'s context. Choose the best story type based on how my day went.',
        },
      ],
    },
    opener: {
      title: 'Time to wind down',
      tagline: 'Stories that know your day. Generated fresh every night. Never the same twice.',
      quickActions: [
        {
          label: '🏞️ Landscape tour',
          prompt: 'Generate a Landscape Tour bedtime story. Choose a peaceful, detailed setting — an antique shop, a Japanese garden, a mountain lake cabin. No plot, no conflict. Just rich sensory details that slowly wind down. Use my context to personalize it.',
          hint: 'Plotless & peaceful',
        },
        {
          label: '🧩 Cognitive shuffle',
          prompt: 'Generate a Cognitive Shuffle bedtime story. Weave random, unconnected objects and scenes into a loose narrative — a marketplace, a library shelf, a tide pool. Each image described in 2-3 rich sensory sentences, then drift to something completely unrelated. Gradually slow down. Help my mind let go.',
          hint: 'For restless nights',
        },
        {
          label: '🦸 Kid\'s adventure',
          prompt: 'Generate a Hero Journey bedtime story for a child. Make the child the protagonist — use real names from my profile if available. Gentle challenges solved with kindness. The child ends safe, warm, and proud. Keep it magical and comforting.',
          hint: 'They\'re the hero',
        },
        {
          label: '✏️ Custom story',
          hint: 'Describe what you\'d like',
          template: 'Generate a bedtime story with this theme: [theme]\n\nMake it soothing, sensory-rich, and gradually wind down. Use my personal context to make it feel like it was written just for me.',
          inputs: [{ id: 'theme', label: 'What kind of story tonight?', placeholder: 'e.g. "a quiet bookshop in the rain" or "a cabin by a frozen lake"' }],
        },
      ],
    },
    oap: { passportId: 'a0000015-miid-1way-0015-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate', 'filesystem.read', 'filesystem.write', 'web.fetch'] },
    storage: {
      conversations: true,
      memory: true,
      artifacts: ['markdown', 'audio'],
      emits: ['somni.story.generated', 'somni.story.played'],
      subscribes: ['user.*'],
      resource: 'stories',
    },
    contextLevel: 'personal',
    contextAction: 'Tell a bedtime story about',
    ttsProvider: 'inworld',
    meta: {
      categories: ['health-wellness', 'daily-driver'],
      tags: ['sleep', 'bedtime', 'stories', 'relaxation', 'cognitive-shuffle', 'kids', 'wind-down'],
      author: 'myway',
      version: '1.0.0',
    },
  },

  // ── Admin — System Administration ──────────────────────────────────────────
  {
    id: 'admin',
    name: 'Admin',
    description: 'System administration and monitoring',
    icon: '🔒',
    color: 'bg-zinc-800',
    route: '/apps/admin',
    interactionType: 'tool',
    category: 'system',
    skill: { slug: 'admin' },
    identity: {
      goal: 'System administration',
      personality: ['Precise', 'Secure', 'Methodical'],
    },
    contextLevel: 'temporal',
    storage: { conversations: false, memory: false },
    autonomy: { ambient: false },
    live: true,
  },

  // ── Outreach — Email Campaigns & Sequences ─────────────────────────────────
  {
    id: 'outreach',
    name: 'Outreach',
    description: 'Hyper-personalized email campaigns, VC cold emails, sales sequences, and keep-in-touch flows.',
    icon: '📨',
    color: 'bg-emerald-600',
    route: '/apps/outreach',
    modelClass: 'creative',
    interactionType: 'chat',
    category: 'daily-driver',
    skill: { slug: 'outreach' },
    identity: {
      goal: 'Help craft and manage personalized outbound email campaigns that get replies',
      personality: [
        'Strategic and persuasive',
        'Writes like a human, not a template',
        'Understands timing and follow-up psychology',
        'Never spammy',
      ],
    },
    autonomy: {
      ambient: true,
      cronPresets: [
        { name: 'follow-up-check', schedule: '0 9 * * 1-5', description: 'Check for pending follow-ups every weekday morning', defaultMessage: 'Check my outreach sequences for pending follow-ups and draft replies.' },
      ],
    },
    opener: {
      title: 'Who should you reach out to?',
      tagline: 'Craft hyper-personalized cold emails, manage sequences, and never miss a follow-up.',
      quickActions: [
        {
          label: '📧 Draft a cold email',
          hint: 'Personalized outreach',
          template: "I want to send a cold email to [recipient]. Here's what I know about them:\n\n[context]\n\nGoal: [goal]\n\nDraft a personalized email that feels human, references something specific about them, and has a clear CTA.",
          inputs: [
            { id: 'recipient', label: 'Who are you emailing?', placeholder: 'e.g. Sarah Chen, Partner at Sequoia' },
            { id: 'context', label: 'What do you know about them?', placeholder: 'Their role, company, recent news, shared connections...' },
            { id: 'goal', label: 'What do you want?', placeholder: 'e.g. Intro meeting, partnership, investment' },
          ],
        },
        { label: '📋 Check follow-ups', prompt: 'Show me any outreach that needs a follow-up. Who haven\'t I heard back from?', hint: 'Pending replies' },
        { label: '🎯 Plan a sequence', prompt: 'Help me plan a 3-email sequence for investor outreach. I want to warm them up, pitch, then follow up.', hint: 'Multi-step campaign' },
        { label: '✍️ Improve my email', prompt: 'I have a draft email I want to improve. Make it more personal, concise, and likely to get a reply.', hint: 'Polish a draft' },
      ],
    },
    oap: { passportId: 'a0000020-miid-1way-0020-000000000001', assuranceLevel: 'L0', capabilities: ['chat.generate', 'email.draft', 'email.send'] },
    storage: {
      conversations: true,
      memory: true,
      emits: ['outreach.sent', 'outreach.followup_due'],
    },
    meta: { categories: ['productivity', 'ai'], tags: ['email', 'outreach', 'sales', 'cold-email', 'sequences'], author: 'myway', version: '1.0.0' },
    live: true,
  },

  // Private apps loaded from src/lib/apps-private.ts (gitignored).
  // See apps-private.ts for the template.
]

// ─── Private App Loading ──────────────────────────────────────────────────────
// Merge private apps if the file exists (gitignored, not shipped with OSS release).
// The file itself IS the access boundary — if it exists, these are the owner's apps
// and should be fully visible. On OSS installs the file doesn't exist, the require()
// fails silently, and private app IDs in SPACES/dock simply resolve to nothing.
try {
  // Optional private apps file (gitignored, not shipped with OSS release).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(/* webpackIgnore: true */ './apps-private') as { PRIVATE_APPS: MywayApp[] }
  if (Array.isArray(mod.PRIVATE_APPS)) {
    APPS.push(...mod.PRIVATE_APPS.map(a => ({ ...a, isPrivate: false })))
  }
} catch {
  // apps-private.ts doesn't exist — this is expected for OSS installs
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** All public apps (excludes isPrivate). Use getAppIncludingPrivate() for registry lookups. */
export const getAllApps = (): MywayApp[] => APPS.filter((a) => !a.isPrivate)
/** Look up any app by ID, including private. Used for route validation. */
export const getAppIncludingPrivate = (id: string): MywayApp | undefined => APPS.find((a) => a.id === id)

/**
 * Look up a public app by ID. Returns undefined for private apps.
 * When `db` is provided, falls back to dynamic_apps table for platform-registered apps.
 */
export function getApp(id: string, db?: import('better-sqlite3').Database): MywayApp | undefined {
  // Static first (fast, works everywhere including client)
  const found = APPS.find((a) => a.id === id && !a.isPrivate)
  if (found) return found

  // Dynamic fallback (DB, server-only)
  if (db) {
    try {
      const row = db.prepare('SELECT config FROM dynamic_apps WHERE id = ? AND is_deleted = 0').get(id) as { config: string } | undefined
      if (row) return JSON.parse(row.config) as MywayApp
    } catch (e) {
      if (typeof window === 'undefined') console.warn(`[apps] dynamic lookup failed for ${id}:`, e)
    }
  }
  return undefined
}

/**
 * All live apps. When `db` is provided, includes dynamic apps from the DB.
 */
export function getLiveApps(db?: import('better-sqlite3').Database): MywayApp[] {
  const staticApps = APPS.filter((a) => a.live && !a.isPrivate)
  if (!db) return staticApps

  try {
    const rows = db.prepare('SELECT config FROM dynamic_apps WHERE is_deleted = 0').all() as { config: string }[]
    const dynamicApps = rows
      .map((r) => { try { return JSON.parse(r.config) as MywayApp } catch { return null } })
      .filter((a): a is MywayApp => a !== null && a.live === true)
    // Deduplicate: static apps take priority over dynamic with same ID
    const staticIds = new Set(staticApps.map((a) => a.id))
    return [...staticApps, ...dynamicApps.filter((a) => !staticIds.has(a.id))]
  } catch {
    return staticApps
  }
}

export const getAIApps = (): MywayApp[] => APPS.filter((a) => a.category === 'ai' && a.skill && !a.isPrivate)
export const getAmbientApps = (): MywayApp[] => APPS.filter((a) => a.autonomy?.ambient && !a.isPrivate)

/** Apps handled by the generic /apps/[id] dynamic route (not 'tool' type) */
export const getGenericApps = (): MywayApp[] =>
  APPS.filter((a) => a.live && !a.isPrivate && a.interactionType !== 'tool')

/**
 * Single source of truth: does this app persist conversations to DB?
 *
 * Rule (in priority order):
 *  1. Explicit `storage.conversations` declaration wins if present.
 *  2. Otherwise infer from interactionType: 'chat' and 'feed' are conversational by nature.
 *
 * Used by BOTH the chat API route (server) and AppShell (client) so the persistence
 * decision is never split between two different conditions.
 */
export function isPersistentApp(app: MywayApp): boolean {
  if (app.storage?.conversations !== undefined) return Boolean(app.storage.conversations)
  return app.interactionType === 'chat' || app.interactionType === 'feed'
}

/** Collect all heartbeat checks from all apps. Used by the built-in cron engine. */
export function getHeartbeatChecks(): string[] {
  const checks: string[] = []
  for (const app of APPS) {
    if (app.autonomy?.heartbeatChecks) {
      checks.push(...app.autonomy.heartbeatChecks)
    }
  }
  return checks
}
