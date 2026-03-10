'use client'

/**
 * Somni — Your Personal Sleepcaster
 *
 * AI bedtime stories that know your day, remix every night, and never repeat.
 *
 * Page has three states:
 *   1. Library — saved stories + quick-start presets (opener)
 *   2. Generator — chat interface for story creation (uses AppShell)
 *   3. Player — full-screen text reader with ambient UI + sleep timer
 *
 * v1: Text-based stories with soothing UI. TTS audio is v2.
 *
 * Psychology:
 *   - Procedural remixing prevents timeline anxiety (Headspace research)
 *   - Cognitive shuffle disrupts rumination (Beaudoin, 2020)
 *   - Self-hero effect helps kids process emotions (child psychology)
 *   - Frictionless routine builds nightly dependency
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Moon, BookOpen, Play, Pause, Clock, ChevronLeft, Volume2, X, RotateCcw } from 'lucide-react'
import { getApp } from '@/lib/apps'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import AppShell from '@/components/AppShell'
import ChatInputBar from '@/components/ChatInputBar'
import { MarkdownContent } from '@/components/MarkdownContent'
import { getAppGradient } from '@/lib/design'
import { useAppHistory } from '@/hooks/useAppHistory'
import { useTTS } from '@/hooks/useTTS'
import TTSButton from '@/components/TTSButton'

// ─── Types ────────────────────────────────────────────────────────────────────

type Story = {
  id: string
  title: string
  type: 'landscape_tour' | 'cognitive_shuffle' | 'hero_journey' | 'read_along'
  content: string
  generatedAt: string
  themes: string[]
  durationEstimate: number // minutes
}

type ViewState = 'library' | 'generator' | 'player'

// ─── Story Type Cards ─────────────────────────────────────────────────────────

const STORY_TYPES = [
  {
    type: 'landscape_tour',
    icon: '🏞️',
    name: 'Landscape Tour',
    tagline: 'Plotless & peaceful',
    description: 'Wander through a beautiful setting. No conflict. Just rich sensory details winding down.',
    gradient: 'from-emerald-900/30 to-transparent',
    prompt: 'Generate a Landscape Tour bedtime story. Choose a peaceful, detailed setting — an antique shop, a Japanese garden, a mountain lake cabin. No plot, no conflict. Just rich sensory details that slowly wind down. Use my context to personalize it.',
  },
  {
    type: 'cognitive_shuffle',
    icon: '🧩',
    name: 'Cognitive Shuffle',
    tagline: 'For restless nights',
    description: 'Random, unconnected imagery woven into a loose narrative. Disrupts racing thoughts.',
    gradient: 'from-violet-900/30 to-transparent',
    prompt: 'Generate a Cognitive Shuffle bedtime story. Weave random, unconnected objects and scenes into a loose narrative. Each image described in 2-3 rich sensory sentences, then drift to something completely unrelated. Gradually slow down. Help my mind let go.',
  },
  {
    type: 'hero_journey',
    icon: '🦸',
    name: "Kid's Adventure",
    tagline: "They're the hero",
    description: 'Your child is the protagonist. Gentle challenges solved with kindness.',
    gradient: 'from-amber-900/30 to-transparent',
    prompt: "Generate a Hero Journey bedtime story for a child. Make the child the protagonist — use real names from my profile if available. Gentle challenges solved with kindness. The child ends safe, warm, and proud.",
  },
]

// ─── Sleep Timer ──────────────────────────────────────────────────────────────

function SleepTimer({ onExpire }: { onExpire: () => void }) {
  const [minutes, setMinutes] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const presets = [15, 20, 30, 45]

  useEffect(() => {
    if (minutes === null) return
    setRemaining(minutes * 60)

    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          onExpire()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [minutes, onExpire])

  if (minutes === null) {
    return (
      <div className="flex items-center gap-2">
        <Clock size={12} className="text-indigo-300/50" />
        <span className="text-[10px] text-indigo-300/40 mr-1">Sleep timer:</span>
        {presets.map(m => (
          <button
            key={m}
            onClick={() => setMinutes(m)}
            className="text-[10px] text-indigo-300/50 hover:text-indigo-300 px-1.5 py-0.5
                       rounded-md bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
          >
            {m}m
          </button>
        ))}
      </div>
    )
  }

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60

  return (
    <div className="flex items-center gap-2">
      <Clock size={12} className="text-indigo-300/60" />
      <span className="text-[11px] text-indigo-300/60 tabular-nums">
        {mins}:{secs.toString().padStart(2, '0')}
      </span>
      <button
        onClick={() => {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setMinutes(null)
        }}
        className="text-[10px] text-indigo-300/40 hover:text-indigo-300 transition-colors"
      >
        cancel
      </button>
    </div>
  )
}

// ─── Story Reader (Player view) ───────────────────────────────────────────────

function StoryReader({
  story,
  onBack,
}: {
  story: Story
  onBack: () => void
}) {
  const [brightness, setBrightness] = useState(100)
  const [sliderOpen, setSliderOpen] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)
  const tts = useTTS()

  // Click-outside closes brightness popover
  useEffect(() => {
    if (!sliderOpen) return
    const handle = (e: MouseEvent) => {
      if (sliderRef.current && !sliderRef.current.contains(e.target as Node)) {
        setSliderOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [sliderOpen])

  const typeLabels: Record<string, string> = {
    landscape_tour: '🏞️ Landscape Tour',
    cognitive_shuffle: '🧩 Cognitive Shuffle',
    hero_journey: '🦸 Hero Journey',
    read_along: '📖 Read Along',
  }

  return (
    <div className="flex flex-col h-full transition-opacity duration-1000" style={{ opacity: brightness / 100 }}>
      {/* Reader header */}
      <div className="flex items-center gap-3 px-4 app-header-top pb-3 border-b border-white/[0.06] shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40
                     hover:text-white hover:bg-white/[0.08] transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{story.title}</p>
          <p className="text-[10px] text-indigo-300/50">{typeLabels[story.type] ?? story.type}</p>
        </div>
        <div className="relative" ref={sliderRef}>
          <button
            onClick={() => setSliderOpen(!sliderOpen)}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors
                       ${brightness < 50 ? 'text-indigo-300/60' : 'text-white/30 hover:text-white/60'}`}
            title="Brightness"
          >
            <Moon size={14} />
          </button>
          {sliderOpen && (
            <div className="absolute right-0 top-10 z-50 flex flex-col items-center gap-2
                            bg-black/80 backdrop-blur-xl border border-white/[0.10] rounded-2xl
                            px-4 py-4 shadow-2xl">
              <span className="text-[9px] text-indigo-300/50 font-medium uppercase tracking-wider">Bright</span>
              <input
                type="range"
                min={10}
                max={100}
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="brightness-slider accent-indigo-400"
                style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '120px' }}
              />
              <span className="text-[9px] text-indigo-300/50 font-medium uppercase tracking-wider">Dim</span>
              <span className="text-[10px] text-indigo-300/60 tabular-nums mt-1">{brightness}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Story content */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6 min-h-0">
        <div className="prose prose-sm prose-invert max-w-none
                        prose-p:text-indigo-100/70 prose-p:leading-[1.9] prose-p:text-[15px]
                        prose-headings:text-indigo-100/90 prose-headings:font-light
                        prose-strong:text-indigo-200/80">
          <MarkdownContent content={story.content} />
        </div>
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 px-4 pt-3 app-footer-bottom border-t border-white/[0.04] flex items-center justify-between">
        <SleepTimer onExpire={() => setBrightness(10)} />
        <div className="flex items-center gap-3">
          <TTSButton
            text={story.content}
            tts={tts}
            provider="elevenlabs"
          />
          <span className="text-[10px] text-white/20">~{story.durationEstimate} min read</span>
        </div>
      </div>
    </div>
  )
}

// ─── Somni Main Page ──────────────────────────────────────────────────────────

export default function SomniPage() {
  const router = useRouter()
  const app = getApp('somni')!
  const [view, setView] = useState<ViewState>('library')
  const [stories, setStories] = useState<Story[]>([])
  const [activeStory, setActiveStory] = useState<Story | null>(null)
  const [generatingType, setGeneratingType] = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [continueConvId, setContinueConvId] = useState<string | null>(null)

  // ── Persisted stories from DB ───────────────────────────────────────────────
  const { items: historyItems, loading: historyLoading } = useAppHistory('somni', 8)

  const recentStories = useMemo<Story[]>(() => {
    return historyItems.map((item) => {
      const content = item.lastContent
      const titleMatch = content.match(/^##\s+(.+)$/m) ?? content.match(/^#\s+(.+)$/m)
      const title = item.title ?? titleMatch?.[1] ?? 'Untitled Story'

      let type: Story['type'] = 'landscape_tour'
      const lc = content.toLowerCase()
      if (lc.includes('cognitive shuffle')) type = 'cognitive_shuffle'
      else if (lc.includes('hero') || lc.includes('adventure')) type = 'hero_journey'

      return {
        id: `db-${item.conversationId}`,
        title,
        type,
        content,
        generatedAt: new Date(item.lastMessageAt * 1000).toISOString(),
        themes: [],
        durationEstimate: Math.max(1, Math.round(content.split(/\s+/).length / 130)),
      }
    })
  }, [historyItems])

  // Merge: current session first, then persisted (deduped)
  const allStories = useMemo(() => {
    const memoryIds = new Set(stories.map(s => s.id))
    return [...stories, ...recentStories.filter(s => !memoryIds.has(s.id))]
  }, [stories, recentStories])

  // Capture generated stories from the chat
  const handleMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    if (role !== 'assistant' || content.length < 200) return

    // Parse story from AI response
    const titleMatch = content.match(/^##\s+(.+)$/m) ?? content.match(/^#\s+(.+)$/m)
    const title = titleMatch?.[1] ?? 'Untitled Story'

    // Detect type from content or use the generating type
    let type: Story['type'] = 'landscape_tour'
    if (generatingType === 'cognitive_shuffle' || content.toLowerCase().includes('cognitive shuffle')) {
      type = 'cognitive_shuffle'
    } else if (generatingType === 'hero_journey' || content.toLowerCase().includes('hero') || content.toLowerCase().includes('adventure')) {
      type = 'hero_journey'
    }

    const story: Story = {
      id: `story-${Date.now()}`,
      title,
      type,
      content,
      generatedAt: new Date().toISOString(),
      themes: [],
      durationEstimate: Math.round(content.split(/\s+/).length / 130), // ~130 wpm reading
    }

    setStories(prev => [story, ...prev])
    setActiveStory(story)
  }, [generatingType])

  const handleBack = useCallback(() => {
    if (view === 'player') {
      setView('library')
      setActiveStory(null)
    } else if (view === 'generator') {
      setView('library')
      setCustomPrompt('')
      setContinueConvId(null)
    } else {
      router.push('/')
    }
  }, [view, router])

  // Player view — full screen story reader
  if (view === 'player' && activeStory) {
    return (
      <AppPage
        gradient="radial-gradient(ellipse 80% 50% at 50% -10%, rgba(49,46,129,0.35) 0%, transparent 65%), var(--brand-bg)"
      >
        <StoryReader story={activeStory} onBack={handleBack} />
      </AppPage>
    )
  }

  // Generator view — chat with Somni to create stories
  if (view === 'generator') {
    return (
      <AppShell
        app={app}
        onMessage={handleMessage}
        headerActions={
          <button
            onClick={() => {
              if (activeStory) {
                setView('player')
              }
            }}
            disabled={!activeStory}
            className="text-xs text-indigo-300/50 hover:text-indigo-300 disabled:opacity-30
                       disabled:cursor-not-allowed transition-colors px-2 py-1 rounded-lg"
          >
            {activeStory ? '📖 Read' : ''}
          </button>
        }
        initialMessage={
          continueConvId
            ? 'Continue the story. Pick up exactly where we left off — same setting, same mood, same characters. No summary, no repetition. Just the next part.'
            : customPrompt.trim()
              ? customPrompt.trim()
              : generatingType
                ? STORY_TYPES.find(t => t.type === generatingType)?.prompt ?? undefined
                : undefined
        }
        initialConversationId={continueConvId ?? undefined}
      />
    )
  }

  // Library view — browse stories + quick-start
  return (
    <AppPage
      gradient={getAppGradient(app.color)}
    >
      <AppHeader
        title={app.name}
        icon={app.icon}
        onBack={handleBack}
        backLabel="Home"
      />

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-6 flex flex-col gap-6 min-h-0">

        {/* Hero */}
        <div className="text-center pt-4 pb-2">
          <div className="text-5xl mb-3 select-none">🌙</div>
          <h2 className="text-white font-bold text-lg">Time to wind down</h2>
          <p className="text-indigo-300/50 text-sm mt-1.5 leading-relaxed max-w-[260px] mx-auto">
            Stories that know your day. Generated fresh every night. Never the same twice.
          </p>
        </div>

        {/* Quick-start story type cards */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20 mb-3 px-1">
            Generate a story
          </p>
          <div className="flex flex-col gap-2.5">
            {STORY_TYPES.map(st => (
              <button
                key={st.type}
                onClick={() => {
                  setGeneratingType(st.type)
                  setView('generator')
                }}
                className={`text-left p-4 rounded-2xl border border-white/[0.08] bg-gradient-to-r ${st.gradient}
                            bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.14]
                            active:scale-[0.98] transition-all duration-200`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{st.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white">{st.name}</p>
                      <span className="text-[9px] text-indigo-300/40">{st.tagline}</span>
                    </div>
                    <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{st.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Saved stories library */}
        {historyLoading && allStories.length === 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20 mb-3 px-1">
              Recent stories
            </p>
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.06]
                                        flex items-center gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-indigo-900/20 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-white/[0.06] rounded w-3/4" />
                    <div className="h-2 bg-white/[0.04] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {allStories.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20 mb-3 px-1">
              {stories.length > 0 ? 'Your stories' : 'Recent stories'}
            </p>
            <div className="flex flex-col gap-2">
              {allStories.map(story => {
                // Extract conversationId from DB stories (format: db-{convId})
                const dbConvId = story.id.startsWith('db-') ? story.id.slice(3) : null

                return (
                  <div key={story.id} className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setActiveStory(story)
                        setView('player')
                      }}
                      className="flex-1 text-left p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.06]
                                 hover:bg-white/[0.07] hover:border-white/[0.10] transition-colors
                                 flex items-center gap-3 min-w-0"
                    >
                      <div className="w-10 h-10 rounded-xl bg-indigo-900/40 flex items-center justify-center text-lg shrink-0">
                        <BookOpen size={16} className="text-indigo-300/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/80 truncate">{story.title}</p>
                        <p className="text-[10px] text-white/30 mt-0.5">
                          ~{story.durationEstimate} min · {new Date(story.generatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Play size={14} className="text-indigo-300/30 shrink-0" />
                    </button>
                    {dbConvId && (
                      <button
                        onClick={() => {
                          setContinueConvId(dbConvId)
                          setGeneratingType(null)
                          setView('generator')
                        }}
                        className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl
                                   bg-indigo-900/30 border border-white/[0.06]
                                   hover:bg-indigo-800/40 hover:border-white/[0.12] transition-colors"
                        title="Continue this story"
                        aria-label="Continue this story"
                      >
                        <RotateCcw size={14} className="text-indigo-300/50" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Psychology note */}
        <div className="px-2 py-4 text-center">
          <p className="text-[10px] text-white/15 leading-relaxed max-w-[240px] mx-auto">
            Somni uses cognitive shuffle techniques to help your mind let go.
            Stories are never the same twice — so your brain can't track time.
          </p>
        </div>
      </div>

      {/* Chat input — describe any story */}
      <div className="px-4 app-footer-bottom pt-2 border-t border-white/[0.06]">
        <ChatInputBar
          value={customPrompt}
          onChange={setCustomPrompt}
          onSend={(text) => {
            setCustomPrompt(text)
            setGeneratingType(null)
            setView('generator')
          }}
          placeholder="Describe a story — e.g. 'a quiet bookshop in the rain'"
          appName="Somni"
          appColor="#4338ca"
          showAttachments={false}
          sendButtonClassName="bg-indigo-600 hover:bg-indigo-500"
          immersiveButtonClassName="bg-indigo-600/60 hover:bg-indigo-600"
        />
      </div>
    </AppPage>
  )
}
