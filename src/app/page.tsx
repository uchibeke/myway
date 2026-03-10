'use client'

/**
 * Myway Home Screen v2 — The Ambient AI Home
 *
 * Design philosophy (research-backed):
 *  1. Context over Catalog — show 1-3 proposals, not 14 icons (Paradox of Choice)
 *  2. Proposal Cards, Not App Icons — show what the app will DO for you now (Anticipatory Design)
 *  3. Strong Information Scent — contextual titles beat generic names (Information Foraging Theory)
 *  4. Progressive Disclosure — one clear action, pull for more (NNGroup)
 *  5. Time as Primary Axis — different content at 7am vs 10pm (Circadian patterns)
 *  6. Respect Attention — proactive surfacing YES, spam NO
 *
 * Five layers:
 *  L0: The Moment — atmospheric clock + live context line
 *  L1: The Flow — 2-3 rich proposal cards with live data
 *  L2: The Thread — activity pulse (horizontal recent cross-app activity)
 *  L3: The Spaces — apps grouped by intent, not alphabetically
 *  L4: The Dock — adaptive 4-app dock + bottom command bar
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAllApps, getLiveApps, getApp, type MywayApp } from '@/lib/apps'
import { useViewMode } from '@/lib/view-mode'
import { Search, ChevronRight, X, LogIn, Mic } from 'lucide-react'
import VoiceImmersive from '@/components/VoiceImmersive'
import OnboardingImmersive from '@/components/OnboardingImmersive'
import OnboardingGeminiLive from '@/components/OnboardingGeminiLive'
import SelfDemoImmersive from '@/components/SelfDemoImmersive'
import Skeleton from '@/components/Skeleton'
import {
  getProposals,
  getVisitorProposals,
  getContextLine,
  getVisitorContextLine,
  type Suggestion,
  type SetupStatus,
  type VisitorHints,
} from '@/lib/home-proposals'

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifData = {
  id: string
  appId: string
  title: string
  body: string
  type: string
  actionUrl: string | null
}

type HomeContext = {
  tasks: { totalOpen: number; dueToday: number; mit: string | null } | null
  activity: { appId: string; appIcon: string; text: string; ago: string; route: string; prompt?: string }[]
  userName: string | null
  notificationCount: number
  setup?: SetupStatus
  visitor?: boolean
  visitorHints?: VisitorHints
  onboardingCompleted?: boolean
  onboardingResume?: { step: 'name' | 'goal' | 'timezone'; name: string | null } | null
  contextCallback?: string
}

type Palette = {
  gradient: string
  accentClass: string
  thought: string
}

// ─── Time-aware ambience ──────────────────────────────────────────────────────

function getPalette(hour: number): Palette {
  if (hour >= 5 && hour < 8) return {
    gradient: 'radial-gradient(ellipse at 30% 50%, #2d0a5a 0%, #1a0535 50%, #050210 100%)',
    accentClass: 'text-violet-300',
    thought: 'Before the noise. Just you.',
  }
  if (hour >= 8 && hour < 12) return {
    gradient: 'radial-gradient(ellipse at 60% 35%, #0a3a28 0%, #051f16 50%, #020908 100%)',
    accentClass: 'text-emerald-300',
    thought: "The golden window. Whatever you start now, you'll finish.",
  }
  if (hour >= 12 && hour < 14) return {
    gradient: 'radial-gradient(ellipse at 50% 25%, #053560 0%, #021828 50%, #01070f 100%)',
    accentClass: 'text-sky-300',
    thought: 'High noon. The world at full brightness.',
  }
  if (hour >= 14 && hour < 17) return {
    gradient: 'radial-gradient(ellipse at 65% 55%, #3a0a22 0%, #200518 50%, #08020a 100%)',
    accentClass: 'text-pink-300',
    thought: 'The afternoon drift. Best ideas come when you stop forcing them.',
  }
  if (hour >= 17 && hour < 20) return {
    gradient: 'radial-gradient(ellipse at 40% 60%, #4a1a02 0%, #2a0d02 50%, #0a0401 100%)',
    accentClass: 'text-amber-300',
    thought: 'Golden hour. Everything looks better in this light.',
  }
  if (hour >= 20 && hour < 23) return {
    gradient: 'radial-gradient(ellipse at 50% 70%, #1a0535 0%, #0d021a 50%, #04010a 100%)',
    accentClass: 'text-indigo-300',
    thought: 'The day is writing its summary.',
  }
  return {
    gradient: 'radial-gradient(ellipse at 50% 50%, #150228 0%, #080115 60%, #020008 100%)',
    accentClass: 'text-purple-300',
    thought: 'The most honest hour. No audience.',
  }
}

// ─── App spaces (semantic grouping) ──────────────────────────────────────────

type Space = {
  name: string
  icon: string
  appIds: string[]
}

// Space order = selling order.
// 1. Agent Control first — Guardrails is the differentiator. Every demo starts here.
// 2. Daily Stack — the apps people open every day (retention drivers).
// 3. Build — power tools for shipping.
// 4. Play — delight + virality.
// 5. System — always last.
const SPACES: Space[] = [
  { name: 'Agent Control', icon: '🛡️', appIds: ['guardrails', 'settings'] },
  { name: 'Daily Stack',   icon: '🚀', appIds: ['tasks', 'brief', 'chat', 'somni', 'decode', 'notes'] },
  { name: 'Build',         icon: '⚒️', appIds: ['forge', 'files', 'mise', 'influence', 'hunter'] },
  { name: 'Play',          icon: '🎮', appIds: ['drama', 'roast', 'oracle', 'office', 'time-machine', 'compliment-avalanche'] },
]

// ─── Adaptive dock (time-aware) ──────────────────────────────────────────────

function getDockAppIds(hour: number): string[] {
  if (hour >= 5 && hour < 9) return ['brief', 'tasks', 'chat', 'mise']
  if (hour >= 9 && hour < 14) return ['chat', 'tasks', 'files', 'office']
  if (hour >= 14 && hour < 17) return ['chat', 'tasks', 'office', 'mise']
  if (hour >= 17 && hour < 21) return ['mise', 'chat', 'oracle', 'somni']
  return ['somni', 'oracle', 'chat', 'notes'] // 9pm-5am
}

// ─── Fuzzy search ─────────────────────────────────────────────────────────────

function fuzzyMatch(q: string, app: MywayApp): boolean {
  const lq = q.toLowerCase()
  return (
    app.name.toLowerCase().includes(lq) ||
    app.description.toLowerCase().includes(lq) ||
    app.id.toLowerCase().includes(lq)
  )
}

// ─── Notification banner ──────────────────────────────────────────────────────

function NotificationBanner({ notifs }: { notifs: NotifData[] }) {
  const router = useRouter()
  const [visible, setVisible] = useState(notifs)

  if (visible.length === 0) return null
  const n = visible[0]

  const typeStyles: Record<string, string> = {
    brief: 'border-amber-500/30 bg-amber-500/10',
    info: 'border-blue-500/30 bg-blue-500/10',
    success: 'border-emerald-500/30 bg-emerald-500/10',
    alert: 'border-red-500/30 bg-red-500/10',
  }
  const typeIcons: Record<string, string> = { brief: '☀️', info: '💡', success: '✅', alert: '⚠️' }

  async function dismiss(id: string) {
    setVisible(v => v.filter(n => n.id !== id))
    try { await fetch(`/api/notifications/${id}`, { method: 'POST' }) } catch {}
  }

  return (
    <div
      className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${typeStyles[n.type] ?? typeStyles.info} cursor-pointer select-none`}
      onClick={() => { if (n.actionUrl) router.push(n.actionUrl); dismiss(n.id) }}
      role="button"
    >
      <span className="text-lg mt-0.5 shrink-0">{typeIcons[n.type] ?? '📢'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/90 leading-tight">{n.title}</p>
        <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{n.body}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(n.id) }}
        className="text-white/30 hover:text-white/60 text-lg leading-none ml-1 mt-0.5 shrink-0"
        aria-label="Dismiss"
      >×</button>
    </div>
  )
}

// ─── Proposal Card (Layer 1: The Flow) ────────────────────────────────────────
//
// Research: Anticipatory Design + Information Foraging Theory
// Shows what the app will DO for you now, not what it IS.
// Strong contextual scent: "What's for dinner?" > "Mise" icon.

const BADGE_COLORS: Record<string, string> = {
  now: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  focus: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  fun: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  dinner: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  rest: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  setup: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  start: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  preview: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

function ProposalCard({ suggestion, index, visitor = false }: { suggestion: Suggestion; index: number; visitor?: boolean }) {
  const app = getApp(suggestion.appId)
  if (!app?.live) return null

  // Use explicit href override, or append ?q= for contextual prompt, or default route
  const href = visitor ? '#' : (suggestion.href
    ?? (suggestion.prompt
      ? `${app.route}?q=${encodeURIComponent(suggestion.prompt)}`
      : app.route))

  const cardClass = `
    group relative flex items-center gap-3.5 p-4 rounded-2xl border transition-all duration-200
    animate-avalanche-fall
    ${visitor ? '' : 'hover:scale-[1.01] active:scale-[0.98]'}
    ${index === 0
      ? 'bg-white/[0.08] border-white/[0.15] shadow-lg shadow-black/20'
      : 'bg-white/[0.04] border-white/[0.08]'
    }
  `

  const inner = (
    <>
      <div className={`w-12 h-12 @lg:w-14 @lg:h-14 ${app.color} rounded-xl @lg:rounded-2xl flex items-center justify-center text-2xl shrink-0 shadow-lg
                        group-hover:shadow-xl transition-shadow`}>
        {app.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[15px] @lg:text-base font-semibold text-white truncate">{suggestion.title}</p>
          {suggestion.badge && (
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0
                              ${BADGE_COLORS[suggestion.badge] ?? 'bg-white/10 text-white/50 border-white/10'}`}>
              {suggestion.badge}
            </span>
          )}
        </div>
        <p className="text-xs text-white/45 mt-0.5 truncate">{suggestion.subtitle}</p>
      </div>
      {!visitor && <ChevronRight size={16} className="text-white/15 shrink-0 group-hover:text-white/30 transition-colors" />}
    </>
  )

  // Visitor cards are preview-only — no navigation
  if (visitor) {
    return (
      <div
        className={cardClass}
        style={{ ...(index === 0 ? { backdropFilter: 'blur(12px)' } : {}), animationDelay: `${index * 100}ms` }}
      >
        {inner}
      </div>
    )
  }

  return (
    <Link
      href={href}
      className={cardClass}
      style={{ ...(index === 0 ? { backdropFilter: 'blur(12px)' } : {}), animationDelay: `${index * 100}ms` }}
    >
      {inner}
    </Link>
  )
}

// ─── Activity Pulse (Layer 2: The Thread) ─────────────────────────────────────
//
// Research: Information Foraging Theory — users follow "scent" of freshness.
// A live activity feed has maximum scent. A static grid has zero.

function ActivityPulse({ activity }: { activity: HomeContext['activity'] }) {
  if (activity.length === 0) return null

  return (
    <div className="animate-avalanche-fall" style={{ animationDelay: '300ms' }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20 mb-2.5 px-1">
        Recent
      </p>
      <div className="flex flex-col gap-2 @lg:grid @lg:grid-cols-2 @lg:gap-2">
        {activity.map((item, i) => {
          const href = item.prompt
            ? `${item.route}?q=${encodeURIComponent(item.prompt)}`
            : item.route
          return (
          <Link
            key={i}
            href={href}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06]
                       hover:bg-white/[0.07] hover:border-white/[0.10] transition-colors"
          >
            <span className="text-sm shrink-0">{item.appIcon}</span>
            <span className="text-[11px] text-white/40 truncate flex-1 min-w-0">{item.text}</span>
            <span className="text-[9px] text-white/20 shrink-0">{item.ago}</span>
          </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── Spaces (Layer 3: App Discovery) ──────────────────────────────────────────
//
// Research: Netflix groups by mood/genre, not title. Spotify has "Made for You".
// Users think in verbs ("I want to create") not nouns ("Drama Mode").
// Semantic grouping beats alphabetical dump.

function AppSpaces({ expanded, onHide, isAdmin }: { expanded: boolean; onHide: () => void; isAdmin: boolean }) {
  const allApps = useMemo(() => getAllApps(), [])

  const spaces = useMemo(() => {
    if (isAdmin) return [...SPACES, { name: 'System', icon: '🔒', appIds: ['admin'] }]
    return SPACES
  }, [isAdmin])

  return (
    <div className={`spaces-grid ${expanded ? 'spaces-expanded' : ''}`}>
      <div className="spaces-grid-inner">
        <div className="flex flex-col gap-5 pt-1">
          {spaces.map(space => {
            const apps = space.appIds.map(id => allApps.find(a => a.id === id)).filter(Boolean) as MywayApp[]
            if (apps.length === 0) return null

            return (
              <div key={space.name}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20 mb-2 flex items-center gap-1.5">
                  <span>{space.icon}</span>
                  <span>{space.name}</span>
                </p>
                <div className="grid grid-cols-4 @lg:grid-cols-6 @3xl:grid-cols-8 gap-y-3 gap-x-2">
                  {apps.map(app => (
                    <Link
                      key={app.id}
                      href={app.live ? app.route : '#'}
                      className={`flex flex-col items-center gap-1.5
                                  ${!app.live ? 'opacity-25 pointer-events-none' : ''}`}
                    >
                      <div className={`w-[52px] h-[52px] @lg:w-[56px] @lg:h-[56px] ${app.color} rounded-xl flex items-center
                                       justify-center text-2xl shadow-md active:scale-95 transition-transform`}>
                        {app.icon}
                      </div>
                      <span className="text-[10px] @lg:text-[11px] text-white/35 text-center leading-tight truncate w-full">
                        {app.name}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Hide apps — always reachable at bottom of expanded spaces */}
          <button
            onClick={onHide}
            className="flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium
                       text-white/20 hover:text-white/40 transition-colors"
          >
            <span className="text-sm leading-none">↑</span>
            <span className="tracking-wide">Hide apps</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Command Bar (bottom, thumb-reachable) ────────────────────────────────────
