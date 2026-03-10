'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  RefreshCw, Unplug, Plug, AlertCircle, CheckCircle2,
  Loader2, User, Info, ExternalLink, Clock,
  Plus, Play, Trash2, ToggleLeft, ToggleRight, X,
  BarChart2, LogOut,
} from 'lucide-react'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import SensitiveText from '@/components/SensitiveText'
import SegmentedControl from '@/components/SegmentedControl'
import { getAppGradient } from '@/lib/design'
import { MarkdownContent } from '@/components/MarkdownContent'
import { getLiveApps, getAmbientApps } from '@/lib/apps'
import { getSortedTabs, type SettingsTabDef } from '@/lib/settings-tabs'
import { timeAgo } from '@/lib/format'

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'syncing'

type ConnectionDef = {
  id: string
  name: string
  icon: string
  color: string
  description: string
  dataTypes: string[]
  authType: string
}

type Connection = {
  id: string
  provider: string
  status: ConnectionStatus
  connectedAt: number | null
  lastSyncAt: number | null
  error: string | null
  createdAt: number
  updatedAt: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: ConnectionStatus): string {
  switch (status) {
    case 'connected': return 'text-emerald-400'
    case 'syncing': return 'text-blue-400'
    case 'error': return 'text-red-400'
    case 'disconnected': return 'text-zinc-500'
  }
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected': return 'Connected'
    case 'syncing': return 'Syncing'
    case 'error': return 'Error'
    case 'disconnected': return 'Disconnected'
  }
}

function StatusIcon({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case 'connected': return <CheckCircle2 size={14} className="text-emerald-400" />
    case 'syncing': return <Loader2 size={14} className="text-blue-400 animate-spin" />
    case 'error': return <AlertCircle size={14} className="text-red-400" />
    case 'disconnected': return <Unplug size={14} className="text-zinc-500" />
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchConnections(): Promise<{ connections: Connection[]; definitions: ConnectionDef[] }> {
  const res = await fetch('/api/connections')
  if (!res.ok) throw new Error('Failed to load connections')
  return res.json()
}

async function startAuth(definitionId: string): Promise<string> {
  const res = await fetch('/api/connections/auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definitionId }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error ?? 'Failed to start auth')
  }
  const data = await res.json()
  return data.url
}

async function triggerSync(connectionId: string): Promise<void> {
  const res = await fetch(`/api/connections/${connectionId}/sync`, { method: 'POST' })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error ?? 'Sync failed')
  }
}

