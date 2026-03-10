'use client'

import { useState, useCallback } from 'react'
import { Copy, Check, Share2 } from 'lucide-react'
import TTSButton from '@/components/TTSButton'
import type { useTTS } from '@/hooks/useTTS'

type Props = {
  content: string
  tts: ReturnType<typeof useTTS>
  sourceLabel?: string
  provider?: string
  ttsAvailable?: boolean
  /** Compact mode — smaller hit targets for history messages */
  compact?: boolean
}

/** Whether the browser supports the Web Share API */
function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/** Derive app name from the current URL path. /apps/chat → "Chat" */
function getAppNameFromUrl(): string {
  if (typeof window === 'undefined') return 'Myway'
  const match = window.location.pathname.match(/^\/apps\/([^/?]+)/)
  if (match) {
    return match[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }
  return 'Myway'
}

/**
 * Strip markdown formatting for clean share text.
 * Preserves readable content — removes syntax characters only.
 */
function stripMarkdown(md: string): string {
  return md
    // Code blocks (fenced) → content only
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Images → alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Links → text only
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Bold/italic (order matters: bold-italic first)
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/___(.+?)___/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    // Headers → text only
    .replace(/^#{1,6}\s+/gm, '')
    // Blockquotes
    .replace(/^>\s?/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Unordered list markers → bullet
    .replace(/^[\t ]*[-*+]\s+/gm, '• ')
    // Ordered list markers → keep number
    .replace(/^[\t ]*(\d+)\.\s+/gm, '$1. ')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Action buttons shown below each assistant message.
 * Modeled after ChatGPT / Claude.ai patterns:
 *   - Copy (with checkmark feedback)
 *   - Voice / TTS
 *   - Share (native Web Share API with APort attribution)
 */
export default function MessageActions({ content, tts, sourceLabel, provider, ttsAvailable = false, compact = false }: Props) {
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers / non-HTTPS
      const textarea = document.createElement('textarea')
      textarea.value = content
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [content])

  const handleShare = useCallback(async () => {
    const appName = getAppNameFromUrl()
    const shareUrl = `${window.location.origin}/?ref=share`

    // Clean markdown and truncate to 200 chars
    const cleaned = stripMarkdown(content)
    const truncated = cleaned.length > 200
      ? cleaned.slice(0, 200).trimEnd() + '...'
      : cleaned

    const shareText = `${truncated}\n\n— Made with Myway · Verified by APort\n${shareUrl}`

    if (canNativeShare()) {
      try {
        await navigator.share({
          title: `My Myway ${appName}`,
          text: shareText,
        })
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      } catch {
        // User cancelled or share failed — silently ignore
      }
    } else {
      // Fallback: copy share text to clipboard
      try {
        await navigator.clipboard.writeText(shareText)
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      } catch { /* ignore */ }
    }
  }, [content])

  const iconSize = compact ? 11 : 13
  const btnClass = compact
    ? 'inline-flex items-center justify-center w-5 h-5 rounded transition-colors'
    : 'inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors'

  return (
    <div className="flex items-center gap-1 mt-1.5">
      {sourceLabel && (
        <span className="text-[10px] text-zinc-600 font-medium mr-0.5">
          ⚡ {sourceLabel}
        </span>
      )}

      <button
        onClick={handleCopy}
        className={`${btnClass} ${copied
          ? 'text-emerald-400'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06]'
        }`}
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy message'}
      >
        {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      </button>

      {ttsAvailable && <TTSButton text={content} tts={tts} provider={provider} />}

      <button
        onClick={handleShare}
        className={`${btnClass} ${shared
          ? 'text-emerald-400'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06]'
        }`}
        title={shared ? 'Shared' : 'Share'}
        aria-label={shared ? 'Shared' : 'Share message'}
      >
        {shared ? <Check size={iconSize} /> : <Share2 size={iconSize} />}
      </button>
    </div>
  )
}
