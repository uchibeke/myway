'use client'

/**
 * KillSwitch — reusable APort kill switch component.
 *
 * Displays the current kill switch state with a prominent toggle button
 * and an expandable details section. Can be embedded in any page.
 *
 * Props:
 *   compact   — slim version for embedding in sidebars / headers
 *   onToggle  — callback after state changes (optional)
 */

import { useState, useEffect, useCallback } from 'react'
import { Power, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Loader2, FileText } from 'lucide-react'

export type KillSwitchState = {
  active: boolean
  passportStatus?: string
  path: string
  mode?: 'local' | 'api' | 'hosted'
}

type Props = {
  compact?: boolean
  onToggle?: (state: KillSwitchState) => void
}

export default function KillSwitch({ compact = false, onToggle }: Props) {
  const [state, setState]       = useState<KillSwitchState | null>(null)
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/aport/kill-switch')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: KillSwitchState = await res.json()
      setState(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch kill switch state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchState() }, [fetchState])

  const handleToggle = useCallback(async () => {
    if (!state) return
    if (!state.active) {
      // Activating — need confirmation
      setConfirmOpen(true)
      return
    }
    // Deactivating — no confirmation needed
    await doToggle('deactivate')
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const doToggle = async (action: 'activate' | 'deactivate') => {
    setToggling(true)
    setError(null)
    try {
      const res = await fetch('/api/aport/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const newState: KillSwitchState = await res.json()
      setState(newState)
      onToggle?.(newState)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setToggling(false)
      setConfirmOpen(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-400 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Loading kill switch…
      </div>
    )
  }

  const active = state?.active ?? false

  if (compact) {
    return (
      <button
        onClick={handleToggle}
        disabled={toggling}
        title={active ? 'Kill switch ACTIVE — click to deactivate' : 'Kill switch inactive — click to activate'}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          transition-all duration-200 cursor-pointer
          ${active
            ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
          }
          ${toggling ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Power size={11} />
        {active ? 'KILL SWITCH ON' : 'Kill switch'}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Confirmation modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-red-500/40 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={22} className="text-red-400 flex-shrink-0" />
              <h3 className="text-white font-semibold">Activate Kill Switch?</h3>
            </div>
            <p className="text-zinc-400 text-sm mb-6">
              This will block <strong className="text-white">all agent actions immediately</strong>,
              including file writes, shell commands, and messages. The agent will refuse all
              tool calls until you deactivate it.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => doToggle('activate')}
                disabled={toggling}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {toggling ? 'Activating…' : 'Yes, Activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main status card */}
      <div className={`
        rounded-xl border p-5 transition-all duration-500
        ${active
          ? 'bg-red-950/30 border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.15)]'
          : 'bg-zinc-900 border-zinc-800'
        }
      `}>
        {/* Status indicator */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className={`
              w-3 h-3 rounded-full
              ${active ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-emerald-500'}
            `} />
            <span className={`font-semibold text-lg ${active ? 'text-red-400' : 'text-emerald-400'}`}>
              {active ? 'KILL SWITCH ACTIVE' : 'Kill Switch Inactive'}
            </span>
          </div>
          {active && state?.passportStatus && (
            <span className="text-xs text-red-400/70">
              passport: {state.passportStatus}
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-zinc-400 text-sm mb-5">
          {active
            ? 'All agent actions are currently blocked. The AI cannot run commands, write files, or send messages until you deactivate this.'
            : 'The agent is operating normally. Activate the kill switch to immediately halt all agent actions — use in an emergency or when leaving the agent unattended.'
          }
        </p>

        {/* Toggle button */}
        <button
          onClick={handleToggle}
          disabled={toggling}
          className={`
            w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl
            font-semibold text-sm transition-all duration-200
            ${active
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-red-600 hover:bg-red-500 text-white border border-red-500/50'
            }
            ${toggling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'}
          `}
        >
          {toggling
            ? <><Loader2 size={15} className="animate-spin" /> Working…</>
            : active
              ? <><CheckCircle2 size={15} /> Deactivate Kill Switch</>
              : <><Power size={15} /> Activate Kill Switch</>
          }
        </button>

        {error && (
          <p className="mt-3 text-red-400 text-xs text-center">{error}</p>
        )}
      </div>

      {/* Expandable details */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <FileText size={13} />
            How it works
          </span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
            {state?.mode === 'hosted' ? (
              <>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  In hosted mode, the kill switch suspends your agent's passport via the APort API.
                  A suspended passport returns <code className="text-red-400 bg-zinc-800 px-1 rounded">deny</code> for
                  every tool call — the agent cannot execute any action.
                </p>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  Deactivating reactivates the passport. No agent restart is needed — the next
                  tool call will pass through normally.
                </p>
              </>
            ) : (
              <>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  The kill switch sets your passport status to <code className="text-red-400 bg-zinc-800 px-1 rounded">suspended</code> in
                  passport.json. APort's guardrail script checks this field before every tool call — a
                  suspended passport returns <code className="text-red-400 bg-zinc-800 px-1 rounded">deny</code> for
                  all actions.
                </p>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  Deactivating restores the status to <code className="text-emerald-400 bg-zinc-800 px-1 rounded">active</code>.
                  No agent restart is needed — the next tool call will pass through normally.
                </p>
              </>
            )}
            <div className="flex items-start gap-2 bg-zinc-800/60 rounded-lg px-3 py-2">
              <FileText size={12} className="text-zinc-500 mt-0.5 flex-shrink-0" />
              <span className="text-zinc-500 text-xs font-mono break-all">
                {state?.path ?? 'Path not available'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
