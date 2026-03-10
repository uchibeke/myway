'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Trash2, ToggleLeft, ToggleRight, X } from 'lucide-react'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import { getAppGradient } from '@/lib/design'
import { MarkdownContent } from '@/components/MarkdownContent'

// ─── Types ────────────────────────────────────────────────────────────────────

type CronSchedule = { kind: 'cron'; expr: string; tz?: string }
type EverySchedule = { kind: 'every'; duration: string }
type OnceSchedule  = { kind: 'at'; at: string }
type Schedule = CronSchedule | EverySchedule | OnceSchedule

type CronJob = {
  id: string
  name: string
  description?: string
  enabled: boolean
  createdAtMs: number
  updatedAtMs: number
  schedule: Schedule
  payload: { kind: string; message?: string }
  delivery?: { mode: string; channel: string; to: string }
  state: { lastRunAtMs?: number; nextRunAtMs?: number; lastStatus?: string; lastError?: string }
}

type DeliveryConfig = {
  defaultChannel: string | null
  channels: { id: string; enabled: boolean }[]
  targets: Record<string, string>
  displayNames: Record<string, string>
}

type RunResult = {
  ok: boolean
  status?: string
  summary?: string | null
  error?: string | null
  durationMs?: number | null
  delivered?: boolean
}

// ─── Preset schedules ─────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Every morning at 8am',   cron: '0 8 * * *' },
  { label: 'Every day at noon',      cron: '0 12 * * *' },
  { label: 'Every evening at 7pm',   cron: '0 19 * * *' },
  { label: 'Every Monday morning',   cron: '0 8 * * 1' },
  { label: 'Every Friday at 5pm',    cron: '0 17 * * 5' },
  { label: 'Every hour',             every: '1h' },
  { label: 'Custom…',                custom: true },
]

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  email: 'Email',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function describeSchedule(s: Schedule): string {
  if (s.kind === 'cron') return `Cron: ${s.expr}${s.tz ? ` (${s.tz})` : ''}`
  if (s.kind === 'every') return `Every ${s.duration}`
  return `Once at ${new Date(s.at).toLocaleString()}`
}

