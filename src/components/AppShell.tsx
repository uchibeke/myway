'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { History, X as XIcon, ChevronDown } from 'lucide-react'
import QuotaExceeded from '@/components/QuotaExceeded'
import type { MywayApp } from '@/lib/apps'
import { isPersistentApp } from '@/lib/apps'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import { MarkdownContent } from '@/components/MarkdownContent'
import ChatInputBar from '@/components/ChatInputBar'
import { getAppGradient } from '@/lib/design'
import { signalInstallValue } from '@/components/InstallPrompt'
import { streamDeltas } from '@/lib/stream'
import { useTTS } from '@/hooks/useTTS'
import MessageActions from '@/components/MessageActions'
import { useIntegrationStatus } from '@/hooks/useIntegrationStatus'
import MessageOptions from '@/components/MessageOptions'
import type { MessageOption } from '@/components/MessageOptions'
import { uid } from '@/lib/uid'
import { useClientContext } from '@/hooks/useClientContext'
import { buildChatBody } from '@/lib/chat-client'
import { enrichWithAttachments } from '@/lib/message-enrichment'
import { smartRoute } from '@/lib/smart-router'
import FileIcon from '@/components/files/FileIcon'
import { formatSize } from '@/lib/file-types'
import type { FileCategory } from '@/lib/file-types'
import type { MessageAttachment } from '@/types/attachments'

// ─── Types ────────────────────────────────────────────────────────────────────

type QuotaExceededData = {
  appName: string
  appId?: string
  outcomeId?: string
  addonOptions: { quantity: number; priceUsd: number }[]
  message: string
  appRoomUrl?: string
  spendLimit?: { currentSpendUsd: number; limitUsd: number }
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  loadingHint?: string
  attachments?: MessageAttachment[]
  /** Provenance badge for smart-routed responses (LLM bypassed). */
  sourceLabel?: string
  /** Inline action options (e.g. approve/reject email drafts). */
  options?: MessageOption[]
  /** True after user resolved the options. */
  optionsResolved?: boolean
  /** Label shown after resolution (e.g. "Email sent"). */
  resultLabel?: string
  /** Quota exceeded data — renders QuotaExceeded component instead of content. */
  quotaExceeded?: QuotaExceededData
}

/** Metadata for a past conversation session. */
type HistoryConv = {
  id: string
  messageCount: number
  lastMessageAt: number | null
  title: string | null
}

type Props = {
  app: MywayApp
  opener?: React.ReactNode | ((send: (text: string, contextRefs?: string[]) => void) => React.ReactNode)
  headerActions?: React.ReactNode
  onMessage?: (role: 'user' | 'assistant', content: string) => void
  initialMessage?: string
  /** Pre-set conversationId to continue from an existing conversation. */
  initialConversationId?: string
  /** When true, renders in demo mode with no interactivity. */
  demo?: boolean
  /** Messages to display in demo mode (content progressively revealed by parent). */
  demoMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** True while demo content is still being revealed (shows streaming cursor). */
  demoStreaming?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HISTORY_PAGE = 10  // conversations per page

function getLoadingHint(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('http') || t.includes('://') || t.includes('.com') || t.includes('.io')) return 'Fetching…'
  if (t.includes('save') && (t.includes('recipe') || t.includes('link') || t.includes('url'))) return 'Fetching…'
  if (t.includes('search') || t.includes('find') || t.includes('look')) return 'Searching…'
  if (t.includes('list') || t.includes('show') || (t.includes('what') && t.includes('have'))) return 'Looking through your vault…'
  if (t.includes('plan') || t.includes('week') || t.includes('schedule')) return 'Planning…'
  if (t.includes('summarize') || t.includes('summary') || t.includes('brief')) return 'Summarizing…'
  if (t.includes('translat') || t.includes('explain') || t.includes('what does')) return 'Translating…'
  if (t.includes('write') || t.includes('draft') || t.includes('rewrite')) return 'Writing…'
  return 'Thinking…'
}

