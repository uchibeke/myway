'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  Users, BarChart2, DollarSign, Loader2, ShieldAlert,
  AlertCircle, RefreshCw, TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import SegmentedControl from '@/components/SegmentedControl'
import { getAppGradient } from '@/lib/design'
import { getSortedAdminTabs } from '@/lib/admin-tabs'
import { timeAgo, formatTokens, formatCost } from '@/lib/format'
import type { AppTabDef } from '@/lib/apps'

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantInfo = {
  tenantId: string
  totalMessages: number
  totalTokens: number
  totalCostUsd: number
  lastActiveAt: number | null
}

type ModelUsage = {
  model: string
  totalTokens: number
  totalCostUsd: number
  requestCount: number
}

type DayUsage = {
  date: string
  totalTokens: number
  totalCostUsd: number
}

type TenantUsage = {
  tenantId: string
  totalTokens: number
  totalCostUsd: number
  requestCount: number
}

type UsageData = {
  days: number
  totalTokens: number
  totalCostUsd: number
  byModel: ModelUsage[]
  byDay: DayUsage[]
  perUser: TenantUsage[]
  isSelfHosted: boolean
}

// ─── Tab Registry ─────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  users: <Users size={11} />,
  'dollar-sign': <DollarSign size={11} />,
  'bar-chart': <BarChart2 size={11} />,
}

function resolveAdminTabs(tabs: AppTabDef[], isSelfHosted: boolean) {
  // Self-hosted: hide the "Users" tab — there's only you
  const filtered = isSelfHosted ? tabs.filter(t => t.id !== 'users') : tabs
  return filtered.map(t => ({ id: t.id, label: t.label, icon: ICON_MAP[t.icon] }))
}

// ─── Users Section (hosted mode only) ────────────────────────────────────────