async function disconnectApi(connectionId: string): Promise<void> {
  const res = await fetch(`/api/connections/${connectionId}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error ?? 'Disconnect failed')
  }
}

// ─── Tab Registry ────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  plug: <Plug size={11} />,
  user: <User size={11} />,
  clock: <Clock size={11} />,
  info: <Info size={11} />,
}

function resolveSettingsTabs(tabs: SettingsTabDef[]) {
  return tabs.map(t => ({ id: t.id, label: t.label, icon: ICON_MAP[t.icon] }))
}

// ─── Connection Card ─────────────────────────────────────────────────────────

function ConnectionCard({
  def,
  connection,
  onSync,
  onDisconnect,
  onConnect,
}: {
  def: ConnectionDef
  connection: Connection | null
  onSync: () => void
  onDisconnect: () => void
  onConnect: () => void
}) {
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const isConnected = connection && (connection.status === 'connected' || connection.status === 'syncing' || connection.status === 'error')

  async function handleSync() {
    setSyncing(true)
    try {
      await triggerSync(connection!.id)
    } catch {
      // Error shown via re-fetch
    } finally {
      setSyncing(false)
      onSync()
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await disconnectApi(connection!.id)
    } catch {
      // Error shown via re-fetch
    } finally {
      setDisconnecting(false)
      onDisconnect()
    }
  }

  return (
    <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
      {/* Header row */}
      <div className="flex items-start gap-3.5">
        <div className="w-11 h-11 bg-white/[0.08] rounded-xl flex items-center justify-center text-xl shrink-0">
          {def.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-[15px]">{def.name}</span>
            {connection && <StatusIcon status={connection.status} />}
          </div>
          <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">{def.description}</p>
        </div>
      </div>

      {/* Status details */}
      {connection && isConnected && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Status</span>
            <span className={statusColor(connection.status)}>{statusLabel(connection.status)}</span>
          </div>

          {connection.lastSyncAt && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Last sync</span>
              <span className="text-zinc-400">{timeAgo(connection.lastSyncAt)}</span>
            </div>
          )}

          {connection.connectedAt && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Connected</span>
              <span className="text-zinc-400">{timeAgo(connection.connectedAt)}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Data</span>
            <div className="flex gap-1.5">
              {def.dataTypes.map((dt) => (
                <span key={dt} className="bg-white/[0.08] text-zinc-400 text-[10px] px-2 py-0.5 rounded-full">
                  {dt.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>

          {connection.error && (
            <div className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <div className="flex items-start gap-2">
                <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-300 text-xs leading-relaxed">{connection.error}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-3 mt-1 border-t border-white/[0.06]">
            <button
              onClick={handleSync}
              disabled={syncing || connection.status === 'syncing'}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-40"
            >
              <RefreshCw size={12} className={syncing || connection.status === 'syncing' ? 'animate-spin' : ''} />
              {syncing || connection.status === 'syncing' ? 'Syncing...' : 'Sync now'}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/[0.07] disabled:opacity-40"
            >
              <Unplug size={12} />
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}

      {/* Connect button (disconnected state) */}
      {!isConnected && (
        <div className="mt-4">
          <button
            onClick={onConnect}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.10] text-white text-sm font-medium transition-all hover:border-white/20"
          >
            <Plug size={14} />
            Connect {def.name}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Manual Connection Card (Telegram, etc.) ────────────────────────────────

function ManualConnectionCard({ def }: { def: ConnectionDef }) {
  const [channelStatus, setChannelStatus] = useState<{ connected: boolean; displayName?: string } | null>(null)

  useEffect(() => {
    if (def.id === 'telegram') {
      fetch('/api/cron/delivery')
        .then((r) => r.json())
        .then((data: { channels?: { id: string; enabled: boolean }[]; displayNames?: Record<string, string> }) => {
          const ch = data.channels?.find((c) => c.id === 'telegram')
          setChannelStatus({
            connected: !!ch?.enabled,
            displayName: data.displayNames?.telegram,
          })
        })
        .catch(() => setChannelStatus({ connected: false }))
    }
  }, [def.id])

  const isConnected = channelStatus?.connected === true

  return (
    <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
      <div className="flex items-start gap-3.5">
        <div className="w-11 h-11 bg-white/[0.08] rounded-xl flex items-center justify-center text-xl shrink-0">
          {def.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-[15px]">{def.name}</span>
            {isConnected ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                connected
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                not connected
              </span>
            )}
          </div>
          <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">{def.description}</p>
        </div>
      </div>

      <div className="mt-4 p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
        <p className="text-zinc-400 text-xs leading-relaxed">
          {def.id === 'telegram' ? (
            isConnected ? (
              <>
                <strong className="text-emerald-300">Connected</strong>
                {channelStatus?.displayName && <> as <span className="text-white">{channelStatus.displayName}</span></>}
                {' '}via OpenClaw channel. Briefings, reminders, and alerts deliver to your Telegram.
              </>
            ) : (
              <>
                <strong className="text-zinc-300">Setup:</strong> OpenClaw users — configure via{' '}
                <span className="text-blue-400">openclaw channels add telegram</span>.
                BYOK users — connect your own Telegram bot. Hosted users — our bot delivers to you.
              </>
            )
          ) : (
            'Configuration details coming soon.'
          )}
        </p>
      </div>
      {/* TODO: Connect this to backend for hosted/BYOK users — currently only detects OpenClaw channel config */}
    </div>
  )
}

// ─── Connections Section ─────────────────────────────────────────────────────

function ConnectionsSection({ flash }: { flash: string | null }) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [definitions, setDefinitions] = useState<ConnectionDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchConnections()
      setConnections(data.connections)
      setDefinitions(data.definitions)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleConnect(definitionId: string) {
    setConnectingId(definitionId)
    try {
      const url = await startAuth(definitionId)
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start auth')
      setConnectingId(null)
    }
  }

  function getConnection(defId: string): Connection | null {
    return connections.find((c) => c.id === defId) ?? null
  }

  const builtInCount = definitions.filter((d) => d.authType === 'built_in').length
  const connectedCount = connections.filter((c) => c.status === 'connected' || c.status === 'syncing').length + builtInCount

  return (
    <div className="space-y-4">
      {/* Flash message */}
      {flash && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/15 border border-emerald-500/25 rounded-xl animate-in fade-in slide-in-from-top-2 duration-300">
          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          <span className="text-emerald-300 text-sm">{flash}</span>
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-3">
        {[
          { value: definitions.length, label: 'available', color: 'text-white' },
          { value: connectedCount, label: 'active', color: 'text-emerald-400' },
        ].map(({ value, label, color }) => (
          <div key={label} className="flex-1 bg-white/[0.05] rounded-xl p-3 text-center border border-white/[0.08]">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-zinc-600 text-[11px] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 size={16} className="text-zinc-500 animate-spin" />
          <span className="text-zinc-500 text-sm">Loading connections...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-300 text-xs leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Connecting overlay */}
      {connectingId && (
        <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
          <span className="text-blue-300 text-sm">Redirecting to sign in...</span>
        </div>
      )}

      {/* Connection cards */}
      {!loading && definitions.map((def) => (
        def.authType === 'built_in' ? (
          <UsageConnectionCard key={def.id} def={def} />
        ) : def.authType === 'manual' ? (
          <ManualConnectionCard key={def.id} def={def} />
        ) : (
          <ConnectionCard
            key={def.id}
            def={def}
            connection={getConnection(def.id)}
            onSync={load}
            onDisconnect={load}
            onConnect={() => handleConnect(def.id)}
          />
        )
      ))}

      {/* Empty state */}
      {!loading && definitions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="text-5xl">🔌</div>
          <div>
            <p className="text-white font-semibold">No connections available</p>
            <p className="text-zinc-500 text-sm mt-1 max-w-xs">
              Connection definitions will appear here when configured.
            </p>
          </div>
        </div>
      )}

      {/* Footer note */}
      <p className="text-white/20 text-[11px] text-center pt-2">
        Connections sync automatically every 5 minutes
      </p>
    </div>
  )
}

// ─── Profile Types ───────────────────────────────────────────────────────────

type ProfileField = { key: string; value: string }

type ProfileSectionData = {
  title: string | null
  subtitle: string | null
  fields: ProfileField[]
  text: string | null
}

type ProfileResponse = {
  name: string
  type: string
  sections: ProfileSectionData[]
  hasWorkspaceFile: boolean
  hasDbFields: boolean
}

/** Keys whose values should be masked by default */
const SENSITIVE_KEYS = new Set([
  'email', 'phone', 'birthday', 'anniversary', 'address', 'ssn',
  'social security', 'date of birth', 'dob',
])

function isSensitive(key: string): boolean {
  const lk = key.toLowerCase()
  for (const s of SENSITIVE_KEYS) {
    if (lk.includes(s)) return true
  }
  return false
}

/** Render a comma-separated value as pill tags */
function isTagLike(value: string): boolean {
  return value.includes(',') && !value.includes('@') && value.length < 200
}

// ─── Profile Section ─────────────────────────────────────────────────────────

/** Quick-edit fields shown in the profile editor */
const QUICK_EDIT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'name', label: 'Name', placeholder: 'What should the AI call you?' },
  { key: 'pronouns', label: 'Pronouns', placeholder: 'e.g. he/him, she/her, they/them' },
  { key: 'timezone', label: 'Timezone', placeholder: 'e.g. America/Toronto' },
  { key: 'location', label: 'Location', placeholder: 'e.g. Toronto, ON' },
  { key: 'interests', label: 'Interests', placeholder: 'e.g. basketball, coding, music' },
  { key: 'communication_style', label: 'Communication style', placeholder: 'e.g. casual, formal, concise' },
  { key: 'notes', label: 'Notes', placeholder: 'Anything else the AI should know about you' },
]

const AI_QUICK_EDIT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'name', label: 'AI Name', placeholder: 'e.g. Chief of Staff, Assistant' },
  { key: 'short', label: 'Short name', placeholder: 'e.g. Chief' },
  { key: 'personality', label: 'Personality', placeholder: 'e.g. witty, direct, warm' },
  { key: 'values', label: 'Values', placeholder: 'e.g. Bias toward action. Ship fast.' },
]

function ProfileSection() {
  const [userProfile, setUserProfile] = useState<ProfileResponse | null>(null)
  const [aiProfile, setAiProfile] = useState<ProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<'user' | 'ai' | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const loadProfiles = useCallback(() => {
    Promise.all([
      fetch('/api/settings/profile?type=user').then(r => r.ok ? r.json() : null),
      fetch('/api/settings/profile?type=ai').then(r => r.ok ? r.json() : null),
    ])
      .then(([user, ai]) => {
        if (user) setUserProfile(user)
        if (ai) setAiProfile(ai)
      })
      .catch((err) => console.warn('[Settings] profile load failed', err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const startEditing = (type: 'user' | 'ai') => {
    const profile = type === 'user' ? userProfile : aiProfile
    const fields = type === 'user' ? QUICK_EDIT_FIELDS : AI_QUICK_EDIT_FIELDS
    // Pre-populate from existing profile sections
    const initial: Record<string, string> = {}
    for (const f of fields) {
      // Find value in sections by matching normalised key
      const found = profile?.sections
        .flatMap(s => s.fields)
        .find(sf => sf.key.toLowerCase().replace(/\s+/g, '_') === f.key)
      initial[f.key] = found?.value ?? ''
    }
    setEditFields(initial)
    setEditing(type)
  }

  const saveProfile = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: editing, fields: editFields }),
      })
      if (res.ok) {
        setEditing(null)
        setLoading(true)
        loadProfiles()
      }
    } catch { /* show nothing — fields remain */ }
    finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2">
        <Loader2 size={16} className="text-zinc-500 animate-spin" />
        <span className="text-zinc-500 text-sm">Loading profile...</span>
      </div>
    )
  }

  // Edit mode
  if (editing) {
    const fields = editing === 'user' ? QUICK_EDIT_FIELDS : AI_QUICK_EDIT_FIELDS
    return (
      <div className="space-y-4">
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
          <p className="text-white font-semibold text-[15px] mb-4">
            {editing === 'user' ? 'Edit Your Profile' : 'Edit AI Identity'}
          </p>
          <div className="space-y-3">
            {fields.map(f => (
              <div key={f.key}>
                <label className="text-zinc-500 text-xs block mb-1">{f.label}</label>
                {f.key === 'notes' || f.key === 'values' ? (
                  <textarea
                    className="w-full bg-white/[0.06] border border-white/[0.10] rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-white/[0.20] resize-none"
                    rows={3}
                    placeholder={f.placeholder}
                    value={editFields[f.key] ?? ''}
                    onChange={e => setEditFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                  />
                ) : (
                  <input
                    type="text"
                    className="w-full bg-white/[0.06] border border-white/[0.10] rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-white/[0.20]"
                    placeholder={f.placeholder}
                    value={editFields[f.key] ?? ''}
                    onChange={e => setEditFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={saveProfile}
              disabled={saving}
              className="px-4 py-2 bg-white/[0.12] hover:bg-white/[0.18] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-300 text-xs rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
          <p className="text-zinc-500 text-xs leading-relaxed">
            This data personalises your AI across all apps. Changes take effect within 5 minutes.
          </p>
        </div>
      </div>
    )
  }

  // View mode — render both user and AI profiles
  return (
    <div className="space-y-4">
      <ProfileCard
        profile={userProfile}
        icon="👤"
        fallbackName="User"
        subtitle="Your profile"
        onEdit={() => startEditing('user')}
      />
      <ProfileCard
        profile={aiProfile}
        icon="🤖"
        fallbackName="Assistant"
        subtitle="AI identity"
        onEdit={() => startEditing('ai')}
      />

      {/* Source note */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
        <p className="text-zinc-500 text-xs leading-relaxed">
          {userProfile?.hasWorkspaceFile && userProfile?.hasDbFields
            ? <>Merged from your edits and <span className="text-zinc-400 font-mono text-[11px]">~/.openclaw/workspace/</span>. Your edits take precedence.</>
            : userProfile?.hasWorkspaceFile
              ? <>Loaded from <span className="text-zinc-400 font-mono text-[11px]">~/.openclaw/workspace/</span>. Edit here to customise.</>
              : 'Edit here to personalise your AI across all apps.'
          }
        </p>
      </div>
    </div>
  )
}

function ProfileCard({
  profile,
  icon,
  fallbackName,
  subtitle,
  onEdit,
}: {
  profile: ProfileResponse | null
  icon: string
  fallbackName: string
  subtitle: string
  onEdit: () => void
}) {
  const name = profile?.name ?? fallbackName
  const sections = profile?.sections ?? []
  const identitySection = sections.find(s => s.title === null)
  const namedSections = sections.filter(s => s.title !== null)

  return (
    <>
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-12 h-12 bg-white/[0.08] rounded-full flex items-center justify-center text-xl shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-[15px]">{name}</p>
            <p className="text-zinc-500 text-xs mt-0.5">{subtitle}</p>
          </div>
          <button
            onClick={onEdit}
            className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1 rounded-lg transition-colors"
          >
            Edit
          </button>
        </div>

        {identitySection && identitySection.fields.length > 0 && (
          <div className="space-y-2.5">
            {identitySection.fields.map(({ key, value }) => (
              <FieldRow key={key} fieldKey={key} value={value} />
            ))}
          </div>
        )}

        {identitySection?.text && (
          <p className="text-zinc-400 text-xs leading-relaxed mt-3">{identitySection.text}</p>
        )}
      </div>

      {namedSections.map((section, i) => (
        <div key={section.title ?? i} className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-zinc-500 text-xs">{section.title}</span>
            {section.subtitle && (
              <span className="text-zinc-300 text-xs font-medium">{section.subtitle}</span>
            )}
          </div>

          {section.fields.length > 0 && (
            <div className="space-y-2.5">
              {section.fields.map(({ key, value }) => (
                <FieldRow key={key} fieldKey={key} value={value} />
              ))}
            </div>
          )}

          {section.text && (
            isTagLike(section.text) ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {section.text.split(',').map(tag => (
                  <span key={tag.trim()} className="bg-white/[0.08] text-zinc-300 text-[11px] px-2.5 py-1 rounded-full">
                    {tag.trim()}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-zinc-400 text-xs leading-relaxed mt-2">{section.text}</p>
            )
          )}
        </div>
      ))}
    </>
  )
}

/** Renders a single key-value field row with sensitivity + tag detection */
function FieldRow({ fieldKey, value }: { fieldKey: string; value: string }) {
  const sensitive = isSensitive(fieldKey)

  if (isTagLike(value)) {
    return (
      <div className="text-xs">
        <span className="text-zinc-500 block mb-1.5">{fieldKey}</span>
        <div className="flex flex-wrap gap-1.5">
          {value.split(',').map(tag => (
            <span key={tag.trim()} className="bg-white/[0.08] text-zinc-300 text-[11px] px-2.5 py-1 rounded-full">
              {tag.trim()}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-zinc-500">{fieldKey}</span>
      {sensitive ? (
        <SensitiveText value={value} visibleChars={fieldKey.toLowerCase().includes('email') ? 4 : undefined} className="text-zinc-300" />
      ) : (
        <span className="text-zinc-300">{value}</span>
      )}
    </div>
  )
}

// ─── Automation Section ──────────────────────────────────────────────────────

type AutoJob = {
  id: string
  name: string
  description?: string
  message?: string
  enabled: boolean
  isSystem?: boolean
  schedule: string
  tz?: string
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastStatus?: string | null
  lastError?: string | null
  delivery?: { channel: string; to?: string } | null
}

type AutoRunResult = {
  ok?: boolean
  status?: string
  summary?: string | null
  error?: string | null
  durationMs?: number | null
}

type AutoDeliveryConfig = {
  defaultChannel: string | null
  channels: { id: string; enabled: boolean }[]
  targets: Record<string, string>
  displayNames: Record<string, string>
}

const GENERIC_PRESETS: { label: string; cron?: string; every?: string; custom?: boolean }[] = [
  { label: 'Every morning at 8am',   cron: '0 8 * * *' },
  { label: 'Every day at noon',      cron: '0 12 * * *' },
  { label: 'Every evening at 7pm',   cron: '0 19 * * *' },
  { label: 'Every Monday morning',   cron: '0 8 * * 1' },
  { label: 'Every hour',             every: '1h' },
  { label: 'Every 30 minutes',       every: '30m' },
  { label: 'Custom…',                custom: true },
]

type AppPreset = {
  appName: string
  appIcon: string
  name: string
  description: string
  cron: string
  defaultMessage: string
}

function getAppCronPresets(): AppPreset[] {
  const presets: AppPreset[] = []
  for (const app of getLiveApps()) {
    for (const p of app.autonomy?.cronPresets ?? []) {
      presets.push({
        appName: app.name,
        appIcon: app.icon,
        name: p.name,
        description: p.description,
        cron: p.schedule,
        defaultMessage: p.defaultMessage,
      })
    }
  }
  return presets
}

const AUTO_CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram', email: 'Email', discord: 'Discord',
  slack: 'Slack', whatsapp: 'WhatsApp',
}

/**
 * Normalize API response into a flat AutoJob shape.
 * Handles both built-in format (schedule.type/value) and OpenClaw (schedule.kind/expr).
 */
function normalizeJob(raw: Record<string, unknown>): AutoJob {
  const sched = raw.schedule as Record<string, unknown> | undefined
  let scheduleStr = ''
  let tz: string | undefined

  if (sched) {
    // Built-in format: { type: 'cron', value: '...', cron: '...' }
    if (sched.type) {
      const type = sched.type as string
      const value = (sched.value ?? sched[type]) as string
      scheduleStr = type === 'cron' ? `Cron: ${value}` : type === 'every' ? `Every ${value}` : `Once at ${value}`
      tz = (raw.tz ?? sched.tz) as string | undefined
    }
    // OpenClaw format: { kind: 'cron', expr: '...' }
    else if (sched.kind) {
      const kind = sched.kind as string
      if (kind === 'cron') scheduleStr = `Cron: ${sched.expr}`
      else if (kind === 'every') scheduleStr = `Every ${sched.duration}`
      else scheduleStr = `Once at ${sched.at}`
      tz = sched.tz as string | undefined
    }
  }

  // Normalize timing fields — handle built-in (ISO strings) and OpenClaw (ms timestamps)
  const state = raw.state as Record<string, unknown> | undefined
  const nextRunAt = (raw.nextRunAt as string | undefined)
    ?? (state?.nextRunAtMs ? new Date(state.nextRunAtMs as number).toISOString() : null)
  const lastRunAt = (raw.lastRunAt as string | undefined)
    ?? (state?.lastRunAtMs ? new Date(state.lastRunAtMs as number).toISOString() : null)

  // Last run status/error — built-in format or OpenClaw state
  const lastStatus = (raw.lastStatus as string | undefined) ?? (state?.lastStatus as string | undefined) ?? null
  const lastError = (raw.lastError as string | undefined) ?? (state?.lastError as string | undefined) ?? null

  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string | undefined,
    message: (raw.message ?? (raw.payload as Record<string, unknown>)?.message) as string | undefined,
    enabled: Boolean(raw.enabled),
    isSystem: Boolean(raw.isSystem),
    schedule: scheduleStr || 'Unknown',
    tz,
    nextRunAt: nextRunAt ?? null,
    lastRunAt: lastRunAt ?? null,
    lastStatus,
    lastError,
    delivery: raw.delivery as AutoJob['delivery'],
  }
}

function autoTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function autoTimeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  const m = Math.floor(ms / 60_000)
  if (m <= 0) return 'soon'
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

// ─── Automation: Run Result Modal ────────────────────────────────────────────

function AutoRunResultModal({ result, onClose }: { result: AutoRunResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 mb-4 bg-zinc-900 border border-white/[0.10] rounded-2xl
                      overflow-hidden shadow-2xl max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-zinc-400" />
            <span className="text-white font-semibold text-sm">Run Result</span>
            {result.status === 'ok' && (
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 rounded px-1.5 py-0.5">success</span>
            )}
            {result.status === 'error' && (
              <span className="text-[10px] bg-red-500/20 text-red-400 rounded px-1.5 py-0.5">error</span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
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
        {result.durationMs && (
          <div className="px-4 py-2 border-t border-white/[0.06] shrink-0">
            <p className="text-zinc-600 text-[11px]">Completed in {(result.durationMs / 1000).toFixed(1)}s</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Automation: Job Card ────────────────────────────────────────────────────

function AutoJobCard({
  job,
  onToggle,
  onDelete,
  onRefresh,
}: {
  job: AutoJob
  onToggle: () => void
  onDelete: () => void
  onRefresh: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<AutoRunResult | null>(null)

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/cron/${job.id}`, { method: 'DELETE' })
      onDelete()
    } catch {
      setDeleting(false)
    }
  }

  async function handleRunNow() {
    setRunning(true)
    try {
      const res = await fetch(`/api/cron/${job.id}/run`, { method: 'POST' })
      const data = await res.json()
      setRunResult(data)
      onRefresh()
    } catch {
      setRunResult({ ok: false, error: 'Request failed' })
    } finally {
      setRunning(false)
    }
  }

  const deliveryLabel = job.delivery?.channel
    ? AUTO_CHANNEL_LABELS[job.delivery.channel] ?? job.delivery.channel
    : null

  return (
    <>
      <div className={`bg-white/[0.05] border rounded-2xl p-4 backdrop-blur-sm transition-all ${
        job.enabled ? 'border-white/[0.10]' : 'border-white/[0.05] opacity-60'
      }`}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-white/[0.08] rounded-xl flex items-center justify-center shrink-0">
            <Clock size={16} className="text-zinc-300" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-sm truncate">{job.name}</span>
              {!job.enabled && (
                <span className="text-[10px] bg-white/10 text-zinc-400 rounded px-1.5 py-0.5">paused</span>
              )}
              {job.isSystem && (
                <span className="text-[10px] bg-white/[0.08] text-zinc-300 rounded px-1.5 py-0.5">system</span>
              )}
            </div>
            <div className="text-zinc-400 text-xs mt-0.5">
              {job.schedule}{job.tz && job.tz !== 'UTC' ? ` (${job.tz})` : ''}
            </div>
            {deliveryLabel && (
              <div className="text-zinc-500 text-[11px] mt-0.5">Delivers to {deliveryLabel}</div>
            )}
            {job.description && (
              <div className="text-zinc-500 text-xs mt-0.5 truncate">{job.description}</div>
            )}
            <div className="flex gap-3 mt-1.5 text-zinc-600 text-[11px]">
              {job.lastRunAt && (
                <span>
                  Last: {autoTimeAgo(job.lastRunAt)}
                  {(job.lastStatus === 'error' || job.lastStatus === 'timeout') && (
                    <span className="text-red-400/70 ml-1">failed</span>
                  )}
                </span>
              )}
              {job.nextRunAt && job.enabled && <span>Next: {autoTimeUntil(job.nextRunAt)}</span>}
            </div>
            {job.lastError && (
              <div className="text-red-400/60 text-[11px] mt-0.5 truncate" title={job.lastError}>
                {job.lastError.length > 80 ? job.lastError.slice(0, 80) + '...' : job.lastError}
              </div>
            )}
          </div>

          {!job.isSystem && (
            <button
              onClick={onToggle}
              className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
              title={job.enabled ? 'Disable' : 'Enable'}
            >
              {job.enabled
                ? <ToggleRight size={22} className="text-emerald-400" />
                : <ToggleLeft size={22} />
              }
            </button>
          )}
        </div>

        {!job.isSystem && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
            <button
              onClick={handleRunNow}
              disabled={running}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded-lg hover:bg-white/10 disabled:opacity-40"
            >
              <Play size={11} />
              {running ? 'Running...' : 'Run now'}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.07] disabled:opacity-40"
            >
              <Trash2 size={11} />
              {deleting ? 'Removing...' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {runResult && (
        <AutoRunResultModal result={runResult} onClose={() => setRunResult(null)} />
      )}
    </>
  )
}

