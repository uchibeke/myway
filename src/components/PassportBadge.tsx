'use client'

/**
 * PassportBadge — reusable APort passport status badge.
 *
 * Shows the passport status inline with color-coded dot, level, and ID.
 * Can be used in headers, sidebars, or as a standalone card.
 *
 * Props:
 *   size      — 'sm' | 'md' | 'lg' (default: 'md')
 *   linkTo    — route to navigate to on click (default: '/apps/guardrails?tab=passport')
 *   showCard  — render full card layout vs compact inline badge
 */

import { useState, useEffect } from 'react'
import { Shield, ShieldOff, ShieldAlert, ExternalLink, Loader2 } from 'lucide-react'

export type PassportStatus = {
  configured: boolean
  passportId?: string
  ownerId?: string
  status?: 'active' | 'suspended' | 'revoked'
  assuranceLevel?: string
  capabilities?: { id: string }[]
  specVersion?: string
  kind?: string
  /** "local" (file-based), "api" (API with local passport), or "hosted" (API with hosted passport) */
  mode?: 'local' | 'api' | 'hosted'
  error?: string
  filePath?: string
}

type Size = 'sm' | 'md' | 'lg'

type Props = {
  size?: Size
  linkTo?: string
  showCard?: boolean
  /** External status — skip fetch if provided */
  status?: PassportStatus
}

function statusColor(s: PassportStatus): string {
  if (!s.configured)           return 'text-zinc-500'
  if (s.error)                 return 'text-amber-400'
  switch (s.status) {
    case 'active':    return 'text-emerald-400'
    case 'suspended': return 'text-amber-400'
    case 'revoked':   return 'text-red-400'
    default:          return 'text-zinc-400'
  }
}

function dotColor(s: PassportStatus): string {
  if (!s.configured)           return 'bg-zinc-600'
  if (s.error)                 return 'bg-amber-400'
  switch (s.status) {
    case 'active':    return 'bg-emerald-400'
    case 'suspended': return 'bg-amber-400'
    case 'revoked':   return 'bg-red-500'
    default:          return 'bg-zinc-500'
  }
}

function StatusIcon({ s, size }: { s: PassportStatus; size: Size }) {
  const px = size === 'sm' ? 12 : size === 'lg' ? 20 : 15
  if (!s.configured || s.status === 'revoked') return <ShieldOff size={px} className="text-zinc-500" />
  if (s.error || s.status === 'suspended')      return <ShieldAlert size={px} className="text-amber-400" />
  return <Shield size={px} className="text-emerald-400" />
}

function labelText(s: PassportStatus): string {
  if (!s.configured) return 'Not configured'
  if (s.error)       return 'Error'
  return s.status ? s.status.charAt(0).toUpperCase() + s.status.slice(1) : 'Unknown'
}

function truncateId(id?: string, chars = 8): string {
  if (!id) return '—'
  return id.length > chars ? id.slice(0, chars) + '…' : id
}

export default function PassportBadge({ size = 'md', linkTo, showCard = false, status: externalStatus }: Props) {
  const [status, setStatus]   = useState<PassportStatus | null>(externalStatus ?? null)
  const [loading, setLoading] = useState(!externalStatus)

  useEffect(() => {
    if (externalStatus) { setStatus(externalStatus); return }
    fetch('/api/aport/passport')
      .then((r) => r.json())
      .then((d: PassportStatus) => setStatus(d))
      .catch(() => setStatus({ configured: false }))
      .finally(() => setLoading(false))
  }, [externalStatus])

  const href = linkTo ?? '/apps/guardrails?tab=passport'

  if (loading) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-zinc-500 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
        <Loader2 size={size === 'sm' ? 10 : 13} className="animate-spin" />
        APort…
      </span>
    )
  }

  const s = status ?? { configured: false }

  // ── Compact inline badge ────────────────────────────────────────────────
  if (!showCard) {
    const textSize = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'
    const dotSize  = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
    return (
      <a
        href={href}
        title={s.passportId ? `Passport: ${s.passportId}` : 'APort Passport'}
        className={`
          inline-flex items-center gap-1.5 ${textSize} ${statusColor(s)}
          hover:opacity-80 transition-opacity
        `}
      >
        <span className={`${dotSize} rounded-full flex-shrink-0 ${dotColor(s)}`} />
        <span>APort {labelText(s)}</span>
        {s.assuranceLevel && (
          <span className="text-zinc-600">{s.assuranceLevel}</span>
        )}
      </a>
    )
  }

  // ── Full card layout ─────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`
            w-10 h-10 rounded-lg flex items-center justify-center
            ${s.configured && s.status === 'active' ? 'bg-emerald-500/10' : 'bg-zinc-800'}
          `}>
            <StatusIcon s={s} size="md" />
          </div>
          <div>
            <h3 className="text-white font-medium text-sm">APort Passport</h3>
            <p className={`text-xs mt-0.5 ${statusColor(s)}`}>
              {labelText(s)}
              {s.assuranceLevel && ` · ${s.assuranceLevel}`}
            </p>
          </div>
        </div>
        <a
          href={href}
          className="text-zinc-600 hover:text-zinc-400 transition-colors"
          title="Open Guardrails app"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {!s.configured && (
        <div className="text-zinc-400 text-xs space-y-1">
          <p>No passport found. Install APort to enable agent guardrails.</p>
          <a
            href="https://github.com/aporthq/aport-agent-guardrails"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline underline-offset-2 hover:text-white"
          >
            aport-agent-guardrails →
          </a>
        </div>
      )}

      {s.error && (
        <p className="text-amber-400 text-xs">{s.error}</p>
      )}

      {s.configured && !s.error && (
        <div className="space-y-2 text-xs">
          {s.passportId && (
            <div className="flex justify-between text-zinc-400">
              <span className="text-zinc-600">Passport ID</span>
              <span className="font-mono">{truncateId(s.passportId, 18)}</span>
            </div>
          )}
          {s.ownerId && (
            <div className="flex justify-between text-zinc-400">
              <span className="text-zinc-600">Owner</span>
              <span>{s.ownerId}</span>
            </div>
          )}
          {s.specVersion && (
            <div className="flex justify-between text-zinc-400">
              <span className="text-zinc-600">Spec</span>
              <span>{s.specVersion}</span>
            </div>
          )}
          {s.capabilities && s.capabilities.length > 0 && (
            <div className="mt-3">
              <p className="text-zinc-600 mb-1.5">Capabilities</p>
              <div className="flex flex-wrap gap-1">
                {s.capabilities.slice(0, 8).map((c) => (
                  <span
                    key={c.id}
                    className="bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded text-xs font-mono"
                  >
                    {c.id}
                  </span>
                ))}
                {s.capabilities.length > 8 && (
                  <span className="text-zinc-600 text-xs py-0.5">
                    +{s.capabilities.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