function UsersSection() {
  const [tenants, setTenants] = useState<TenantInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/tenants')
      if (!res.ok) throw new Error('Failed to load tenants')
      const data = await res.json()
      setTenants(data.tenants)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 py-10 justify-center">
        <AlertCircle size={16} />
        <span className="text-sm">{error}</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white text-sm font-semibold">Users ({tenants.length})</h3>
        <button onClick={load} className="text-zinc-500 hover:text-white transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {tenants.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-10">No users found</p>
      ) : (
        <div className="space-y-2">
          {tenants.map(t => (
            <div key={t.tenantId} className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-sm font-medium">{t.tenantId}</span>
                {t.lastActiveAt && (
                  <span className="text-zinc-500 text-xs">{timeAgo(t.lastActiveAt)}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-zinc-500">Messages</span>
                  <p className="text-white font-medium">{t.totalMessages.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Tokens</span>
                  <p className="text-white font-medium">{formatTokens(t.totalTokens)}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Cost</span>
                  <p className="text-white font-medium">{formatCost(t.totalCostUsd)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Costs Section (hosted mode financial analytics) ─────────────────────────

type CostsData = {
  days: number
  totalCostUsd: number
  totalTokens: number
  totalRequests: number
  prevPeriodCostUsd: number
  costChangePercent: number | null
  avgCostPerUser: number
  projectedMonthlyCost: number
  activeUsers: number
  byModel: { model: string; totalCostUsd: number; percentage: number }[]
  dailyTrend: { date: string; totalCostUsd: number }[]
  topSpenders: { tenantId: string; totalCostUsd: number; totalTokens: number; requestCount: number; avgCostPerRequest: number }[]
  isSelfHosted: boolean
}

function CostsSection() {
  const [data, setData] = useState<CostsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/costs?days=${days}`)
      if (!res.ok) throw new Error('Failed to load costs')
      const d = await res.json()
      setData(d)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-red-400 py-10 justify-center">
        <AlertCircle size={16} />
        <span className="text-sm">{error ?? 'No data'}</span>
      </div>
    )
  }

  const TrendIcon = data.costChangePercent === null ? Minus
    : data.costChangePercent > 0 ? TrendingUp : data.costChangePercent < 0 ? TrendingDown : Minus
  const trendColor = data.costChangePercent === null ? 'text-zinc-500'
    : data.costChangePercent > 10 ? 'text-red-400' : data.costChangePercent < -5 ? 'text-emerald-400' : 'text-zinc-400'

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-white text-sm font-semibold">Cost Analytics</h3>
        <div className="flex gap-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                days === d ? 'bg-white/[0.15] text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <span className="text-zinc-500 text-xs">Total Spend</span>
          <p className="text-white text-lg font-semibold">{formatCost(data.totalCostUsd)}</p>
          {data.costChangePercent !== null && (
            <div className={`flex items-center gap-1 mt-1 ${trendColor}`}>
              <TrendIcon size={12} />
              <span className="text-xs">{data.costChangePercent > 0 ? '+' : ''}{data.costChangePercent}% vs prev {days}d</span>
            </div>
          )}
        </div>
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <span className="text-zinc-500 text-xs">Projected Monthly</span>
          <p className="text-white text-lg font-semibold">{formatCost(data.projectedMonthlyCost)}</p>
          <span className="text-zinc-600 text-xs">{formatCost(data.totalCostUsd / Math.max(days, 1))}/day avg</span>
        </div>
        {!data.isSelfHosted && (
          <>
            <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
              <span className="text-zinc-500 text-xs">Active Users</span>
              <p className="text-white text-lg font-semibold">{data.activeUsers}</p>
            </div>
            <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
              <span className="text-zinc-500 text-xs">Avg Cost / User</span>
              <p className="text-white text-lg font-semibold">{formatCost(data.avgCostPerUser)}</p>
            </div>
          </>
        )}
      </div>

      {/* Cost by Model */}
      {data.byModel.length > 0 && (
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <h4 className="text-white text-xs font-semibold mb-3">Cost by Model</h4>
          <div className="space-y-2">
            {data.byModel.map(m => (
              <div key={m.model} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400 font-mono truncate max-w-[50%]">{m.model}</span>
                  <div className="flex gap-3 text-zinc-300">
                    <span>{formatCost(m.totalCostUsd)}</span>
                    <span className="text-zinc-600 w-12 text-right">{m.percentage}%</span>
                  </div>
                </div>
                <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500/50 rounded-full transition-all"
                    style={{ width: `${Math.min(m.percentage, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Spenders — hosted only */}
      {!data.isSelfHosted && data.topSpenders.length > 0 && (
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <h4 className="text-white text-xs font-semibold mb-3">Top Spenders</h4>
          <div className="space-y-2">
            {data.topSpenders.map((u, i) => (
              <div key={u.tenantId} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-600 w-5 text-right">{i + 1}.</span>
                  <span className="text-zinc-400 truncate max-w-[35%]">{u.tenantId}</span>
                </div>
                <div className="flex gap-4 text-zinc-300">
                  <span className="font-medium">{formatCost(u.totalCostUsd)}</span>
                  <span className="text-zinc-600">{u.requestCount} req</span>
                  <span className="text-zinc-600">{formatCost(u.avgCostPerRequest)}/req</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily cost trend */}
      {data.dailyTrend.length > 0 && (
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <h4 className="text-white text-xs font-semibold mb-3">Daily Cost Trend</h4>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {(() => {
              const maxCost = Math.max(...data.dailyTrend.map(x => x.totalCostUsd))
              return data.dailyTrend.map(d => {
              const barWidth = maxCost > 0 ? (d.totalCostUsd / maxCost) * 100 : 0
              return (
                <div key={d.date} className="flex items-center gap-3 text-xs">
                  <span className="text-zinc-500 font-mono w-20 shrink-0">{d.date}</span>
                  <div className="flex-1 h-3 bg-white/[0.03] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/30 rounded-full"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="text-zinc-400 w-16 text-right">{formatCost(d.totalCostUsd)}</span>
                </div>
              )
            })})()}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Usage Section ────────────────────────────────────────────────────────────

function UsageSection() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/usage?days=${days}`)
      if (!res.ok) throw new Error('Failed to load usage')
      const d = await res.json()
      setData(d)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-red-400 py-10 justify-center">
        <AlertCircle size={16} />
        <span className="text-sm">{error ?? 'No data'}</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-white text-sm font-semibold">
          {data.isSelfHosted ? 'Your Usage' : 'Usage Overview'}
        </h3>
        <div className="flex gap-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                days === d
                  ? 'bg-white/[0.15] text-white'
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <span className="text-zinc-500 text-xs">Total Tokens</span>
          <p className="text-white text-lg font-semibold">{formatTokens(data.totalTokens)}</p>
        </div>
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <span className="text-zinc-500 text-xs">Estimated Cost</span>
          <p className="text-white text-lg font-semibold">{formatCost(data.totalCostUsd)}</p>
        </div>
      </div>

      {/* By Model */}
      {data.byModel.length > 0 && (
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <h4 className="text-white text-xs font-semibold mb-3">By Model</h4>
          <div className="space-y-2">
            {data.byModel.map(m => (
              <div key={m.model} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-mono truncate max-w-[50%]">{m.model}</span>
                <div className="flex gap-4 text-zinc-300">
                  <span>{formatTokens(m.totalTokens)}</span>
                  <span className="text-zinc-500">{formatCost(m.totalCostUsd)}</span>
                  <span className="text-zinc-600">{m.requestCount} req</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per User — only in hosted mode */}
      {!data.isSelfHosted && data.perUser.length > 0 && (
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <h4 className="text-white text-xs font-semibold mb-3">Per User</h4>
          <div className="space-y-2">
            {data.perUser.map(u => (
              <div key={u.tenantId} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 truncate max-w-[40%]">{u.tenantId}</span>
                <div className="flex gap-4 text-zinc-300">
                  <span>{formatTokens(u.totalTokens)}</span>
                  <span className="text-zinc-500">{formatCost(u.totalCostUsd)}</span>
                  <span className="text-zinc-600">{u.requestCount} req</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily usage */}
      {data.byDay.length > 0 && (
        <div className="bg-white/[0.05] border border-white/[0.10] rounded-xl p-4">
          <h4 className="text-white text-xs font-semibold mb-3">Daily Usage</h4>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {data.byDay.map(d => (
              <div key={d.date} className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 font-mono">{d.date}</span>
                <div className="flex gap-4 text-zinc-300">
                  <span>{formatTokens(d.totalTokens)}</span>
                  <span className="text-zinc-500">{formatCost(d.totalCostUsd)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Access Denied ────────────────────────────────────────────────────────────

function AccessDenied() {
  return (
    <AppPage gradient={getAppGradient('bg-zinc-800')}>
      <AppHeader title="Admin" icon="🔒" backHref="/" backLabel="Home" />
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <ShieldAlert size={48} className="text-red-400/60" />
        <h2 className="text-white text-lg font-semibold">Access Denied</h2>
        <p className="text-zinc-500 text-sm text-center max-w-xs">
          Your account does not have admin access. Contact your system administrator
          to be added to MYWAY_ADMIN_EMAILS.
        </p>
      </div>
    </AppPage>
  )
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

const VALID_TABS = new Set(getSortedAdminTabs().map(t => t.id))

function AdminPageContent() {
  const tabs = getSortedAdminTabs()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [authChecked, setAuthChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSelfHosted, setIsSelfHosted] = useState(false)

  useEffect(() => {
    fetch('/api/admin/auth')
      .then(res => res.json())
      .then(data => {
        setIsAdmin(data.isAdmin === true)
        setIsSelfHosted(data.isSelfHosted === true)
        setAuthChecked(true)
      })
      .catch(() => {
        setIsAdmin(false)
        setAuthChecked(true)
      })
  }, [])

  // Self-hosted: default to 'usage' tab (no 'users' tab)
  const defaultTab = isSelfHosted ? 'usage' : 'users'
  const rawTab = searchParams.get('tab')
  const activeTab = rawTab && VALID_TABS.has(rawTab) ? rawTab : defaultTab

  // In self-hosted mode, redirect from 'users' tab to 'usage'
  const effectiveTab = isSelfHosted && activeTab === 'users' ? 'usage' : activeTab

  function setActiveTab(tabId: string) {
    router.replace(`${pathname}?tab=${tabId}`, { scroll: false })
  }

  if (!authChecked) {
    return (
      <AppPage gradient={getAppGradient('bg-zinc-800')}>
        <AppHeader title="Admin" icon="🔒" backHref="/" backLabel="Home" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-zinc-500" />
        </div>
      </AppPage>
    )
  }

  if (!isAdmin) {
    return <AccessDenied />
  }

  // Tab ID -> section component mapping
  const TAB_COMPONENTS: Record<string, React.ReactNode> = {
    users: <UsersSection />,
    costs: <CostsSection />,
    usage: <UsageSection />,
  }

  return (
    <AppPage gradient={getAppGradient('bg-zinc-800')}>
      <AppHeader
        title="Admin"
        icon="🔒"
        backHref="/"
        backLabel="Home"
      />

      <SegmentedControl tabs={resolveAdminTabs(tabs, isSelfHosted)} value={effectiveTab} onChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {TAB_COMPONENTS[effectiveTab] ?? null}
      </div>
    </AppPage>
  )
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageContent />
    </Suspense>
  )
}
