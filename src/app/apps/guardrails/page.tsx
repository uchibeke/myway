'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  Activity, Shield, ShieldOff, Power,
  RefreshCw, Loader2, AlertCircle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, ExternalLink, Wifi, WifiOff,
  Plus, Pencil, Trash2, Save, X,
} from 'lucide-react'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import SegmentedControl, { type SegmentedTab } from '@/components/SegmentedControl'
import { MarkdownContent } from '@/components/MarkdownContent'
import KillSwitch from '@/components/KillSwitch'
import { type PassportStatus } from '@/components/PassportBadge'
import { getApp, getSortedAppTabs, type AppTabDef } from '@/lib/apps'
import { getAppGradient } from '@/lib/design'

// ─── App & Tab Setup ──────────────────────────────────────────────────────────

const app = getApp('guardrails')!

const TAB_ICON_MAP: Record<string, React.ReactNode> = {
  'activity': <Activity size={11} />,
  'shield':   <Shield   size={11} />,
  'power':    <Power    size={11} />,
}

function resolveTabIcons(tabs: AppTabDef[]): SegmentedTab[] {
  return getSortedAppTabs(tabs).map((t) => ({
    id:    t.id,
    label: t.label,
    icon:  TAB_ICON_MAP[t.icon],
  }))
}

const TABS       = resolveTabIcons(app.tabs ?? [])
const VALID_TABS = new Set(TABS.map((t) => t.id))
type TabId       = string

// ─── Types ────────────────────────────────────────────────────────────────────

type GuardrailEvent = {
  id:        string
  timestamp: number
  tool:      string
  allowed:   boolean
  policy:    string
  code:      string
  context:   string
}

type EventsStats = {
  total:   number
  blocked: number
  allowed: number
  tools:   string[]
}

type EventsResponse = {
  items:  GuardrailEvent[]
  total:  number
  limit:  number
  offset: number
  stats:  EventsStats
}