function timeAgo(ms: number) {
  const m = Math.floor((Date.now() - ms) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function timeUntil(ms: number) {
  const m = Math.floor((ms - Date.now()) / 60_000)
  if (m <= 0) return 'soon'
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiGet(): Promise<CronJob[]> {
  const res = await fetch('/api/cron')
  const data = await res.json()
  return data.jobs ?? []
}

async function apiCreate(body: object): Promise<CronJob> {
  const res = await fetch('/api/cron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const d = await res.json()
    throw new Error(d.error ?? 'Failed to create job')
  }
  return res.json()
}

async function apiToggle(id: string, enabled: boolean): Promise<void> {
  await fetch(`/api/cron/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

async function apiDelete(id: string): Promise<void> {
  await fetch(`/api/cron/${id}`, { method: 'DELETE' })
}

async function apiRunNow(id: string): Promise<RunResult> {
  const res = await fetch(`/api/cron/${id}/run`, { method: 'POST' })
  return res.json()
}

async function apiGetDelivery(): Promise<DeliveryConfig> {
  try {
    const res = await fetch('/api/cron/delivery')
    return res.json()
  } catch {
    return { defaultChannel: null, channels: [], targets: {}, displayNames: {} }
  }
}

// ─── Run result modal ────────────────────────────────────────────────────────

function RunResultModal({ result, onClose }: { result: RunResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 mb-4 bg-zinc-900 border border-white/[0.10] rounded-2xl
                      overflow-hidden shadow-2xl max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎤</span>
            <span className="text-white font-semibold text-sm">Run Result</span>
            {result.delivered && (
              <span className="text-[10px] bg-green-500/20 text-green-400 rounded px-1.5 py-0.5">sent to Telegram</span>
            )}
            {result.status === 'ok' && !result.delivered && (
              <span className="text-[10px] bg-amber-500/20 text-amber-400 rounded px-1.5 py-0.5">not delivered</span>
            )}
            {result.status === 'error' && (
              <span className="text-[10px] bg-red-500/20 text-red-400 rounded px-1.5 py-0.5">error</span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-4 py-4">
          {result.summary ? (
            <div className="text-sm text-zinc-200">
              <MarkdownContent content={result.summary} compact />
            </div>
          ) : result.error ? (
            <p className="text-red-400 text-sm">{result.error}</p>
          ) : (
            <p className="text-zinc-500 text-sm">Job ran but produced no output.</p>
          )}
        </div>

        {/* Footer */}
        {result.durationMs && (
          <div className="px-4 py-2 border-t border-white/[0.06] shrink-0">
            <p className="text-zinc-600 text-[11px]">Completed in {(result.durationMs / 1000).toFixed(1)}s</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Job card ─────────────────────────────────────────────────────────────────

function JobCard({
  job,
  onToggle,
  onDelete,
}: {
  job: CronJob
  onToggle: () => void
  onDelete: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)

  async function handleDelete() {
    setDeleting(true)
    await apiDelete(job.id)
    onDelete()
  }

  async function handleRunNow() {
    setRunning(true)
    try {
      const result = await apiRunNow(job.id)
      setRunResult(result)
    } catch {
      setRunResult({ ok: false, error: 'Request failed. The job may still be running.' })
    } finally {
      setRunning(false)
    }
  }

  const hasDelivery = !!job.delivery?.channel
  const deliveryLabel = hasDelivery
    ? `${CHANNEL_LABELS[job.delivery!.channel] ?? job.delivery!.channel}`
    : null

  return (
    <>
      <div className={`bg-white/[0.05] border rounded-2xl p-4 backdrop-blur-sm transition-all ${
        job.enabled ? 'border-white/[0.10]' : 'border-white/[0.05] opacity-60'
      }`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-red-500/15 rounded-xl flex items-center justify-center text-xl shrink-0">
            🎤
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-sm truncate">{job.name}</span>
              {!job.enabled && (
                <span className="text-[10px] bg-white/10 text-zinc-400 rounded px-1.5 py-0.5">paused</span>
              )}
            </div>
            <div className="text-zinc-400 text-xs mt-0.5">{describeSchedule(job.schedule)}</div>
            {deliveryLabel && (
              <div className="text-zinc-500 text-[11px] mt-0.5">Delivers to {deliveryLabel}</div>
            )}
            {!hasDelivery && (
              <div className="text-amber-500/60 text-[11px] mt-0.5">No delivery channel configured</div>
            )}
            {job.description && (
              <div className="text-zinc-500 text-xs mt-0.5 truncate">{job.description}</div>
            )}
            <div className="flex gap-3 mt-1.5 text-zinc-600 text-[11px]">
              {job.state?.lastRunAtMs && (
                <span>
                  Last: {timeAgo(job.state.lastRunAtMs)}
                  {job.state.lastStatus === 'error' && (
                    <span className="text-red-500/60 ml-1" title={job.state.lastError}>failed</span>
                  )}
                </span>
              )}
              {job.state?.nextRunAtMs && job.enabled && (
                <span>Next: {timeUntil(job.state.nextRunAtMs)}</span>
              )}
            </div>
          </div>

          <button
            onClick={onToggle}
            className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            title={job.enabled ? 'Disable' : 'Enable'}
          >
            {job.enabled
              ? <ToggleRight size={22} className="text-red-400" />
              : <ToggleLeft size={22} />
            }
          </button>
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
          <button
            onClick={handleRunNow}
            disabled={running}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded-lg hover:bg-white/10 disabled:opacity-40"
          >
            <Play size={11} />
            {running ? 'Running…' : 'Run now'}
          </button>

          <div className="flex-1" />

          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.07] disabled:opacity-40"
          >
            <Trash2 size={11} />
            {deleting ? 'Removing…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Run result modal */}
      {runResult && (
        <RunResultModal result={runResult} onClose={() => setRunResult(null)} />
      )}
    </>
  )
}

// ─── Add job form ─────────────────────────────────────────────────────────────

const DEFAULT_MESSAGE = 'Roast me based on whatever context you have — my recent files, my decisions, my life choices. Be specific and savage.'

function AddJobForm({
  onAdd,
  onCancel,
  deliveryConfig,
}: {
  onAdd: (job: CronJob) => void
  onCancel: () => void
  deliveryConfig: DeliveryConfig | null
}) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [presetIdx, setPresetIdx] = useState(0)
  const [customCron, setCustomCron] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Delivery defaults from user's config
  const defaultChannel = deliveryConfig?.defaultChannel ?? null
  const enabledChannels = deliveryConfig?.channels.filter(c => c.enabled) ?? []
  const [channel, setChannel] = useState(defaultChannel ?? 'telegram')
  const [target, setTarget] = useState(deliveryConfig?.targets[defaultChannel ?? 'telegram'] ?? '')

  // Update target when channel changes
  useEffect(() => {
    if (deliveryConfig?.targets[channel]) {
      setTarget(deliveryConfig.targets[channel])
    }
  }, [channel, deliveryConfig])

  const preset = PRESETS[presetIdx]

  async function handleSave() {
    if (!name.trim()) { setError('Give this schedule a name'); return }

    setSaving(true)
    setError('')
    try {
      const body: Record<string, string | boolean> = { name: name.trim(), message: message.trim() }

      if ('cron' in preset && preset.cron) {
        body.cron = preset.cron
      } else if ('every' in preset && preset.every) {
        body.every = preset.every
      } else {
        if (!customCron.trim()) { setError('Enter a cron expression'); setSaving(false); return }
        body.cron = customCron.trim()
      }

      // Add delivery config
      if (channel && target.trim()) {
        body.channel = channel
        body.to = target.trim()
      }

      const job = await apiCreate(body)
      onAdd(job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 space-y-4 backdrop-blur-sm">
      <h3 className="text-white font-semibold text-sm">New scheduled roast</h3>

      <div>
        <label className="text-zinc-400 text-xs mb-1.5 block">Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Morning roast"
          className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600"
        />
      </div>

      <div>
        <label className="text-zinc-400 text-xs mb-1.5 block">Schedule</label>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => setPresetIdx(i)}
              className={`text-left px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                presetIdx === i
                  ? 'bg-red-500/20 border border-red-500/40 text-red-300'
                  : 'bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:border-white/15 hover:text-zinc-300'
              }`}
            >
              {'label' in p ? p.label : ''}
            </button>
          ))}
        </div>

        {PRESETS[presetIdx] && 'custom' in PRESETS[presetIdx] && (
          <input
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
            placeholder="e.g. 0 9 * * 1-5 (weekdays 9am)"
            className="mt-2 w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600 font-mono"
          />
        )}
      </div>

      {/* Delivery channel */}
      <div>
        <label className="text-zinc-400 text-xs mb-1.5 block">Deliver to</label>
        <div className="flex gap-2">
          {(enabledChannels.length > 0
            ? enabledChannels
            : [{ id: 'telegram', enabled: true }]
          ).map(c => (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                channel === c.id
                  ? 'bg-red-500/20 border border-red-500/40 text-red-300'
                  : 'bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:border-white/15 hover:text-zinc-300'
              }`}
            >
              {CHANNEL_LABELS[c.id] ?? c.id}
            </button>
          ))}
        </div>
        {channel === 'telegram' && target.trim() && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl">
            <span className="text-white text-sm">{deliveryConfig?.displayNames?.telegram ?? target}</span>
            <span className="text-zinc-600 text-[11px] ml-auto">Telegram</span>
          </div>
        )}
        {channel === 'telegram' && !target.trim() && (
          <input
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder="Telegram chat ID"
            className="mt-2 w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600 font-mono"
          />
        )}
        {channel === 'email' && (
          <p className="text-zinc-600 text-[11px] mt-1.5">Email delivery uses your connected Gmail account.</p>
        )}
        {!target.trim() && (
          <p className="text-amber-500/50 text-[11px] mt-1">A delivery target is required for scheduled roasts to reach you.</p>
        )}
      </div>

      <div>
        <label className="text-zinc-400 text-xs mb-1.5 block">Roast prompt</label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={3}
          className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 resize-none placeholder:text-zinc-600 leading-relaxed"
        />
        <p className="text-zinc-600 text-[11px] mt-1">This is sent to OpenClaw as the roast prompt when the job fires.</p>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.10] text-zinc-400 text-sm font-medium hover:text-zinc-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
        >
          {saving ? 'Scheduling…' : 'Schedule it'}
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RoastSchedulePage() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfig | null>(null)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const all = await apiGet()
      setJobs(all)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  // Fetch delivery config once on mount
  useEffect(() => {
    apiGetDelivery().then(setDeliveryConfig)
  }, [])

  async function handleToggle(job: CronJob) {
    await apiToggle(job.id, !job.enabled)
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, enabled: !j.enabled } : j))
  }

  function handleDelete(id: string) {
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  function handleAdd(job: CronJob) {
    setJobs(prev => [job, ...prev])
    setShowForm(false)
  }

  const enabledCount = jobs.filter(j => j.enabled).length

  return (
    <AppPage gradient={getAppGradient('bg-red-500')}>

      {/* Header */}
      <AppHeader
        title="Scheduled Roasts"
        icon="⏰"
        backHref="/apps/roast"
        backLabel="Roast"
        actions={
          !showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/10"
            >
              <Plus size={15} />
              <span className="text-xs font-medium">New</span>
            </button>
          ) : undefined
        }
      />

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">

        {/* Stats */}
        {jobs.length > 0 && (
          <div className="flex gap-3">
            {[
              { value: jobs.length,              label: 'total',  color: 'text-white' },
              { value: enabledCount,             label: 'active', color: 'text-red-400' },
              { value: jobs.length - enabledCount, label: 'paused', color: 'text-zinc-500' },
            ].map(({ value, label, color }) => (
              <div key={label} className="flex-1 bg-white/[0.05] rounded-xl p-3 text-center border border-white/[0.08]">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-zinc-600 text-[11px] mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        {showForm && (
          <AddJobForm
            onAdd={handleAdd}
            onCancel={() => setShowForm(false)}
            deliveryConfig={deliveryConfig}
          />
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-12 text-zinc-500 text-sm">Loading schedules…</div>
        )}

        {/* Empty state */}
        {!loading && jobs.length === 0 && !showForm && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="text-5xl">⏰</div>
            <div>
              <p className="text-white font-semibold">No scheduled roasts</p>
              <p className="text-zinc-500 text-sm mt-1 max-w-xs">
                Set up daily roasts delivered to Telegram — perfect for a humbling morning routine.
              </p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-500 rounded-2xl text-white font-semibold text-sm transition-colors"
            >
              <Plus size={15} />
              Schedule my first roast
            </button>
          </div>
        )}

        {/* Job list */}
        {!loading && jobs.map(job => (
          <JobCard
            key={job.id}
            job={job}
            onToggle={() => handleToggle(job)}
            onDelete={() => handleDelete(job.id)}
          />
        ))}

      </div>

      {/* Footer hint */}
      <div className="shrink-0 px-4 app-footer-bottom pt-2 border-t border-white/[0.06]">
        <p className="text-white/20 text-[11px] text-center">
          Schedules run via OpenClaw cron · delivered to your configured channel
        </p>
      </div>

    </AppPage>
  )
}