// ─── Automation: Add Job Form ────────────────────────────────────────────────

function AddAutoJobForm({
  onAdd,
  onCancel,
  deliveryConfig,
}: {
  onAdd: () => void
  onCancel: () => void
  deliveryConfig: AutoDeliveryConfig | null
}) {
  const appPresets = getAppCronPresets()
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [description, setDescription] = useState('')
  const [presetIdx, setPresetIdx] = useState(0)
  const [customCron, setCustomCron] = useState('')
  const [selectedAppPreset, setSelectedAppPreset] = useState<AppPreset | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const defaultChannel = deliveryConfig?.defaultChannel ?? null
  const enabledChannels = deliveryConfig?.channels.filter(c => c.enabled) ?? []
  const [channel, setChannel] = useState(defaultChannel ?? '')
  const [target, setTarget] = useState(deliveryConfig?.targets[defaultChannel ?? ''] ?? '')

  useEffect(() => {
    if (deliveryConfig?.targets[channel]) {
      setTarget(deliveryConfig.targets[channel])
    }
  }, [channel, deliveryConfig])

  function handleSelectAppPreset(ap: AppPreset) {
    setSelectedAppPreset(ap)
    setName(ap.name)
    setDescription(ap.description)
    setMessage(ap.defaultMessage)
    setCustomCron(ap.cron)
    setPresetIdx(GENERIC_PRESETS.length - 1) // Select "Custom…"
  }

  function handleClearAppPreset() {
    setSelectedAppPreset(null)
  }

  const preset = GENERIC_PRESETS[presetIdx]

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!message.trim()) { setError('Message/prompt is required'); return }

    setSaving(true)
    setError('')
    try {
      const body: Record<string, string | boolean> = {
        name: name.trim(),
        message: message.trim(),
      }
      if (description.trim()) body.description = description.trim()

      if (selectedAppPreset) {
        body.cron = customCron.trim() || selectedAppPreset.cron
      } else if ('cron' in preset && preset.cron) {
        body.cron = preset.cron
      } else if ('every' in preset && preset.every) {
        body.every = preset.every
      } else {
        if (!customCron.trim()) { setError('Enter a cron expression or interval'); setSaving(false); return }
        if (/^\d+[smhd]$/.test(customCron.trim())) {
          body.every = customCron.trim()
        } else {
          body.cron = customCron.trim()
        }
      }

      if (channel && target.trim()) {
        body.channel = channel
        body.to = target.trim()
      }

      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to create')
      }
      onAdd()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 space-y-4 backdrop-blur-sm">
      <h3 className="text-white font-semibold text-sm">New scheduled job</h3>

      {/* App presets */}
      {appPresets.length > 0 && !selectedAppPreset && (
        <div>
          <label className="text-zinc-400 text-xs mb-1.5 block">Quick start from apps</label>
          <div className="space-y-1.5">
            {appPresets.map((ap, i) => (
              <button
                key={i}
                onClick={() => handleSelectAppPreset(ap)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left bg-white/[0.04] border border-white/[0.08] hover:border-white/15 transition-all"
              >
                <span className="text-base">{ap.appIcon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-zinc-300 text-xs font-medium">{ap.name}</span>
                  <span className="text-zinc-600 text-[11px] ml-2">{ap.appName}</span>
                </div>
                <span className="text-zinc-600 text-[11px] font-mono">{ap.cron}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedAppPreset && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.08] border border-white/[0.15] rounded-xl">
          <span className="text-base">{selectedAppPreset.appIcon}</span>
          <span className="text-zinc-200 text-xs font-medium flex-1">{selectedAppPreset.name}</span>
          <button onClick={handleClearAppPreset} className="text-zinc-500 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      <div>
        <label className="text-zinc-400 text-xs mb-1.5 block">Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Daily summary"
          className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600"
        />
      </div>

      <div>
        <label className="text-zinc-400 text-xs mb-1.5 block">Description (optional)</label>
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Brief description of what this job does"
          className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600"
        />
      </div>

      {!selectedAppPreset && (
        <div>
          <label className="text-zinc-400 text-xs mb-1.5 block">Schedule</label>
          <div className="grid grid-cols-2 gap-1.5">
            {GENERIC_PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => setPresetIdx(i)}
                className={`text-left px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  presetIdx === i
                    ? 'bg-white/[0.12] border border-white/[0.20] text-white'
                    : 'bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:border-white/15 hover:text-zinc-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {'custom' in GENERIC_PRESETS[presetIdx] && (
            <input
              value={customCron}
              onChange={e => setCustomCron(e.target.value)}
              placeholder="Cron (0 9 * * 1-5) or interval (30m, 2h)"
              className="mt-2 w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600 font-mono"
            />
          )}
        </div>
      )}

      {selectedAppPreset && (
        <div>
          <label className="text-zinc-400 text-xs mb-1.5 block">Schedule</label>
          <input
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
            placeholder={selectedAppPreset.cron}
            className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600 font-mono"
          />
          <p className="text-zinc-600 text-[11px] mt-1">Default: {selectedAppPreset.cron}</p>
        </div>
      )}

      {/* Delivery channel */}
      {enabledChannels.length > 0 && (
        <div>
          <label className="text-zinc-400 text-xs mb-1.5 block">Deliver to (optional)</label>
          <div className="flex gap-2">
            <button
              onClick={() => { setChannel(''); setTarget('') }}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                !channel
                  ? 'bg-white/[0.12] border border-white/[0.20] text-white'
                  : 'bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:border-white/15 hover:text-zinc-300'
              }`}
            >
              None
            </button>
            {enabledChannels.map(c => (
              <button
                key={c.id}
                onClick={() => setChannel(c.id)}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  channel === c.id
                    ? 'bg-white/[0.12] border border-white/[0.20] text-white'
                    : 'bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:border-white/15 hover:text-zinc-300'
                }`}
              >
                {AUTO_CHANNEL_LABELS[c.id] ?? c.id}
              </button>
            ))}
          </div>
          {channel && !target.trim() && (
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={`${AUTO_CHANNEL_LABELS[channel] ?? channel} target`}
              className="mt-2 w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 placeholder:text-zinc-600"
            />
          )}
          {channel && target.trim() && (
            <div className="mt-2 flex items-center gap-2 px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl">
              <span className="text-white text-sm">{deliveryConfig?.displayNames?.[channel] ?? target}</span>
              <span className="text-zinc-600 text-[11px] ml-auto">{AUTO_CHANNEL_LABELS[channel] ?? channel}</span>
            </div>
          )}
        </div>
      )}

      <div>
        <label className="text-zinc-400 text-xs mb-1.5 block">Prompt / message</label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={3}
          placeholder="What should the AI do when this job fires?"
          className="w-full bg-white/[0.06] border border-white/[0.10] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-white/25 resize-none placeholder:text-zinc-600 leading-relaxed"
        />
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
          className="flex-1 py-2.5 rounded-xl bg-white/[0.12] hover:bg-white/[0.18] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
        >
          {saving ? 'Creating...' : 'Create job'}
        </button>
      </div>
    </div>
  )
}

// ─── Automation Section ──────────────────────────────────────────────────────

function AutomationSection() {
  const [jobs, setJobs] = useState<AutoJob[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deliveryConfig, setDeliveryConfig] = useState<AutoDeliveryConfig | null>(null)

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/cron')
      const data = await res.json()
      const rawJobs = data.jobs ?? []
      setJobs(rawJobs.map((j: Record<string, unknown>) => normalizeJob(j)))
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  useEffect(() => {
    fetch('/api/cron/delivery')
      .then(r => r.json())
      .then(setDeliveryConfig)
      .catch((err) => console.warn('[Settings] delivery config fetch failed', err))
  }, [])

  async function handleToggle(job: AutoJob) {
    // Optimistic update
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, enabled: !j.enabled } : j))
    try {
      const res = await fetch(`/api/cron/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      })
      if (!res.ok) throw new Error('Failed')
      // Reload from server to ensure sync
      loadJobs()
    } catch {
      // Revert on failure
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, enabled: job.enabled } : j))
    }
  }

  function handleDelete(id: string) {
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  function handleAdd() {
    setShowForm(false)
    loadJobs()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2">
        <Loader2 size={16} className="text-zinc-500 animate-spin" />
        <span className="text-zinc-500 text-sm">Loading schedules...</span>
      </div>
    )
  }

  const userJobs = jobs.filter(j => !j.isSystem)
  const systemJobs = jobs.filter(j => j.isSystem)
  const enabledCount = userJobs.filter(j => j.enabled).length

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h3 className="text-white font-semibold text-sm">Scheduled Jobs</h3>
          <p className="text-zinc-500 text-xs mt-0.5">
            Automated tasks that run on a schedule
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors px-3 py-1.5 rounded-xl hover:bg-white/10 text-xs font-medium"
          >
            <Plus size={14} />
            New
          </button>
        )}
      </div>

      {/* Stats */}
      {userJobs.length > 0 && (
        <div className="flex gap-3">
          {[
            { value: userJobs.length, label: 'total', color: 'text-white' },
            { value: enabledCount, label: 'active', color: 'text-emerald-400' },
            { value: userJobs.length - enabledCount, label: 'paused', color: 'text-amber-400' },
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
        <AddAutoJobForm
          onAdd={handleAdd}
          onCancel={() => setShowForm(false)}
          deliveryConfig={deliveryConfig}
        />
      )}

      {/* Empty state */}
      {userJobs.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-12 h-12 bg-white/[0.06] rounded-2xl flex items-center justify-center">
            <Clock size={24} className="text-zinc-500" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">No scheduled jobs</p>
            <p className="text-zinc-500 text-xs mt-1 max-w-xs">
              Create automated tasks that run on a schedule — daily summaries, periodic checks, recurring prompts.
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.12] hover:bg-white/[0.18] rounded-xl text-white font-semibold text-xs transition-colors"
          >
            <Plus size={14} />
            Create first job
          </button>
        </div>
      )}

      {/* User job list */}
      {userJobs.map(job => (
        <AutoJobCard
          key={job.id}
          job={job}
          onToggle={() => handleToggle(job)}
          onDelete={() => handleDelete(job.id)}
          onRefresh={loadJobs}
        />
      ))}

      {/* System jobs */}
      {systemJobs.length > 0 && (
        <div className="pt-2">
          <span className="text-zinc-600 text-[11px] uppercase tracking-wider px-1">System Jobs</span>
          <div className="space-y-2 mt-2">
            {systemJobs.map(job => (
              <AutoJobCard
                key={job.id}
                job={job}
                onToggle={() => handleToggle(job)}
                onDelete={() => handleDelete(job.id)}
                onRefresh={loadJobs}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── System + About Section (merged) ─────────────────────────────────────────

type SystemData = {
  status: string
  process: { uptimeSeconds: number; memoryMb: number; heapUsedMb: number; pid: number }
  cpu: { cores: number; model: string; loadAvg1m: number; loadAvg5m: number; loadAvg15m: number; loadPercent: number }
  memory: { totalMb: number; freeMb: number; usedMb: number; usedPercent: number }
  os: { hostname: string; platform: string; kernel: string; nodeVersion: string }
  pm2: { available: boolean; processes: { name: string; status: string; memoryMb: number; cpu: number; restarts: number; uptimeMs: number }[] }
  disk: { dbSizeMb: number; walSizeMb: number; artifactsSizeMb: number; fs: { totalGb: number; usedGb: number; freeGb: number; usedPercent: number; mount: string } | null }
  db: { messages: number; conversations: number; memories: number; tasks: number }
  topApps: { appId: string; name: string; icon: string; messageCount: number }[]
  openclaw: { reachable: boolean; latencyMs?: number }
  cron: { available: boolean; jobs: { name: string; enabled: boolean; schedule: string; lastError: string | null }[] }
  thresholds: { memoryMb: number; diskPercent: number; fileWriteThreshold: number; autoRecoveryEnabled: boolean; autoRecoveryMaxRestarts: number }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
}

function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  )
}

function SystemCards({ data }: { data: SystemData }) {
  const maxMessages = data.topApps?.length > 0 ? data.topApps[0].messageCount : 1
  const cronEnabled = data.cron?.jobs?.filter(j => j.enabled).length ?? 0
  const cronErrors = data.cron?.jobs?.filter(j => j.lastError).length ?? 0

  return (
    <>
      {/* Overall status */}
      <div className="flex items-center gap-2 px-1">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${
          data.status === 'ok' ? 'bg-emerald-400' : data.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400'
        }`} />
        <span className={`text-xs font-medium ${
          data.status === 'ok' ? 'text-emerald-400' : data.status === 'degraded' ? 'text-amber-400' : 'text-red-400'
        }`}>
          {data.status === 'ok' ? 'All systems operational' : data.status === 'degraded' ? 'Degraded performance' : 'Critical issues detected'}
        </span>
      </div>

      {data.os && (
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <span className="text-zinc-500 text-xs block mb-3">Host</span>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Hostname</span>
            <span className="text-zinc-300 font-mono text-[11px]">{data.os.hostname}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">OS</span>
            <span className="text-zinc-400">{data.os.platform} {data.os.kernel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Node</span>
            <span className="text-zinc-400">{data.os.nodeVersion}</span>
          </div>
          {data.process && (
          <>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Uptime</span>
            <span className="text-zinc-300">{formatUptime(data.process.uptimeSeconds)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">PID</span>
            <span className="text-zinc-400 font-mono text-[11px]">{data.process.pid}</span>
          </div>
          </>
          )}
        </div>
      </div>
      )}

      {data.cpu && data.memory && (
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <span className="text-zinc-500 text-xs block mb-3">Resources</span>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-zinc-400">CPU</span>
              <span className={`font-semibold ${data.cpu.loadPercent > 80 ? 'text-red-400' : data.cpu.loadPercent > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {data.cpu.loadPercent}%
              </span>
            </div>
            <UsageBar percent={data.cpu.loadPercent} color={data.cpu.loadPercent > 80 ? 'bg-red-400' : data.cpu.loadPercent > 50 ? 'bg-amber-400' : 'bg-emerald-400'} />
            <div className="flex items-center justify-between mt-1 text-[10px] text-zinc-600">
              <span>{data.cpu.cores} cores</span>
              <span>load {data.cpu.loadAvg1m} / {data.cpu.loadAvg5m} / {data.cpu.loadAvg15m}</span>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-zinc-400">Memory</span>
              <span className={`font-semibold ${data.memory.usedPercent > 85 ? 'text-red-400' : data.memory.usedPercent > 60 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {data.memory.usedPercent}%
              </span>
            </div>
            <UsageBar percent={data.memory.usedPercent} color={data.memory.usedPercent > 85 ? 'bg-red-400' : data.memory.usedPercent > 60 ? 'bg-amber-400' : 'bg-emerald-400'} />
            <div className="flex items-center justify-between mt-1 text-[10px] text-zinc-600">
              <span>{(data.memory.usedMb / 1024).toFixed(1)} GB used</span>
              <span>{(data.memory.totalMb / 1024).toFixed(1)} GB total</span>
            </div>
          </div>
          {data.disk?.fs && (
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-zinc-400">Disk <span className="text-zinc-600 font-mono text-[10px]">{data.disk.fs.mount}</span></span>
                <span className={`font-semibold ${data.disk.fs.usedPercent > 90 ? 'text-red-400' : data.disk.fs.usedPercent > 70 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {data.disk.fs.usedPercent}%
                </span>
              </div>
              <UsageBar percent={data.disk.fs.usedPercent} color={data.disk.fs.usedPercent > 90 ? 'bg-red-400' : data.disk.fs.usedPercent > 70 ? 'bg-amber-400' : 'bg-emerald-400'} />
              <div className="flex items-center justify-between mt-1 text-[10px] text-zinc-600">
                <span>{data.disk.fs.usedGb} GB used</span>
                <span>{data.disk.fs.freeGb} GB free / {data.disk.fs.totalGb} GB</span>
              </div>
            </div>
          )}
          {data.process && data.thresholds && (
          <>
          <div className="flex items-center justify-between text-xs pt-2 border-t border-white/[0.06]">
            <span className="text-zinc-500">Node RSS</span>
            <span className={data.process.memoryMb > data.thresholds.memoryMb ? 'text-red-400' : 'text-zinc-300'}>
              {data.process.memoryMb} MB <span className="text-zinc-600">/ {data.thresholds.memoryMb} MB threshold</span>
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Heap used</span>
            <span className="text-zinc-400">{data.process.heapUsedMb} MB</span>
          </div>
          </>
          )}
        </div>
      </div>
      )}

      {/* Processes */}
      {data.pm2 && (
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <span className="text-zinc-500 text-xs block mb-3">Processes</span>
        {data.pm2.available ? (
          <div className="space-y-2.5">
            {data.pm2.processes.map((p) => (
              <div key={p.name} className="flex items-center gap-2.5 text-xs">
                <StatusDot ok={p.status === 'online'} />
                <span className="text-zinc-300 font-medium min-w-[60px]">{p.name}</span>
                <span className="text-zinc-500">{p.memoryMb} MB</span>
                {p.cpu > 0 && <span className="text-zinc-600">{p.cpu}%</span>}
                <div className="flex-1" />
                {p.restarts > 0 && <span className="text-amber-500/70">{p.restarts} restarts</span>}
                <span className="text-zinc-600">{formatUptime(Math.floor(p.uptimeMs / 1000))}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-600 text-xs">PM2 unavailable</p>
        )}
      </div>
      )}

      {/* Database */}
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <span className="text-zinc-500 text-xs block mb-3">Database</span>
        <div className="grid grid-cols-2 gap-3 mb-3">
          {[
            { label: 'Messages', value: (data.db.messages ?? 0).toLocaleString() },
            { label: 'Conversations', value: (data.db.conversations ?? 0).toLocaleString() },
            ...(data.db.memories != null ? [{ label: 'Memories', value: data.db.memories.toLocaleString() }] : []),
            ...(data.db.tasks != null ? [{ label: 'Tasks', value: data.db.tasks.toLocaleString() }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/[0.04] rounded-lg p-2.5 border border-white/[0.06]">
              <div className="text-white text-sm font-semibold">{value}</div>
              <div className="text-zinc-600 text-[10px] mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        {data.disk && (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">DB size</span>
            <span className="text-zinc-400">{data.disk.dbSizeMb} MB</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">WAL size</span>
            <span className={data.disk.walSizeMb > 50 ? 'text-amber-400' : 'text-zinc-400'}>{data.disk.walSizeMb} MB</span>
          </div>
          {data.disk.artifactsSizeMb > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Artifacts</span>
              <span className="text-zinc-400">{data.disk.artifactsSizeMb} MB</span>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Top Apps */}
      {data.topApps.length > 0 && (
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
          <span className="text-zinc-500 text-xs block mb-3">Top Apps</span>
          <div className="space-y-2.5">
            {data.topApps.map((app, i) => (
              <div key={app.appId} className="flex items-center gap-2.5 text-xs">
                <span className="text-zinc-600 w-4 text-right">{i + 1}</span>
                <span>{app.icon}</span>
                <span className="text-zinc-300">{app.name}</span>
                <div className="flex-1 mx-2 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/[0.15] rounded-full"
                    style={{ width: `${(app.messageCount / maxMessages) * 100}%` }}
                  />
                </div>
                <span className="text-zinc-500 tabular-nums">{app.messageCount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.openclaw && data.cron && (
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <span className="text-zinc-500 text-xs block mb-3">Services</span>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5 text-xs">
            <StatusDot ok={data.openclaw.reachable} />
            <span className="text-zinc-300">OpenClaw Gateway</span>
            <div className="flex-1" />
            {data.openclaw.reachable ? (
              <span className="text-emerald-500/70">{data.openclaw.latencyMs}ms</span>
            ) : (
              <span className="text-red-500/70">unreachable</span>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-xs">
            <StatusDot ok={data.cron.available && cronErrors === 0} />
            <span className="text-zinc-300">Cron</span>
            <div className="flex-1" />
            {data.cron.available ? (
              <span className="text-zinc-500">{cronEnabled} jobs{cronErrors > 0 ? `, ${cronErrors} errors` : ''}</span>
            ) : (
              <span className="text-zinc-600">unavailable</span>
            )}
          </div>
          {data.cron.available && data.cron.jobs.length > 0 && (
            <div className="space-y-1.5 ml-[18px]">
              {data.cron.jobs.map(j => (
                <div key={j.name} className="flex items-center gap-2 text-[11px]">
                  <span className={j.enabled ? 'text-zinc-400' : 'text-zinc-600'}>{j.name}</span>
                  <div className="flex-1" />
                  {j.lastError && <span className="text-red-400/70 truncate max-w-[120px]" title={j.lastError}>{j.lastError}</span>}
                  <span className="text-zinc-600">{j.schedule}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </>
  )
}

function AboutSection() {
  const liveApps = getLiveApps()
  const ambientApps = getAmbientApps()
  const [sysData, setSysData] = useState<SystemData | null>(null)
  const [sysLoading, setSysLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings/system')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSysData(d) })
      .catch((err) => console.warn('[Settings] system data fetch failed', err))
      .finally(() => setSysLoading(false))
  }, [])

  const totalHeartbeatChecks = ambientApps.reduce(
    (sum, a) => sum + (a.autonomy?.heartbeatChecks?.length ?? 0), 0
  )
  const totalCronPresets = liveApps.reduce(
    (sum, a) => sum + (a.autonomy?.cronPresets?.length ?? 0), 0
  )

  const links: { label: string; href: string }[] = [
    { label: 'OpenClaw Docs', href: 'https://docs.openclaw.ai' },
    { label: 'Heartbeat vs Cron', href: 'https://docs.openclaw.ai/automation/cron-vs-heartbeat' },
    { label: 'GitHub', href: process.env.NEXT_PUBLIC_REPO_URL || 'https://github.com/uchibeke/myway' },
  ]

  return (
    <div className="space-y-4">
      {/* Myway — identity card */}
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 bg-white/[0.08] rounded-xl flex items-center justify-center text-xl shrink-0">
            ⚙️
          </div>
          <div>
            <p className="text-white font-semibold text-[15px]">Myway</p>
            <p className="text-zinc-500 text-xs mt-0.5">Your ambient AI home</p>
          </div>
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Platform</span>
            <span className="text-zinc-300">Myway PWA</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Framework</span>
            <span className="text-zinc-300">Next.js 16</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Live apps</span>
            <span className="text-zinc-300">{liveApps.length}</span>
          </div>
        </div>
      </div>

      {/* Autonomy stats */}
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
        <span className="text-zinc-500 text-xs block mb-3">Autonomy</span>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { value: ambientApps.length, label: 'ambient', color: 'text-emerald-400' },
            { value: totalHeartbeatChecks, label: 'heartbeats', color: 'text-amber-400' },
            { value: totalCronPresets, label: 'cron presets', color: 'text-zinc-300' },
          ].map(({ value, label, color }) => (
            <div key={label} className="bg-white/[0.04] rounded-lg p-2.5 text-center border border-white/[0.06]">
              <div className={`text-lg font-bold ${color}`}>{value}</div>
              <div className="text-zinc-600 text-[10px] mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {ambientApps.map(app => (
            <div key={app.id} className="flex items-center gap-2 text-[11px]">
              <span>{app.icon}</span>
              <span className="text-zinc-400">{app.name}</span>
              <div className="flex-1" />
              {(app.autonomy?.heartbeatChecks?.length ?? 0) > 0 && (
                <span className="text-amber-500/60">{app.autonomy!.heartbeatChecks!.length}h</span>
              )}
              {(app.autonomy?.cronPresets?.length ?? 0) > 0 && (
                <span className="text-blue-500/60">{app.autonomy!.cronPresets!.length}c</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* System health data */}
      {sysLoading && (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 size={16} className="text-zinc-500 animate-spin" />
          <span className="text-zinc-500 text-sm">Loading system info...</span>
        </div>
      )}
      {!sysLoading && !sysData && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-300 text-xs leading-relaxed">Failed to load system info</p>
          </div>
        </div>
      )}
      {sysData && <SystemCards data={sysData} />}

      {/* Links */}
      <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl overflow-hidden backdrop-blur-sm">
        {links.map((link, i) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.05] transition-colors ${
              i > 0 ? 'border-t border-white/[0.06]' : ''
            }`}
          >
            <span className="text-zinc-300 text-sm">{link.label}</span>
            <ExternalLink size={13} className="text-zinc-600" />
          </a>
        ))}
      </div>

      {/* Sign out */}
      <button
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' })
          window.location.href = '/'
        }}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-500/20 bg-red-500/10
                   text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors"
      >
        <LogOut size={16} />
        Sign out
      </button>

      {/* Footer */}
      <p className="text-white/15 text-[11px] text-center pt-2">
        Myway — self-hosted AI apps with guardrails
      </p>
    </div>
  )
}

// ─── Usage Connection Card ──────────────────────────────────────────────────

type UsageSummary = {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  totalCost: number
  requestCount: number
  byApp: { appId: string; tokens: number; cost: number; count: number }[]
  byModel: { model: string; tokens: number; cost: number; count: number }[]
  byDay: { date: string; tokens: number; cost: number; count: number }[]
}

function UsageConnectionCard({ def }: { def: ConnectionDef }) {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/connections/${def.id}?days=${days}`)
      .then(r => r.json())
      .then(res => { setData(res.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days, def.id])

  const formatCost = (c: number) => {
    if (c === 0) return '$0.00'
    if (c < 0.01) return `$${c.toFixed(4)}`
    if (c < 1) return `$${c.toFixed(3)}`
    return `$${c.toFixed(2)}`
  }
  const formatTokens = (t: number) => t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : t >= 1_000 ? `${(t / 1_000).toFixed(1)}K` : String(t)

  return (
    <div className="bg-white/[0.05] border border-white/[0.10] rounded-2xl p-5 backdrop-blur-sm">
      {/* Header row — matches ConnectionCard pattern */}
      <div className="flex items-start gap-3.5">
        <div className="w-11 h-11 bg-white/[0.08] rounded-xl flex items-center justify-center text-xl shrink-0">
          {def.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-[15px]">{def.name}</span>
            <CheckCircle2 size={14} className="text-emerald-400" />
          </div>
          <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">{def.description}</p>
        </div>
      </div>

      {/* Quick stats (always visible) */}
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 py-3 justify-center">
            <Loader2 size={14} className="text-zinc-500 animate-spin" />
            <span className="text-zinc-500 text-xs">Loading...</span>
          </div>
        ) : !data || data.requestCount === 0 ? (
          <div className="text-center py-3">
            <p className="text-zinc-500 text-xs">No usage recorded yet.</p>
            <p className="text-zinc-600 text-[10px] mt-0.5">Usage will appear after your first conversation.</p>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-2.5 text-center">
                <p className="text-zinc-500 text-[10px] uppercase tracking-wider">Cost</p>
                <p className="text-zinc-100 text-base font-semibold mt-0.5">{formatCost(data.totalCost)}</p>
              </div>
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-2.5 text-center">
                <p className="text-zinc-500 text-[10px] uppercase tracking-wider">Tokens</p>
                <p className="text-zinc-100 text-base font-semibold mt-0.5">{formatTokens(data.totalTokens)}</p>
              </div>
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-2.5 text-center">
                <p className="text-zinc-500 text-[10px] uppercase tracking-wider">Requests</p>
                <p className="text-zinc-100 text-base font-semibold mt-0.5">{data.requestCount}</p>
              </div>
            </div>

            {/* Expand/collapse toggle */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
              >
                <BarChart2 size={12} />
                {expanded ? 'Hide details' : 'View details'}
              </button>
              <div className="flex-1" />
              {/* Period selector */}
              <div className="flex gap-1">
                {[7, 30, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`px-2 py-1 text-[10px] rounded-md transition-colors ${
                      days === d
                        ? 'bg-white/10 text-zinc-200'
                        : 'text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04]'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {/* Expanded details */}
            {expanded && (
              <div className="space-y-3 pt-2">
                {/* Daily trend */}
                {data.byDay.length > 1 && (() => {
                  const maxDayCost = Math.max(...data.byDay.map(d => d.cost), 0.001)
                  return (
                    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
                      <p className="text-zinc-400 text-xs font-medium mb-3">Daily Cost</p>
                      <div className="flex items-end gap-px h-16">
                        {data.byDay.slice(-Math.min(data.byDay.length, 30)).map((d, i) => {
                          const height = Math.max(2, (d.cost / maxDayCost) * 100)
                          return (
                            <div
                              key={i}
                              className="flex-1 bg-blue-500/60 rounded-t-sm hover:bg-blue-400/80 transition-colors"
                              style={{ height: `${height}%` }}
                              title={`${d.date}: ${formatCost(d.cost)} (${formatTokens(d.tokens)})`}
                            />
                          )
                        })}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-zinc-600 text-[10px]">{data.byDay[0]?.date?.slice(5)}</span>
                        <span className="text-zinc-600 text-[10px]">{data.byDay[data.byDay.length - 1]?.date?.slice(5)}</span>
                      </div>
                    </div>
                  )
                })()}

                {/* By App */}
                {data.byApp.length > 0 && (
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
                    <p className="text-zinc-400 text-xs font-medium mb-2">By App</p>
                    <div className="space-y-2">
                      {data.byApp.map(a => (
                        <div key={a.appId} className="flex items-center justify-between">
                          <span className="text-zinc-300 text-xs">{a.appId}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-zinc-500 text-[10px]">{formatTokens(a.tokens)}</span>
                            <span className="text-zinc-200 text-xs font-medium w-14 text-right">{formatCost(a.cost)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By Model */}
                {data.byModel.length > 0 && (
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
                    <p className="text-zinc-400 text-xs font-medium mb-2">By Model</p>
                    <div className="space-y-2">
                      {data.byModel.map(m => (
                        <div key={m.model} className="flex items-center justify-between">
                          <span className="text-zinc-300 text-xs truncate max-w-[180px]">{m.model}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-zinc-500 text-[10px]">{m.count} reqs</span>
                            <span className="text-zinc-200 text-xs font-medium w-14 text-right">{formatCost(m.cost)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Token breakdown */}
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
                  <p className="text-zinc-400 text-xs font-medium mb-2">Token Breakdown</p>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-zinc-500">Prompt</span>
                        <span className="text-zinc-400">{formatTokens(data.promptTokens)}</span>
                      </div>
                      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500/60 rounded-full"
                          style={{ width: `${data.totalTokens ? (data.promptTokens / data.totalTokens) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-zinc-500">Completion</span>
                        <span className="text-zinc-400">{formatTokens(data.completionTokens)}</span>
                      </div>
                      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500/60 rounded-full"
                          style={{ width: `${data.totalTokens ? (data.completionTokens / data.totalTokens) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Settings Page ───────────────────────────────────────────────────────────

const VALID_TABS = new Set(getSortedTabs().map(t => t.id))

function SettingsPageContent() {
  const tabs = getSortedTabs()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const rawTab = searchParams.get('tab')
  const activeTab = rawTab && VALID_TABS.has(rawTab) ? rawTab : 'connections'
  const [flash, setFlash] = useState<string | null>(null)

  function setActiveTab(tabId: string) {
    router.replace(`${pathname}?tab=${tabId}`, { scroll: false })
  }

  // Check for status param (from OAuth callback redirect)
  useEffect(() => {
    if (searchParams.get('status') === 'connected') {
      setFlash('Connection successful')
      router.replace(`${pathname}?tab=connections`, { scroll: false })
      setTimeout(() => setFlash(null), 4000)
    }
  }, [searchParams, router, pathname])

  // Tab ID → section component mapping
  const TAB_COMPONENTS: Record<string, React.ReactNode> = {
    connections: <ConnectionsSection flash={flash} />,
    profile: <ProfileSection />,
    automation: <AutomationSection />,
    about: <AboutSection />,
  }

  return (
    <AppPage gradient={getAppGradient('bg-zinc-600')}>
      <AppHeader
        title="Settings"
        icon="⚙️"
        backHref="/"
        backLabel="Home"
      />

      <SegmentedControl tabs={resolveSettingsTabs(tabs)} value={activeTab} onChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {TAB_COMPONENTS[activeTab] ?? null}
      </div>
    </AppPage>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageContent />
    </Suspense>
  )
}