type AllowedFilter = 'all' | 'blocked' | 'allowed'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('en-CA', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function timeAgo(epoch: number): string {
  const s = Math.floor(Date.now() / 1000) - epoch
  if (s < 5)     return 'just now'
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ─── Event Row ────────────────────────────────────────────────────────────────

function EventRow({ ev, fresh = false }: { ev: GuardrailEvent; fresh?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const shortContext = ev.context.length > 80 ? ev.context.slice(0, 80) + '…' : ev.context

  return (
    <div
      className={`
        border-b border-zinc-800/60 last:border-b-0
        transition-all duration-500
        ${fresh ? 'bg-zinc-700/20 animate-pulse-once' : 'bg-transparent'}
      `}
    >
      <div
        className="flex items-start gap-3 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Allow/Block badge */}
        <div className="flex-shrink-0 mt-0.5">
          {ev.allowed
            ? <CheckCircle2 size={14} className="text-zinc-600" />
            : <XCircle      size={14} className="text-red-500" />
          }
        </div>

        {/* Tool + context */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`
              text-xs font-mono font-medium
              ${ev.allowed ? 'text-zinc-300' : 'text-red-400'}
            `}>
              {ev.tool}
            </span>
            {!ev.allowed && (
              <span className="bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-medium">
                BLOCKED
              </span>
            )}
          </div>
          <p className="text-zinc-500 text-xs truncate font-mono">{shortContext}</p>
        </div>

        {/* Time */}
        <div className="flex-shrink-0 text-right">
          <p className="text-zinc-500 text-xs">{timeAgo(ev.timestamp)}</p>
          {expanded ? <ChevronUp size={12} className="text-zinc-600 mt-1 ml-auto" /> : <ChevronDown size={12} className="text-zinc-600 mt-1 ml-auto" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 text-xs border-t border-zinc-800/40 overflow-hidden min-w-0">
          {/* Metadata — stacked key-value pairs that never overflow */}
          <div className="space-y-1.5 pt-2.5 pb-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-zinc-600 flex-shrink-0 w-10">ID</span>
              <span className="text-zinc-400 font-mono truncate min-w-0">{ev.id}</span>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-zinc-600 flex-shrink-0 w-10">Time</span>
              <span className="text-zinc-400 min-w-0">{fmtTime(ev.timestamp)}</span>
            </div>
            {ev.policy && (
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-zinc-600 flex-shrink-0 w-10">Policy</span>
                <span className="text-zinc-400 font-mono truncate min-w-0">{ev.policy}</span>
              </div>
            )}
            {ev.code && (
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-zinc-600 flex-shrink-0 w-10">Code</span>
                <span className={`font-mono min-w-0 ${ev.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                  {ev.code}
                </span>
              </div>
            )}
          </div>

          {/* Context — code block, wrapping long lines */}
          {ev.context && (
            <div className="mt-2 min-w-0 [&_pre]:!whitespace-pre-wrap [&_pre]:!break-words [&_pre]:!m-0 [&_code]:!whitespace-pre-wrap [&_code]:!break-words">
              <MarkdownContent content={`\`\`\`bash\n${ev.context}\n\`\`\``} compact />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Events Tab ───────────────────────────────────────────────────────────────

function EventsTab() {
  const [events, setEvents]       = useState<GuardrailEvent[]>([])
  const [stats, setStats]         = useState<EventsStats | null>(null)
  const [loading, setLoading]     = useState(true)
  const [syncing, setSyncing]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [filter, setFilter]       = useState<AllowedFilter>('all')
  const [toolFilter, setToolFilter] = useState<string>('')
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'waiting' | 'error'>('connecting')
  const [freshIds, setFreshIds]   = useState<Set<string>>(new Set())
  const eventSourceRef            = useRef<EventSource | null>(null)

  const fetchEvents = useCallback(async (filterOverride?: AllowedFilter, toolOverride?: string) => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: '100' })
    const f = filterOverride ?? filter
    const t = toolOverride !== undefined ? toolOverride : toolFilter
    if (f === 'blocked') params.set('allowed', '0')
    if (f === 'allowed') params.set('allowed', '1')
    if (t) params.set('tool', t)

    try {
      const res = await fetch(`/api/aport/events?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: EventsResponse = await res.json()
      setEvents(data.items)
      setStats(data.stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
    } finally {
      setLoading(false)
    }
  }, [filter, toolFilter])

  const syncLog = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/aport/sync', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchEvents()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [fetchEvents])

  // Initial load: sync then fetch
  useEffect(() => {
    syncLog()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // SSE live feed
  useEffect(() => {
    const es = new EventSource('/api/aport/events/stream')
    eventSourceRef.current = es

    es.onopen = () => setStreamStatus('live')
    es.onerror = () => setStreamStatus('error')

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.type === 'waiting') { setStreamStatus('waiting'); return }
        if (payload.type === 'heartbeat') { setStreamStatus('live'); return }
        if (payload.type === 'event' && payload.event) {
          const ev: GuardrailEvent = payload.event
          // Apply current filter
          const matchesFilter =
            filter === 'all' ||
            (filter === 'blocked' && !ev.allowed) ||
            (filter === 'allowed' && ev.allowed)
          const matchesTool = !toolFilter || ev.tool === toolFilter

          if (matchesFilter && matchesTool) {
            setEvents((prev) => {
              if (prev.some((e) => e.id === ev.id)) return prev
              return [ev, ...prev]
            })
            setFreshIds((prev) => new Set([...prev, ev.id]))
            setTimeout(() => {
              setFreshIds((prev) => {
                const next = new Set(prev)
                next.delete(ev.id)
                return next
              })
            }, 3000)
          }
          // Refresh stats
          setStats((prev) => prev ? {
            ...prev,
            total:   prev.total + 1,
            blocked: prev.blocked + (ev.allowed ? 0 : 1),
            allowed: prev.allowed + (ev.allowed ? 1 : 0),
            tools:   prev.tools.includes(ev.tool) ? prev.tools : [...prev.tools, ev.tool].sort(),
          } : prev)
        }
      } catch { /* ignore parse errors */ }
    }

    return () => es.close()
  }, [filter, toolFilter])

  const handleFilterChange = (f: AllowedFilter) => {
    setFilter(f)
    fetchEvents(f, toolFilter)
  }

  const handleToolFilter = (t: string) => {
    setToolFilter(t)
    fetchEvents(filter, t)
  }

  const filterTabs: SegmentedTab[] = [
    { id: 'all',     label: 'All',     icon: null },
    { id: 'blocked', label: 'Blocked', icon: <XCircle size={10} /> },
    { id: 'allowed', label: 'Allowed', icon: <CheckCircle2 size={10} /> },
  ]

  return (
    <>
      {/* Stats strip — compact, inline with filter controls */}
      {stats && (
        <div className="flex items-center gap-2 py-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-shrink overflow-hidden">
            <div className="flex items-center gap-1 flex-shrink-0">
              <Activity size={11} className="text-zinc-600" />
              <span className="text-zinc-400 text-[11px] tabular-nums">{stats.total.toLocaleString()}</span>
            </div>
            {stats.blocked > 0 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <XCircle size={11} className="text-red-500/70" />
                <span className="text-red-400/80 text-[11px] tabular-nums">{stats.blocked}</span>
              </div>
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              <CheckCircle2 size={11} className="text-zinc-600" />
              <span className="text-zinc-500 text-[11px] tabular-nums">{stats.allowed}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            {stats.tools.length > 0 && (
              <select
                value={toolFilter}
                onChange={(e) => handleToolFilter(e.target.value)}
                className="bg-zinc-800/80 border border-zinc-700/60 text-zinc-400 text-[10px] rounded-lg px-1.5 py-1 focus:outline-none focus:border-zinc-600 max-w-[100px]"
              >
                <option value="">All tools</option>
                {stats.tools.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            <button
              onClick={syncLog}
              disabled={syncing}
              title="Sync from audit log"
              className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            </button>
            {streamStatus === 'live'
              ? <Wifi size={9} className="text-emerald-500/80" />
              : streamStatus === 'error'
                ? <WifiOff size={9} className="text-red-500/60" />
                : streamStatus === 'waiting'
                  ? <WifiOff size={9} className="text-zinc-600" />
                  : <Loader2 size={9} className="text-zinc-600 animate-spin" />
            }
          </div>
        </div>
      )}

      {/* Filter tabs — full width, own row */}
      <div className="pb-3">
        <SegmentedControl
          tabs={filterTabs}
          value={filter}
          onChange={(id) => handleFilterChange(id as AllowedFilter)}
          flush
        />
      </div>

      {/* Event list — flows naturally within the shared scrollable area */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-2 text-zinc-500 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading events…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 py-3 text-red-400 text-sm">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
      {!loading && !error && events.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Activity size={32} className="text-zinc-700 mb-3" />
          <p className="text-zinc-400 text-sm font-medium mb-1">No events yet</p>
          <p className="text-zinc-600 text-xs max-w-[260px] leading-relaxed">
            Guardrail events appear here as your agent runs commands, sends messages,
            or takes any tool action.
          </p>
        </div>
      )}
      {!loading && events.map((ev) => (
        <EventRow key={ev.id} ev={ev} fresh={freshIds.has(ev.id)} />
      ))}
    </>
  )
}

// ─── Passport Tab ─────────────────────────────────────────────────────────────

// ─── Passport Types ──────────────────────────────────────────────────────────

type StoredPassport = {
  id: number
  appId: string
  agentId: string
  label: string | null
  createdAt: number
  updatedAt: number
}

type PassportResponse = {
  current: PassportStatus
  passports: StoredPassport[]
}

// ─── Passport Editor Form ────────────────────────────────────────────────────

function PassportForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: { appId: string; agentId: string; label: string }
  onSave: (data: { appId: string; agentId: string; apiKey: string; label: string }) => void
  onCancel: () => void
  saving: boolean
}) {
  const [appId, setAppId] = useState(initial?.appId ?? 'default')
  const [agentId, setAgentId] = useState(initial?.agentId ?? '')
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState(initial?.label ?? '')

  const isEdit = !!initial

  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/80 p-4 space-y-3">
      <h4 className="text-white text-sm font-medium">{isEdit ? 'Edit Passport' : 'Add Passport'}</h4>

      <div>
        <label className="text-zinc-500 text-[11px] block mb-1">App Scope</label>
        <select
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          disabled={isEdit}
          className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-1 focus:ring-zinc-600 disabled:opacity-50"
        >
          <option value="default">Default (all apps)</option>
          <option value="chat">Chat</option>
          <option value="forge">Forge</option>
          <option value="brief">Brief</option>
          <option value="outreach">Outreach</option>
        </select>
      </div>

      <div>
        <label className="text-zinc-500 text-[11px] block mb-1">Agent ID</label>
        <input
          type="text"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="ap_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-600 placeholder:text-zinc-600"
        />
      </div>

      <div>
        <label className="text-zinc-500 text-[11px] block mb-1">
          API Key <span className="text-zinc-600">(optional)</span>
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="aport_key_... (optional)"
          className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-600 placeholder:text-zinc-600"
        />
      </div>

      <div>
        <label className="text-zinc-500 text-[11px] block mb-1">Label (optional)</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Main passport, Production"
          className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-1 focus:ring-zinc-600 placeholder:text-zinc-600"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            if (!agentId.trim()) return
            onSave({ appId, agentId: agentId.trim(), apiKey: apiKey.trim(), label: label.trim() })
          }}
          disabled={saving || !agentId.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 rounded-lg text-white text-xs font-medium transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {isEdit ? 'Update' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 text-xs transition-colors"
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Passport Tab ────────────────────────────────────────────────────────────

function PassportTab() {
  const [data, setData] = useState<PassportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [editing, setEditing] = useState<StoredPassport | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/aport/passport')
      .then((r) => r.json())
      .then((d: PassportResponse) => setData(d))
      .catch(() => setData({ current: { configured: false }, passports: [] }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(form: { appId: string; agentId: string; apiKey: string; label: string }) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/aport/passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          appId: form.appId,
          agentId: form.agentId,
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          label: form.label || undefined,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Failed to save')

      setFlash(editing ? 'Passport updated' : 'Passport added')
      setEditing(null)
      setAdding(false)
      load()
      setTimeout(() => setFlash(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(appId: string) {
    if (!confirm(`Remove the ${appId} passport?`)) return
    try {
      const res = await fetch('/api/aport/passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', appId }),
      })
      if (!res.ok) throw new Error('Failed to delete')
      setFlash('Passport removed')
      load()
      setTimeout(() => setFlash(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-500">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  const p = data?.current ?? { configured: false }
  const passports = data?.passports ?? []
  const isActive = p.configured && p.status === 'active'

  return (
    <div className="space-y-4 min-w-0">
      {/* Flash */}
      {flash && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/15 border border-emerald-500/25 rounded-xl animate-in fade-in duration-300">
          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          <span className="text-emerald-300 text-sm">{flash}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle size={13} className="text-red-400 shrink-0" />
          <span className="text-red-300 text-xs">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-zinc-500 hover:text-zinc-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Current status hero */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 overflow-hidden min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <div className={`
            w-11 h-11 rounded-xl flex items-center justify-center
            ${isActive ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' : 'bg-zinc-800 ring-1 ring-zinc-700/50'}
          `}>
            {isActive
              ? <Shield size={20} className="text-emerald-400" />
              : <ShieldOff size={20} className="text-zinc-500" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-medium text-sm">APort Passport</h3>
            <p className={`text-xs mt-0.5 ${isActive ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {!p.configured ? 'Not configured' : p.status === 'active' ? 'Active' : p.status === 'suspended' ? 'Suspended' : p.status === 'revoked' ? 'Revoked' : 'Unknown'}
              {p.assuranceLevel && <span className="text-zinc-500 ml-1.5">{p.assuranceLevel}</span>}
            </p>
          </div>
        </div>

        {!p.configured && passports.length === 0 && (
          <div className="rounded-lg bg-zinc-800/50 p-3.5">
            <p className="text-zinc-400 text-xs leading-relaxed mb-2">
              No passport found. Add one below or install APort for local guardrails.
            </p>
            <a
              href="https://github.com/aporthq/aport-agent-guardrails"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white transition-colors"
            >
              <ExternalLink size={11} />
              Install aport-agent-guardrails
            </a>
          </div>
        )}

        {p.error && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 p-3">
            <div className="flex items-center gap-2">
              <AlertCircle size={13} className="text-amber-400 flex-shrink-0" />
              <p className="text-amber-400 text-xs">{p.error}</p>
            </div>
          </div>
        )}

        {p.configured && !p.error && (
          <>
            <div className="space-y-2.5">
              {p.passportId && (
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="text-zinc-500 text-[11px] flex-shrink-0 w-11">ID</span>
                  <span className="text-zinc-300 text-[11px] font-mono truncate min-w-0">{p.passportId}</span>
                </div>
              )}
              {p.ownerId && (
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="text-zinc-500 text-[11px] flex-shrink-0 w-11">Owner</span>
                  <span className="text-zinc-300 text-[11px] truncate min-w-0">{p.ownerId}</span>
                </div>
              )}
              {p.kind && (
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="text-zinc-500 text-[11px] flex-shrink-0 w-11">Kind</span>
                  <span className="text-zinc-300 text-[11px] capitalize">{p.kind}</span>
                </div>
              )}
              {p.specVersion && (
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="text-zinc-500 text-[11px] flex-shrink-0 w-11">Spec</span>
                  <span className="text-zinc-300 text-[11px] font-mono">{p.specVersion}</span>
                </div>
              )}
              {p.mode && (
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="text-zinc-500 text-[11px] flex-shrink-0 w-11">Mode</span>
                  <span className="text-zinc-300 text-[11px] capitalize">{p.mode === 'hosted' ? 'Hosted (APort API)' : p.mode === 'api' ? 'API (local passport)' : 'Local (file)'}</span>
                </div>
              )}
            </div>

            {p.capabilities && p.capabilities.length > 0 && (
              <div className="mt-4 pt-3 border-t border-zinc-800/60">
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center justify-between w-full text-left group"
                >
                  <span className="text-zinc-500 text-[11px]">
                    {p.capabilities.length} capabilities
                  </span>
                  {showDetails
                    ? <ChevronUp size={12} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                    : <ChevronDown size={12} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  }
                </button>
                {showDetails && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {p.capabilities.map((c) => (
                      <span
                        key={c.id}
                        className="bg-zinc-800/80 text-zinc-400 px-2 py-1 rounded-md text-[10px] font-mono border border-zinc-700/40"
                      >
                        {c.id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Stored passports list */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-zinc-300 text-xs font-medium">Saved Passports</h4>
          {!adding && !editing && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 text-[11px] transition-colors"
            >
              <Plus size={11} />
              Add
            </button>
          )}
        </div>

        {passports.length === 0 && !adding && (
          <p className="text-zinc-600 text-[11px]">
            No passports stored. Add one to enable hosted APort verification.
          </p>
        )}

        {/* Existing passport entries */}
        {passports.map((pp) => (
          <div
            key={pp.appId}
            className="flex items-center gap-3 py-2.5 border-b border-zinc-800/40 last:border-0"
          >
            <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center">
              <Shield size={14} className="text-zinc-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white text-xs font-medium">
                  {pp.appId === 'default' ? 'Default' : pp.appId}
                </span>
                {pp.label && (
                  <span className="text-zinc-600 text-[10px]">{pp.label}</span>
                )}
              </div>
              <span className="text-zinc-500 text-[10px] font-mono truncate block">{pp.agentId}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => { setEditing(pp); setAdding(false) }}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Edit"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => handleDelete(pp.appId)}
                className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        {/* Add/Edit form */}
        {(adding || editing) && (
          <div className="mt-3">
            <PassportForm
              initial={editing ? { appId: editing.appId, agentId: editing.agentId, label: editing.label ?? '' } : undefined}
              onSave={handleSave}
              onCancel={() => { setAdding(false); setEditing(null) }}
              saving={saving}
            />
          </div>
        )}
      </div>

      {/* About section */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
        <h4 className="text-zinc-400 text-xs font-medium mb-2">About APort Guardrails</h4>
        <p className="text-zinc-500 text-[11px] leading-relaxed mb-3">
          APort evaluates every agent tool call against your passport's policy before execution.
          Full audit trail, rate limits, and the ability to block any action class.
        </p>
        <a
          href="https://github.com/aporthq/aport-agent-guardrails"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ExternalLink size={11} />
          aport-agent-guardrails on GitHub
        </a>
      </div>
    </div>
  )
}

// ─── Kill Switch Tab ──────────────────────────────────────────────────────────

function KillSwitchTab() {
  return <KillSwitch />
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function GuardrailsPageInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const gradient     = getAppGradient(app.color)

  const rawTab   = searchParams.get('tab') ?? ''
  const activeTab: TabId = VALID_TABS.has(rawTab) ? rawTab : 'events'

  const handleTabChange = (id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', id)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const tabContent = (() => {
    switch (activeTab) {
      case 'passport':   return <PassportTab />
      case 'killswitch': return <KillSwitchTab />
      default:           return <EventsTab />
    }
  })()

  return (
    <AppPage gradient={gradient}>
      <AppHeader title={app.name} icon={app.icon} backHref="/" />
      <SegmentedControl tabs={TABS} value={activeTab} onChange={handleTabChange} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 min-w-0">
        {tabContent}
      </div>
    </AppPage>
  )
}

export default function GuardrailsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full text-zinc-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    }>
      <GuardrailsPageInner />
    </Suspense>
  )
}
