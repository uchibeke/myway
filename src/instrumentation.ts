/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * This is the correct place to start background processes in Next.js.
 * It runs in the Node.js runtime only (not Edge) and fires before
 * any request is handled.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in Node.js runtime (not Edge runtime / client)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // ── Connection sync scheduler (OAuth refresh, Gmail/Calendar pull) ─────
    const { startScheduler } = await import('@/lib/scheduler')
    startScheduler()

    // ── Built-in cron engine (DB-backed, works without OpenClaw) ─────────
    const { startCronEngine } = await import('@/lib/cron-engine')
    startCronEngine()

    // ── Usage sync cron (push token usage to AppRoom hourly) ─────────────
    const { startUsageSyncCron } = await import('@/lib/usage-sync-cron')
    startUsageSyncCron()

    // ── APort audit log tailer (file mode only) ─────────────────────────────
    // Tails the local audit.log written by OpenClaw CLI (self-hosted).
    // Logged-in users get audit events via verifyAction() → tenant DB instead.
    // Only start if the file exists — no-op otherwise.
    {
      const { existsSync } = await import('fs')
      const { getAportConfig } = await import('@/lib/aport/config')
      const auditPath = getAportConfig().auditLog
      if (existsSync(auditPath)) {
        const { auditTailer } = await import('@/lib/aport/audit-tailer')
        auditTailer.start(auditPath)
      }
    }
  }
}
