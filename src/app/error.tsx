'use client'

/**
 * Page-level error boundary — catches rendering errors in page components.
 *
 * Shows a recoverable error UI instead of a blank/black screen.
 * The user can retry without losing their place in the app.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <span className="text-xl">!</span>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-white">Something went wrong</h2>
        <p className="mb-6 text-sm text-white/50">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          className="rounded-xl bg-white/10 px-6 py-2.5 text-sm font-medium text-white
                     hover:bg-white/15 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
