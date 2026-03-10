'use client'

import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'Invalid or expired authentication request. Please try again.',
  missing_token: 'Authentication token was not provided.',
  invalid_token: 'Authentication token is invalid or expired.',
  token_already_used: 'This authentication link has already been used. Please log in again.',
  access_denied: 'Your account is not authorized for this Myway instance.',
  'Token expired': 'Authentication token has expired. Please try again.',
  'Invalid signature': 'Authentication token signature is invalid.',
  'Unknown partner': 'Authentication provider not recognized.',
}

export default function AuthErrorPage() {
  const searchParams = useSearchParams()
  const reason = searchParams.get('reason') || 'unknown'
  const message = ERROR_MESSAGES[reason] || 'An authentication error occurred. Please try again.'

  const appRoomUrl = process.env.NEXT_PUBLIC_APPROOM_URL || ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold text-red-400">Authentication Failed</h1>
        <p className="mt-3 text-zinc-400">{message}</p>
        <div className="mt-6 flex justify-center gap-4">
          {appRoomUrl && (
            <a
              href={appRoomUrl}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Try Again
            </a>
          )}
          <a
            href="/"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Go Home
          </a>
        </div>
      </div>
    </div>
  )
}
