'use client'

/**
 * Global error boundary — catches errors in the root layout itself.
 *
 * This is the last-resort fallback. Must render its own <html>/<body>
 * since the root layout may have crashed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#000', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{
          display: 'flex', minHeight: '100vh', alignItems: 'center',
          justifyContent: 'center', padding: '24px',
        }}>
          <div style={{ maxWidth: '360px', textAlign: 'center' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: 'rgba(239,68,68,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', fontSize: 20,
            }}>!</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 24 }}>
              {error.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={reset}
              style={{
                background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 12,
                padding: '10px 24px', color: '#fff', fontSize: 14, fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