//
// Research: The iPhone moment — keyboard appears only when needed.
// The command bar is a universal input that can trigger any app.
// Moves to the bottom for thumb reachability.

function CommandBar({ apps, isAdmin, onImmersive }: { apps: MywayApp[]; isAdmin: boolean; onImmersive: () => void }) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [selected, setSelected] = useState(0)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const results = query.trim() ? apps.filter(a => a.live && fuzzyMatch(query, a) && (a.id !== 'admin' || isAdmin)).slice(0, 5) : []
  const showResults = focused && (results.length > 0 || query.trim().length > 0)

  function goToChat(q: string) {
    router.push(`/apps/chat?q=${encodeURIComponent(q.trim())}`)
    setQuery('')
    inputRef.current?.blur()
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); return }
    if (e.key === 'Enter') {
      const app = results[selected]
      if (app?.live) {
        router.push(app.route)
        setQuery('')
      } else if (query.trim()) {
        goToChat(query)
      }
    }
  }

  return (
    <div className="relative">
      {/* Results dropdown — appears ABOVE the input */}
      {showResults && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-white/10 overflow-hidden z-50"
          style={{ background: 'rgba(8,4,18,0.92)', backdropFilter: 'blur(24px)' }}
        >
          {results.map((app, i) => (
            <Link
              key={app.id}
              href={app.route}
              onMouseEnter={() => setSelected(i)}
              className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                i === selected ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
            >
              <span className="text-lg">{app.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium">{app.name}</div>
                <div className="text-white/30 text-[11px] truncate">{app.description}</div>
              </div>
            </Link>
          ))}
          {query.trim() && (
            <button
              onMouseDown={(e) => { e.preventDefault(); goToChat(query) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.07] transition-colors
                          ${results.length > 0 ? 'border-t border-white/[0.06]' : ''}`}
            >
              <span className="text-lg">💬</span>
              <div className="min-w-0 flex-1">
                <div className="text-white/70 text-sm font-medium">Ask Chat</div>
                <div className="text-white/25 text-[11px] truncate">"{query}"</div>
              </div>
              <span className="text-white/15 text-xs">↵</span>
            </button>
          )}
        </div>
      )}

      {/* Input bar */}
      <div
        className={`flex items-center gap-2 px-4 py-3 rounded-2xl border transition-all duration-300 ${
          focused
            ? 'bg-white/10 border-white/25 shadow-[0_0_20px_rgba(255,255,255,0.05),0_25px_50px_-12px_rgba(0,0,0,0.4)]'
            : 'bg-white/[0.05] border-white/[0.08]'
        }`}
      >
        <Search size={14} className="text-white/25 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0) }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKey}
          placeholder="Ask anything or open an app..."
          className="flex-1 bg-transparent text-white placeholder-white/20 outline-none text-[14px]"
        />
        {query ? (
          <button onClick={() => setQuery('')} className="text-white/25 hover:text-white/50 transition-colors shrink-0">
            <X size={14} />
          </button>
        ) : (
            <button
              onClick={onImmersive}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg
                         text-white/25 hover:text-white/50 hover:bg-white/[0.08] transition-colors"
              aria-label="Voice input"
            >
              <Mic size={14} />
            </button>
        )}
      </div>
    </div>
  )
}

// ─── Home page ────────────────────────────────────────────────────────────────

export default function Home() {
  const { widthClass, heightClass } = useViewMode()
  const router = useRouter()
  const [now, setNow] = useState<Date | null>(null)
  const [showSpaces, setShowSpaces] = useState(false)
  const [notifications, setNotifications] = useState<NotifData[]>([])
  const [ctx, setCtx] = useState<HomeContext | null>(null)
  const [dockVisible, setDockVisible] = useState(true)
  const [dockAnimating, setDockAnimating] = useState<'enter' | 'exit' | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [voiceImmersiveOpen, setVoiceImmersiveOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [useGeminiLive, setUseGeminiLive] = useState(true)
  const spacesRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollExpandedRef = useRef(false)
  // Cooldown prevents scroll handler from firing during collapse/expand animation
  const toggleCooldownRef = useRef(false)

  // Clock tick every 10s
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(id)
  }, [])

  // Fetch notifications (wait for ctx so we can skip for visitors)
  useEffect(() => {
    if (!ctx) return          // ctx not loaded yet — wait
    if (ctx.visitor) return   // visitors have no session
    fetch('/api/notifications')
      .then(r => r.ok ? r.json() : { notifications: [] })
      .then(data => setNotifications(data.notifications ?? []))
      .catch(() => {})
  }, [ctx])

  // Fetch home context (tasks, activity, user name)
  useEffect(() => {
    fetch('/api/home/context')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setCtx(data)

          // Visitor with no session → show onboarding immediately (PRD: US-001)
          if (data.visitor) {
            setShowOnboarding(true)
            return
          }

          // Authenticated but hasn't completed onboarding on server
          if (data.onboardingCompleted === false) {
            setShowOnboarding(true)
          }
        }
      })
      .catch(() => {})
  }, [])

  // Check auth + admin status (wait for ctx so we can skip for visitors)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  useEffect(() => {
    if (!ctx) return          // ctx not loaded yet — wait
    if (ctx.visitor) {
      setIsAuthenticated(false)
      return
    }
    fetch('/api/admin/auth')
      .then(r => {
        setIsAuthenticated(r.ok)
        return r.ok ? r.json() : null
      })
      .then(data => { if (data?.isAdmin) setIsAdmin(true) })
      .catch(() => setIsAuthenticated(false))
  }, [ctx])

  // ── Scroll-based auto-expand/collapse ──
  // Expand when user scrolls near the bottom of the scroll area.
  // Collapse when user scrolls back to top.
  // Only triggers if content actually overflows (maxScroll > threshold).
  const showSpacesRef = useRef(false)
  showSpacesRef.current = showSpaces

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    // ── Scroll handler: works on mobile where content naturally overflows ──
    let ticking = false
    const onScroll = () => {
      if (ticking || toggleCooldownRef.current) return
      ticking = true
      requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = el
        const maxScroll = scrollHeight - clientHeight

        // Near bottom + actually scrollable + not already expanded → expand
        if (maxScroll > 80 && scrollTop > maxScroll - 40 && !showSpacesRef.current) {
          scrollExpandedRef.current = true
          toggleCooldownRef.current = true
          setTimeout(() => { toggleCooldownRef.current = false }, 500)
          setShowSpaces(true)
          setDockAnimating('exit')
        }

        // Back to top → collapse (regardless of how it was expanded)
        if (scrollTop < 30 && showSpacesRef.current) {
          scrollExpandedRef.current = false
          toggleCooldownRef.current = true
          setTimeout(() => { toggleCooldownRef.current = false }, 500)
          setShowSpaces(false)
          setDockVisible(true)
          setDockAnimating('enter')
        }

        ticking = false
      })
    }

    // ── Wheel handler: catches "scroll past the edge" on desktop where
    //    content may not overflow enough for the scroll handler to fire.
    //    deltaY > 10 filters out trackpad jitter / accidental micro-scrolls.
    const onWheel = (e: WheelEvent) => {
      if (toggleCooldownRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = el
      const maxScroll = scrollHeight - clientHeight
      const atBottom = scrollTop >= maxScroll - 5
      const atTop = scrollTop < 5

      if (e.deltaY > 10 && atBottom && !showSpacesRef.current) {
        scrollExpandedRef.current = true
        toggleCooldownRef.current = true
        setTimeout(() => { toggleCooldownRef.current = false }, 500)
        setShowSpaces(true)
        setDockAnimating('exit')
      }

      if (e.deltaY < -10 && atTop && showSpacesRef.current) {
        scrollExpandedRef.current = false
        toggleCooldownRef.current = true
        setTimeout(() => { toggleCooldownRef.current = false }, 500)
        setShowSpaces(false)
        setDockVisible(true)
        setDockAnimating('enter')
      }
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const allApps = useMemo(() => getAllApps(), [])
  const hour = now?.getHours() ?? 12
  const palette = getPalette(hour)
  // Visitor = server explicitly says so (hosted mode, no session).
  // OpenClaw users without auth are NOT visitors — they're local users.
  const isVisitor = ctx?.visitor === true
  const proposals = isVisitor
    ? getVisitorProposals(hour, ctx?.visitorHints ?? {})
    : getProposals(hour, ctx?.tasks ?? null, ctx?.setup, ctx?.contextCallback)
  const dockIds = getDockAppIds(hour)
  const dockApps = dockIds.map(id => allApps.find(a => a.id === id)).filter(Boolean) as MywayApp[]

  const timeStr = now
    ? now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : ''
  const dateStr = now
    ? now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : ''

  // Live context line — visitor-aware, setup-aware, or ambient thought
  // US-012: Context callback takes priority on first return after onboarding
  const contextLine = useMemo(() => {
    if (isVisitor) return getVisitorContextLine(ctx?.visitorHints ?? {})
    if (ctx?.contextCallback) return ctx.contextCallback
    return getContextLine(ctx?.tasks ?? null, ctx?.setup, palette.thought)
  }, [ctx, palette.thought, isVisitor])

  // Greeting based on time
  const greeting = useMemo(() => {
    if (isVisitor) return null // Visitors don't get a personal greeting
    if (!ctx?.userName) return null
    if (hour >= 5 && hour < 12) return `Good morning, ${ctx.userName}`
    if (hour >= 12 && hour < 17) return `Good afternoon, ${ctx.userName}`
    if (hour >= 17 && hour < 22) return `Good evening, ${ctx.userName}`
    return `Hey, ${ctx.userName}`
  }, [ctx?.userName, hour, isVisitor])

  const toggleSpaces = useCallback(() => {
    toggleCooldownRef.current = true
    setTimeout(() => { toggleCooldownRef.current = false }, 500)
    setShowSpaces(prev => {
      const next = !prev
      if (next) {
        // Expanding: hide dock with exit animation, then scroll to spaces
        setDockAnimating('exit')
        setTimeout(() => {
          spacesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      } else {
        // Collapsing: smooth-scroll to top, then show dock
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        setDockVisible(true)
        setDockAnimating('enter')
      }
      return next
    })
  }, [])

  const handleDockAnimationEnd = useCallback(() => {
    if (dockAnimating === 'exit') {
      setDockVisible(false)
    }
    setDockAnimating(null)
  }, [dockAnimating])

  return (
    <div className="h-dvh md:h-auto md:min-h-screen md:flex md:justify-center md:items-start md:py-8" style={{ background: 'var(--brand-bg)' }}>
      <div className={`
        @container relative flex flex-col text-white select-none
        w-full h-[100dvh] overflow-hidden min-w-0
        ${heightClass}
        md:rounded-[2.5rem]
        md:ring-1 md:ring-white/15
        md:shadow-[0_50px_100px_-20px_rgba(0,0,0,0.95)]
        page-enter
        ${widthClass}
      `}>

        {/* Ambient gradient */}
        <div
          className="absolute inset-0 -z-10 transition-all duration-[8000ms] ease-in-out"
          style={{ background: palette.gradient }}
        />
        <div
          className="absolute inset-0 -z-10 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, transparent 60%, rgba(0,0,0,0.5) 100%)' }}
        />

        {/* Top bar — centered app name */}
        <div className="flex justify-center items-center px-6 app-header-top pb-1 shrink-0">
          <span className="text-[13px] font-semibold text-white/40 tracking-wide">Myway</span>
        </div>

        {/* Scrollable body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-5 @lg:px-8 pt-2 pb-safe pb-4 flex flex-col gap-7 @lg:gap-9 min-h-0 scrollbar-none">

          {!now ? (
            /* ── Skeleton: shown until client-side time is ready ── */
            <>
              <div className="text-center pt-6 pb-2 flex flex-col items-center gap-3">
                <Skeleton className="h-16 w-48 rounded-xl" />
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-3 w-52 rounded mt-1" />
              </div>
              <div>
                <Skeleton className="h-3 w-20 mb-2.5 ml-1 rounded" />
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map(i => (
                    <Skeleton key={i} className="h-[72px] rounded-2xl" />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* ── Layer 0: The Moment ── */}
              <div className="text-center pt-6 pb-2">
                <div className="text-[64px] @lg:text-[80px] font-thin tabular-nums leading-none text-white/90 tracking-tighter" suppressHydrationWarning>
                  {timeStr}
                </div>
                <div className="text-sm @lg:text-base text-white/30 mt-2 font-light" suppressHydrationWarning>{dateStr}</div>
                {greeting && (
                  <p className="text-[13px] @lg:text-sm text-white/50 mt-3 font-medium">{greeting}</p>
                )}
                <p
                  className={`text-[12px] mt-2 font-medium leading-relaxed max-w-[240px] @lg:max-w-[400px] mx-auto ${palette.accentClass}`}
                  style={{ opacity: 0.7 }}
                >
                  {contextLine}
                </p>
              </div>

              {/* Notification banner */}
              {notifications.length > 0 && (
                <NotificationBanner notifs={notifications} />
              )}

              {/* ── Layer 1: The Flow (Proposal Cards) ── */}
              <div>
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20 animate-avalanche-fall">
                    {isVisitor ? 'What Myway does' : 'Right now'}
                  </p>
                  {!isVisitor && (
                    <button
                      onClick={toggleSpaces}
                      className="flex items-center gap-1.5 text-[10px] font-medium text-white/20 hover:text-white/40 transition-colors"
                    >
                      <span className="text-sm leading-none">{showSpaces ? '↑' : '⊞'}</span>
                      <span className="tracking-wide">{showSpaces ? 'Hide apps' : 'All apps'}</span>
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2 @lg:grid @lg:grid-cols-2 @lg:gap-3">
                  {proposals.slice(0, isVisitor ? 5 : 3).map((s, i) => (
                    <div key={s.appId} className={i === 0 ? '@lg:col-span-2' : ''}>
                      <ProposalCard suggestion={s} index={i} visitor={isVisitor} />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Visitor sign-in CTA ── */}
              {isVisitor && (
                <div className="flex flex-col items-center gap-4 animate-avalanche-fall" style={{ animationDelay: '500ms' }}>
                  <Link
                    href="/apps/chat"
                    className="flex items-center gap-2.5 px-8 py-3.5 rounded-2xl
                               bg-white/[0.14] border border-white/[0.20] hover:bg-white/[0.22]
                               text-white text-[15px] font-semibold transition-all
                               hover:scale-[1.02] active:scale-[0.98]
                               shadow-lg shadow-black/20"
                  >
                    <LogIn size={18} />
                    <span>Try Myway free</span>
                  </Link>
                  <div className="mt-10 text-[10px] text-white/[0.08] space-x-2">
                    <Link href="/terms" className="hover:text-white/20 transition-colors">Terms</Link>
                    <span>&middot;</span>
                    <Link href="/privacy" className="hover:text-white/20 transition-colors">Privacy</Link>
                  </div>
                </div>
              )}

              {/* ── Layers 2-3: only for authenticated users ── */}
              {!isVisitor && (
                <>
                  {/* ── Layer 2: The Thread (Activity Pulse) ── */}
                  {ctx && ctx.activity.length > 0 && (
                    <ActivityPulse activity={ctx.activity} />
                  )}

                  {/* Browse all apps — visible tap target when scroll-reveal can't trigger
                      (e.g. only 2 recents → page too short to scroll). Hidden once spaces are open. */}
                  {!showSpaces && (
                    <button
                      onClick={toggleSpaces}
                      className="w-full py-3 rounded-2xl border border-white/[0.08] bg-white/[0.03]
                                 text-[12px] font-medium text-white/30 hover:text-white/50 hover:bg-white/[0.06]
                                 transition-colors"
                    >
                      Browse all apps
                    </button>
                  )}

                  {/* ── Layer 3: The Spaces ── */}
                  <div ref={spacesRef}>
                    <AppSpaces expanded={showSpaces} onHide={toggleSpaces} isAdmin={isAdmin} />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Layer 4: Dock + Command Bar (authenticated only) ── */}
        {!isVisitor && (
        <div className="shrink-0 px-5 @lg:px-8 pb-2 pt-1">
          {/* Command bar — always visible, thumb-reachable universal input */}
          <div className="@lg:max-w-[520px] @lg:mx-auto">
            <CommandBar apps={allApps} isAdmin={isAdmin} onImmersive={() => setVoiceImmersiveOpen(true)} />
          </div>

          {/* Adaptive dock — animates out when All Apps is expanded */}
          {dockVisible && (
            <div
              className={`mt-2.5 mb-5 @lg:max-w-[520px] @lg:mx-auto ${
                dockAnimating === 'exit' ? 'animate-dock-exit' :
                dockAnimating === 'enter' ? 'animate-dock-enter' : ''
              }`}
              onAnimationEnd={handleDockAnimationEnd}
            >
              {!now ? (
                /* Dock skeleton */
                <div className="p-2.5 rounded-3xl flex justify-around items-center border border-white/[0.08]"
                     style={{ background: 'rgba(255,255,255,0.05)' }}>
                  {[0, 1, 2, 3].map(i => (
                    <Skeleton key={i} className="w-13 h-13 rounded-xl" />
                  ))}
                </div>
              ) : (
                <div
                  className="p-2.5 rounded-3xl flex justify-around items-center border border-white/[0.08]"
                  style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(24px)' }}
                >
                  {dockApps.map(app => (
                    <Link
                      key={app.id}
                      href={app.route}
                      className="active:scale-90 active:opacity-60 transition-all duration-150"
                    >
                      <div className={`w-13 h-13 @lg:w-[60px] @lg:h-[60px] ${app.color} rounded-xl @lg:rounded-2xl flex items-center justify-center text-xl @lg:text-2xl shadow-md`}>
                        {app.icon}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Home indicator */}
          <div className="flex justify-center pb-1 mt-2">
            <div className="w-32 h-1 bg-white/15 rounded-full" />
          </div>
        </div>
        )}
        {showOnboarding && (
          isVisitor ? (
            <SelfDemoImmersive
              onComplete={() => setShowOnboarding(false)}
              onSignup={() => {
                setShowOnboarding(false)
                router.push('/apps/chat')
              }}
            />
          ) : useGeminiLive ? (
            <OnboardingGeminiLive
              onComplete={() => {
                setShowOnboarding(false)
                fetch('/api/home/context')
                  .then(r => r.ok ? r.json() : null)
                  .then(data => { if (data) setCtx(data) })
                  .catch(() => {})
              }}
              onFallback={() => setUseGeminiLive(false)}
            />
          ) : (
            <OnboardingImmersive
              visitor={isVisitor}
              resumeStep={ctx?.onboardingResume?.step ?? undefined}
              resumeName={ctx?.onboardingResume?.name ?? undefined}
              onComplete={() => {
                setShowOnboarding(false)
                if (!isVisitor) {
                  fetch('/api/home/context')
                    .then(r => r.ok ? r.json() : null)
                    .then(data => { if (data) setCtx(data) })
                    .catch(() => {})
                }
              }}
            />
          )
        )}
        <VoiceImmersive
          open={voiceImmersiveOpen}
          onClose={() => setVoiceImmersiveOpen(false)}
          onSubmit={(text) => {
            setVoiceImmersiveOpen(false)
            if (text.trim()) {
              router.push(`/apps/chat?q=${encodeURIComponent(text.trim())}`)
            }
          }}
          appName="Myway"
        />
      </div>

    </div>
  )
}
