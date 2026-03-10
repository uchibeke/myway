'use client'

import { useState } from 'react'

type SensitiveTextProps = {
  value: string
  className?: string
  /** Show last N characters unmasked (e.g. 4 on email shows ••••l.com) */
  visibleChars?: number
}

function mask(value: string, visibleChars?: number): string {
  if (!visibleChars || visibleChars >= value.length) {
    return '\u2022'.repeat(value.length)
  }
  const hidden = value.length - visibleChars
  return '\u2022'.repeat(hidden) + value.slice(-visibleChars)
}

export default function SensitiveText({ value, className, visibleChars }: SensitiveTextProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <button
      type="button"
      onClick={() => setRevealed((r) => !r)}
      aria-label={revealed ? 'Hide' : 'Show'}
      className={`inline cursor-pointer hover:opacity-70 transition-opacity ${className ?? ''}`}
    >
      {revealed ? value : mask(value, visibleChars)}
    </button>
  )
}