/** Map a connection action to approve/reject MessageOption buttons. */
function mapActionToOptions(
  action: { id: string; actionType: string; payload: Record<string, unknown> },
): MessageOption[] {
  const actionLabels: Record<string, { approve: string; reject: string; result: string }> = {
    'email.draft': { approve: 'Send', reject: 'Discard', result: 'Email sent' },
    'email.send': { approve: 'Send', reject: 'Discard', result: 'Email sent' },
    'calendar.create': { approve: 'Create Event', reject: 'Skip', result: 'Event created' },
    'calendar.respond': { approve: 'Confirm', reject: 'Decline', result: 'Response sent' },
  }

  const labels = actionLabels[action.actionType] ?? {
    approve: 'Approve', reject: 'Reject', result: 'Done',
  }

  const desc = action.actionType.startsWith('email')
    ? (action.payload.subject as string) ?? action.actionType
    : (action.payload.title as string) ?? action.actionType

  async function decide(decision: 'approve' | 'reject') {
    await fetch(`/api/connections/actions/${encodeURIComponent(action.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
  }

  return [
    {
      id: `${action.id}-approve`,
      label: labels.approve,
      description: desc,
      variant: 'primary' as const,
      action: () => decide('approve'),
    },
    {
      id: `${action.id}-reject`,
      label: labels.reject,
      description: desc,
      variant: 'danger' as const,
      action: () => decide('reject'),
    },
  ]
}

function relativeDate(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays === 0) return `Today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── HistoryPanel ─────────────────────────────────────────────────────────────
//
// Always rendered at the top of the scrollable message area (never in the
// shrink-0 input bar). This prevents layout push when expanded.
//
// Expand-all: one toggle fetches all session messages in parallel and shows
// everything flat. Each session has a × close button to hide it individually.

type HistoryPanelProps = {
  convs: HistoryConv[]
  closedIds: Set<string>
  msgMap: Record<string, Message[]>
  expanding: boolean   // fetching all messages after toggle
  hasMore: boolean
  loadingMore: boolean
  open: boolean
  appIcon: string
  hasCurrentMessages: boolean
  tts: ReturnType<typeof useTTS>
  ttsAvailable: boolean
  ttsProvider?: string
  onToggle: () => void
  onCloseConv: (id: string) => void
  onLoadMore: () => void
}

function HistoryPanel({
  convs, closedIds, msgMap, expanding, hasMore, loadingMore,
  open, appIcon, hasCurrentMessages, tts, ttsAvailable, ttsProvider,
  onToggle, onCloseConv, onLoadMore,
}: HistoryPanelProps) {
  if (convs.length === 0) return null

  // API returns newest-first; display oldest-first for natural timeline
  const orderedConvs = [...convs].reverse()
  const visibleConvs = orderedConvs.filter((c) => !closedIds.has(c.id))

  return (
    <div className="mb-3">
      {/* ── Outer toggle ── */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl
                   bg-white/[0.03] border border-white/[0.06]
                   hover:bg-white/[0.05] hover:border-white/[0.09]
                   text-xs text-zinc-500 transition-colors group"
      >
        <History size={12} className="shrink-0 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
        <span className="flex-1 text-left">
          History
          <span className="text-zinc-700">
            {' '}· {convs.length}{hasMore ? '+' : ''} session{convs.length !== 1 ? 's' : ''}
          </span>
        </span>
        {expanding ? (
          <span className="text-[10px] text-zinc-700 shrink-0">Loading…</span>
        ) : (
          <ChevronDown
            size={12}
            className={`shrink-0 text-zinc-700 group-hover:text-zinc-500 transition-all duration-200
                        ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* ── Expanded: all sessions flat, oldest → newest ── */}
      {open && (
        <div className="mt-2">
          {/* Load even older sessions */}
          {hasMore && (
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="w-full py-1.5 text-[11px] text-zinc-700 hover:text-zinc-500
                         transition-colors disabled:opacity-50 text-center mb-2"
            >
              {loadingMore ? 'Loading…' : '↑ Load earlier sessions'}
            </button>
          )}

          {visibleConvs.map((conv) => {
            const msgs = msgMap[conv.id] ?? []

            return (
              <div key={conv.id} className="mb-1">
                {/* Session header with × close */}
                <div className="flex items-center gap-2 py-1 px-1">
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="text-[10px] text-zinc-600 shrink-0 flex items-center gap-1">
                    {conv.title
                      ? <span className="text-zinc-500 mr-0.5">{conv.title} · </span>
                      : null
                    }
                    {relativeDate(conv.lastMessageAt)}
                    {conv.messageCount > 0 && (
                      <span className="text-zinc-700 ml-0.5"> · {conv.messageCount} msg</span>
                    )}
                    <button
                      onClick={() => onCloseConv(conv.id)}
                      className="ml-1.5 text-zinc-700 hover:text-zinc-400 transition-colors rounded"
                      title="Hide this session"
                      aria-label="Hide session"
                    >
                      <XIcon size={9} />
                    </button>
                  </span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>

                {msgs.length > 0 && (
                  <div className="px-1 pb-2 space-y-1.5 opacity-55">
                    {msgs.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 mr-1.5 mt-0.5
                                          bg-white/10 border border-white/10">
                            {appIcon}
                          </div>
                        )}
                        <div
                          className={`
                            max-w-[85%] rounded-xl text-xs leading-relaxed overflow-hidden
                            ${msg.role === 'user'
                              ? 'bg-[rgb(var(--brand-primary-rgb)/0.7)] text-white/90 rounded-br-sm px-2.5 py-1.5 whitespace-pre-wrap'
                              : 'bg-white/[0.05] text-zinc-400 border border-white/[0.06] rounded-bl-sm px-2.5 py-1.5'
                            }
                          `}
                        >
                          {msg.role === 'user' ? (
                            msg.content
                          ) : (
                            <>
                              <MarkdownContent content={msg.content} compact />
                              <MessageActions
                                content={msg.content}
                                tts={tts}
                                provider={ttsProvider}
                                ttsAvailable={ttsAvailable}
                                compact
                              />
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Divider between history and current session */}
          {hasCurrentMessages && (
            <div className="flex items-center gap-3 py-2 px-1">
              <div className="flex-1 h-px bg-white/[0.08]" />
              <span className="text-[10px] text-zinc-600 font-medium shrink-0">New session</span>
              <div className="flex-1 h-px bg-white/[0.08]" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppShell({ app, opener, headerActions, onMessage, initialMessage, initialConversationId, demo, demoMessages, demoStreaming }: Props) {
  const router = useRouter()
  const clientContext = useClientContext()
  const tts = useTTS()
  const { ttsAvailable } = useIntegrationStatus()

  // ── Current session ────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>(() =>
    demo && demoMessages
      ? demoMessages.map((m, i) => ({ id: `demo-${i}`, role: m.role, content: m.content }))
      : []
  )
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null
  )
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null)
  /** Remaining quota for paid apps — shown as a low-quota warning. */
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null)

  // ── History state ──────────────────────────────────────────────────────────
  //
  // Design:
  //  - historyConvs: paginated list of past conversation metadata (newest first)
  //  - historicMsgMap: loaded message arrays keyed by conversationId
  //  - closedConvIds: sessions the user has individually × closed in expanded view
  //  - historyOpen: whether the whole history panel is expanded
  //  - historyExpanding: true while fetching all messages for expand-all
  //  - hasMore/offset: pagination state for the conversation list
  //  - historyCheckComplete: gate so autoPrompt waits for initial list fetch
  const [historyConvs, setHistoryConvs] = useState<HistoryConv[]>([])
  const [historicMsgMap, setHistoricMsgMap] = useState<Record<string, Message[]>>({})
  const [closedConvIds, setClosedConvIds] = useState<Set<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyExpanding, setHistoryExpanding] = useState(false)
  const [historyListLoading, setHistoryListLoading] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [historyOffset, setHistoryOffset] = useState(HISTORY_PAGE)
  const [historyCheckComplete, setHistoryCheckComplete] = useState(false)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isDeferred = !!app.deferrable
  const isEmpty = messages.length === 0

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Fetch initial conversation list on mount ───────────────────────────────
  useEffect(() => {
    if (demo || !isPersistentApp(app)) {
      setHistoryCheckComplete(true)
      return
    }
    // Fetch one extra to detect whether more pages exist
    fetch(`/api/store/conversations?appId=${encodeURIComponent(app.id)}&limit=${HISTORY_PAGE + 1}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: HistoryConv[]) => {
        // Filter out empty conversations
        const valid = data.filter((c) => c.messageCount > 0)
        if (valid.length > HISTORY_PAGE) {
          setHasMoreHistory(true)
          setHistoryConvs(valid.slice(0, HISTORY_PAGE))
        } else {
          setHasMoreHistory(false)
          setHistoryConvs(valid)
        }
      })
      .catch((err) => console.warn('[AppShell] history conversations fetch failed', err))
      .finally(() => setHistoryCheckComplete(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id])

  // ── Sync demo messages from parent (audio-synced progressive reveal) ────────
  useEffect(() => {
    if (!demo || !demoMessages) return
    setMessages(
      demoMessages.map((m, i) => ({
        id: `demo-${i}`,
        role: m.role,
        content: m.content,
        streaming: m.role === 'assistant' && (demoStreaming ?? false),
      }))
    )
  }, [demo, demoMessages, demoStreaming])

  // ── Toggle history panel (expand-all behavior) ─────────────────────────────
  // On open: loads all session messages in parallel then shows flat.
  // On close: collapses and resets per-session close state.
  const toggleHistory = useCallback(async () => {
    if (historyOpen) {
      setHistoryOpen(false)
      setClosedConvIds(new Set())   // reset individual closes for next open
      return
    }

    // Load messages for any conversations not yet cached
    const unloaded = historyConvs.filter((c) => !historicMsgMap[c.id])
    if (unloaded.length > 0) {
      setHistoryExpanding(true)
      try {
        const results = await Promise.all(
          unloaded.map((c) =>
            fetch(`/api/store/messages?conversationId=${encodeURIComponent(c.id)}&limit=100`)
              .then((r) => r.ok ? r.json() : [])
              .catch(() => [])
          )
        )
        const newMap: Record<string, Message[]> = {}
        unloaded.forEach((conv, i) => {
          const rows = results[i] as Array<{
            id: string; role: string; content: string
            metadata: Record<string, unknown>
          }>
          newMap[conv.id] = rows
            .filter((r) => r.role === 'user' || r.role === 'assistant')
            .map((r) => ({
              id: r.id,
              role: r.role as 'user' | 'assistant',
              content: r.content,
              attachments: Array.isArray(r.metadata?.attachments)
                ? r.metadata.attachments as MessageAttachment[]
                : undefined,
            }))
        })
        setHistoricMsgMap((prev) => ({ ...prev, ...newMap }))
      } catch {
        // silent — show convs without messages
      } finally {
        setHistoryExpanding(false)
      }
    }

    setHistoryOpen(true)
    // Scroll to bottom so user can immediately type or see current messages
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 150)
  }, [historyOpen, historyConvs, historicMsgMap])

  // ── Close a single session in expanded view ────────────────────────────────
  const closeConv = useCallback((id: string) => {
    setClosedConvIds((prev) => new Set([...prev, id]))
  }, [])

  // ── Load older conversations (pagination) ──────────────────────────────────
  const loadMoreHistory = useCallback(async () => {
    if (historyListLoading || !hasMoreHistory) return
    setHistoryListLoading(true)
    try {
      const res = await fetch(
        `/api/store/conversations?appId=${encodeURIComponent(app.id)}&limit=${HISTORY_PAGE + 1}&offset=${historyOffset}`,
      )
      if (!res.ok) return
      const data = (await res.json() as HistoryConv[]).filter((c) => c.messageCount > 0)
      const newConvs = data.length > HISTORY_PAGE ? data.slice(0, HISTORY_PAGE) : data

      // If panel is expanded, also load messages for the new batch
      if (historyOpen && newConvs.length > 0) {
        const results = await Promise.all(
          newConvs.map((c) =>
            fetch(`/api/store/messages?conversationId=${encodeURIComponent(c.id)}&limit=100`)
              .then((r) => r.ok ? r.json() : [])
              .catch(() => [])
          )
        )
        const newMap: Record<string, Message[]> = {}
        newConvs.forEach((conv, i) => {
          const rows = results[i] as Array<{
            id: string; role: string; content: string
            metadata: Record<string, unknown>
          }>
          newMap[conv.id] = rows
            .filter((r) => r.role === 'user' || r.role === 'assistant')
            .map((r) => ({
              id: r.id,
              role: r.role as 'user' | 'assistant',
              content: r.content,
              attachments: Array.isArray(r.metadata?.attachments)
                ? r.metadata.attachments as MessageAttachment[]
                : undefined,
            }))
        })
        setHistoricMsgMap((prev) => ({ ...prev, ...newMap }))
      }

      setHasMoreHistory(data.length > HISTORY_PAGE)
      setHistoryConvs((prev) => [...prev, ...newConvs])
      setHistoryOffset((o) => o + HISTORY_PAGE)
    } catch {
      // silent
    } finally {
      setHistoryListLoading(false)
    }
  }, [app.id, historyListLoading, hasMoreHistory, historyOffset, historyOpen])

  // ── Auto-send initialMessage — gated so history appears first ─────────────
  const initialSent = useRef(false)
  useEffect(() => {
    if (!historyCheckComplete) return
    if (initialMessage && !initialSent.current) {
      initialSent.current = true
      send(initialMessage)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyCheckComplete])

  // ── Back: deep-linked → go back; otherwise clear session; at opener → home
  const handleBack = useCallback(() => {
    if (initialMessage) {
      // Deep-linked from home (via ?q=) — go back to where user came from
      router.back()
    } else if (!isEmpty) {
      abortRef.current?.abort()
      setBusy(false)
      setMessages([])
      setInput('')
      setQueuedMessage(null)
      setConversationId(null)
      setHistoryOpen(false)
      setClosedConvIds(new Set())
    } else {
      router.push('/')
    }
  }, [initialMessage, isEmpty, router])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setBusy(false)
    setQueuedMessage(null)
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1 && m.role === 'assistant'
          ? { ...m, streaming: false }
          : m
      )
    )
  }, [])

  const send = useCallback(async (text: string, pendingAttachments?: MessageAttachment[], contextRefs?: string[]) => {
    if (!text.trim() && (!pendingAttachments || pendingAttachments.length === 0)) return

    if (busy) {
      if (isDeferred) { setQueuedMessage(text.trim()); setInput('') }
      return
    }

    const atts = pendingAttachments ?? []

    // ── Smart router: instant DB answer, no LLM ───────────────────────────
    if (atts.length === 0) {
      try {
        const smartResult = await smartRoute(app.id, text.trim())
        if (smartResult) {
          setInput('')
          setQueuedMessage(null)
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'user', content: text.trim() },
            { id: uid(), role: 'assistant', content: smartResult.content, sourceLabel: smartResult.sourceLabel },
          ])
          if (onMessage) onMessage('assistant', smartResult.content)
          return
        }
      } catch {
        // fall through to LLM
      }
    }

    const enriched = await enrichWithAttachments(text.trim(), atts)
    setInput('')
    setQueuedMessage(null)

    const hint = getLoadingHint(text)
    const userMsg: Message = {
      id: uid(),
      role: 'user',
      content: text.trim(),
      attachments: atts.length > 0 ? atts : undefined,
    }
    const assistantId = uid()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', streaming: true, loadingHint: hint }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setBusy(true)

    const ac = new AbortController()
    abortRef.current = ac

    const apiMessages = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: enriched },
    ]

    try {
      const res = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          ...buildChatBody(app.id, apiMessages, { conversationId, clientContext, contextRefs }),
          messageMetadata: atts.length > 0 ? { attachments: atts } : undefined,
        }),
      })

      // 402 = quota exceeded (paid app limit reached)
      if (res.status === 402) {
        try {
          const quotaData = await res.json() as QuotaExceededData
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId
              ? { ...m, content: '', streaming: false, quotaExceeded: quotaData }
              : m
            )
          )
        } catch {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId
              ? { ...m, content: '', streaming: false, quotaExceeded: { appName: app.name, addonOptions: [], message: 'Monthly limit reached.' } }
              : m
            )
          )
        }
        setBusy(false)
        return
      }

      if (!res.ok || !res.body) throw new Error((await res.text()) || 'Request failed')

      const convId = res.headers.get('X-Conversation-Id')
      if (convId) setConversationId(convId)

      // Track quota remaining for low-quota warnings (paid apps only)
      const remaining = res.headers.get('X-Quota-Remaining')
      if (remaining !== null) setQuotaRemaining(parseInt(remaining, 10))

      let fullContent = ''
      for await (const delta of streamDeltas(res.body)) {
        fullContent += delta
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: m.content + delta } : m)
        )
      }

      if (fullContent && onMessage) onMessage('assistant', fullContent)

      // Check for pending connection actions (email drafts, calendar events)
      const activeConvId = convId ?? conversationId
      if (activeConvId) {
        try {
          const actionsRes = await fetch(`/api/connections/actions?conversationId=${encodeURIComponent(activeConvId)}&status=pending`)
          if (actionsRes.ok) {
            const actions = await actionsRes.json() as Array<{
              id: string; actionType: string; payload: Record<string, unknown>
            }>
            if (actions.length > 0) {
              const opts = actions.flatMap((a) => mapActionToOptions(a))
              if (opts.length > 0) {
                setMessages((prev) =>
                  prev.map((m) => m.id === assistantId ? { ...m, options: opts } : m)
                )
              }
            }
          }
        } catch {
          // Silent — actions UI is non-critical
        }
      }

    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: `⚠ ${msg}`, streaming: false } : m)
      )
    } finally {
      setBusy(false)
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
      )
      // Signal value moment for PWA install prompt
      signalInstallValue()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id, busy, isDeferred, messages, onMessage, conversationId, clientContext])

  useEffect(() => {
    if (!busy && queuedMessage) {
      const msg = queuedMessage; setQueuedMessage(null); send(msg)
    }
  }, [busy, queuedMessage, send])

  const textareaEnabled = isDeferred || !busy
  const hasHistory = historyConvs.length > 0

  return (
    <AppPage gradient={getAppGradient(app.color)}>
      <AppHeader
        title={app.name}
        icon={app.icon}
        onBack={demo ? undefined : handleBack}
        backLabel={initialMessage ? 'Home' : isEmpty ? 'Home' : 'Back'}
        actions={demo ? undefined : headerActions}
      />

      {/* ── Message list ── */}
      {/*
        History is always in this scrollable container — never in the shrink-0
        input bar. This ensures expanding history scrolls within the flex-1
        area and never pushes the layout.
      */}
      <div className={`flex-1 overflow-y-auto overscroll-contain px-4 @lg:px-6 py-4 space-y-4 min-h-0 scrollbar-none ${demo ? 'pointer-events-none' : ''}`}
           role="log" aria-label={`${app.name} conversation`} aria-live="polite">

        {/* History panel — in scroll area when chatting, OR when expanded in empty state */}
        {hasHistory && (!isEmpty || historyOpen) && (
          <HistoryPanel
            convs={historyConvs}
            closedIds={closedConvIds}
            msgMap={historicMsgMap}
            expanding={historyExpanding}
            hasMore={hasMoreHistory}
            loadingMore={historyListLoading}
            open={historyOpen}
            appIcon={app.icon}
            hasCurrentMessages={!isEmpty}
            tts={tts}
            ttsAvailable={ttsAvailable}
            ttsProvider={app.ttsProvider}
            onToggle={toggleHistory}
            onCloseConv={closeConv}
            onLoadMore={loadMoreHistory}
          />
        )}

        {/* Opener — shown in empty state only when history is not expanded */}
        {isEmpty && !historyOpen && opener && (
          <div className="flex flex-col items-center pt-10 pb-6 gap-4 text-center px-4">
            {typeof opener === 'function'
              ? opener((text, contextRefs) => send(text, undefined, contextRefs))
              : opener}
          </div>
        )}

        {/* Current session messages */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mr-2 mt-0.5
                              bg-white/10 border border-white/15">
                {app.icon}
              </div>
            )}
            <div
              className={`
                max-w-[85%] @lg:max-w-[75%] rounded-2xl text-sm leading-relaxed overflow-hidden
                ${msg.role === 'user'
                  ? 'bg-[var(--brand-primary)] text-white rounded-br-sm'
                  : 'bg-white/[0.07] text-zinc-100 border border-white/[0.09] rounded-bl-sm backdrop-blur-sm'
                }
              `}
            >
              {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                  {msg.attachments.map((att) => (
                    <span key={att.path} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg
                                                    bg-white/[0.15] text-[11px] font-medium text-white/80">
                      <FileIcon ext={att.ext} category={att.category as FileCategory} size={11} />
                      <span className="truncate max-w-[120px]">{att.name}</span>
                      <span className="text-white/40">{formatSize(att.size)}</span>
                    </span>
                  ))}
                </div>
              )}

              <div className={`px-4 py-3 ${msg.role === 'user' ? 'whitespace-pre-wrap' : ''}`}>
                {msg.role === 'user' ? (
                  msg.content
                ) : msg.quotaExceeded ? (
                  <QuotaExceeded
                    appName={msg.quotaExceeded.appName}
                    appId={msg.quotaExceeded.appId}
                    outcomeId={msg.quotaExceeded.outcomeId}
                    addonOptions={msg.quotaExceeded.addonOptions}
                    message={msg.quotaExceeded.message}
                    appRoomUrl={msg.quotaExceeded.appRoomUrl}
                    spendLimit={msg.quotaExceeded.spendLimit}
                  />
                ) : msg.content ? (
                  <>
                    <MarkdownContent content={msg.content} compact streaming={msg.streaming} />
                    {msg.streaming && (
                      <span className="inline-block w-[3px] h-4 bg-zinc-300 rounded-sm ml-0.5 animate-pulse" />
                    )}
                    {(!msg.streaming && msg.options && msg.options.length > 0) && (
                      <MessageOptions
                        options={msg.options}
                        resolved={msg.optionsResolved}
                        resultLabel={msg.resultLabel}
                      />
                    )}
                    {(!msg.streaming && msg.content) && (
                      <MessageActions
                        content={msg.content}
                        tts={tts}
                        sourceLabel={msg.sourceLabel}
                        provider={app.ttsProvider}
                        ttsAvailable={ttsAvailable}
                      />
                    )}
                  </>
                ) : msg.streaming ? (
                  <span className="flex items-center gap-2 py-0.5">
                    <span className="inline-flex gap-1 items-center shrink-0">
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-breathe-dot" />
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-breathe-dot [animation-delay:400ms]" />
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-breathe-dot [animation-delay:800ms]" />
                    </span>
                    <span className="text-zinc-500 text-xs font-medium">{msg.loadingHint ?? 'Thinking…'}</span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      {demo ? null : (
      <div className="shrink-0 px-4 @lg:px-6 app-footer-bottom pt-2 border-t border-white/[0.08]">

        {/* History CTA — above input only in empty state, collapsed.
            Clicking it sets historyOpen=true which moves it to the scroll area
            and hides the opener, giving a clean chat-mode transition. */}
        {isEmpty && !historyOpen && hasHistory && (
          <div className="mb-2">
            <HistoryPanel
              convs={historyConvs}
              closedIds={closedConvIds}
              msgMap={historicMsgMap}
              expanding={historyExpanding}
              hasMore={hasMoreHistory}
              loadingMore={historyListLoading}
              open={false}
              appIcon={app.icon}
              hasCurrentMessages={false}
              tts={tts}
              ttsAvailable={ttsAvailable}
              ttsProvider={app.ttsProvider}
              onToggle={toggleHistory}
              onCloseConv={closeConv}
              onLoadMore={loadMoreHistory}
            />
          </div>
        )}

        <ChatInputBar
          value={input}
          onChange={setInput}
          onSend={(text, atts) => send(text, atts)}
          onStop={stop}
          placeholder={busy && isDeferred ? 'Type your next message…' : `Message ${app.name}…`}
          disabled={!textareaEnabled}
          busy={busy}
          appName={app.name}
          above={
            <>
              {quotaRemaining !== null && quotaRemaining > 0 && quotaRemaining <= 5 && (
                <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                  <span className="text-[11px] text-amber-400/80">
                    {quotaRemaining === 1
                      ? `Last ${app.name} action this month`
                      : `${quotaRemaining} ${app.name} actions remaining this month`}
                  </span>
                </div>
              )}
              {queuedMessage && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-[11px] text-zinc-600 shrink-0">Next:</span>
                  <span className="text-[11px] text-zinc-500 truncate flex-1">{queuedMessage}</span>
                  <button onClick={() => setQueuedMessage(null)}
                    className="text-zinc-700 hover:text-zinc-400 transition-colors shrink-0 text-xs">✕</button>
                </div>
              )}
            </>
          }
        />

        {busy && isDeferred && (
          <p className="text-center text-white/20 text-[10px] mt-2 px-4">Working on it — type your next message or come back later</p>
        )}
      </div>
      )}
    </AppPage>
  )
}
