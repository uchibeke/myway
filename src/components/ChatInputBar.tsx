'use client'

import { useRef, useState, useCallback } from 'react'
import { Send, Square, Paperclip, Mic, X as XIcon } from 'lucide-react'
import VoiceMicButton from '@/components/VoiceMicButton'
import VoiceImmersive from '@/components/VoiceImmersive'
import FilePicker from '@/components/FilePicker'
import FileIcon from '@/components/files/FileIcon'
import { formatSize } from '@/lib/file-types'
import { useFileAttachments } from '@/hooks/useFileAttachments'
import { useInputMode } from '@/hooks/useInputMode'
import type { FileCategory } from '@/lib/file-types'
import type { MessageAttachment } from '@/types/attachments'

/**
 * ChatInputBar — shared input bar with voice, attachments, and send controls.
 *
 * Used by AppShell, TransformerShell, home page, and any custom app page.
 * Fully customizable via props — colors, placeholder, class overrides,
 * and feature toggles (attachments, immersive voice, stop button).
 */

type ChatInputBarProps = {
  /** Current input text (controlled) */
  value: string
  /** Called when input text changes */
  onChange: (value: string) => void
  /** Called when user submits (send button, Enter, or voice auto-submit) */
  onSend: (text: string, attachments?: MessageAttachment[]) => void
  /** Called when user hits stop (streaming mode) */
  onStop?: () => void

  /** Placeholder text. Default: "Message…" */
  placeholder?: string
  /** Whether input is disabled */
  disabled?: boolean
  /** Whether the AI is currently streaming (shows stop button) */
  busy?: boolean
  /** App name — used for voice immersive and aria labels */
  appName?: string
  /** App color — passed to VoiceImmersive orb */
  appColor?: string

  // ── Feature toggles ──────────────────────────────────────────────────────
  /** Show the paperclip/attach button. Default: true */
  showAttachments?: boolean
  /** Show the immersive voice button when input is empty. Default: true */
  showImmersiveVoice?: boolean
  /** Show the inline mic button. Default: true */
  showInlineVoice?: boolean

  // ── Style customization ──────────────────────────────────────────────────
  /** Additional className for the outer wrapper */
  className?: string
  /** Additional className for the input row (the rounded bar) */
  barClassName?: string
  /** Override the send button color. Default: "bg-[var(--brand-primary)]" */
  sendButtonClassName?: string
  /** Override the immersive mic button color */
  immersiveButtonClassName?: string
  /** Content rendered above the input bar (e.g. queued message, quota warning) */
  above?: React.ReactNode
}

export default function ChatInputBar({
  value,
  onChange,
  onSend,
  onStop,
  placeholder = 'Message…',
  disabled = false,
  busy = false,
  appName = 'Myway',
  appColor,
  showAttachments = true,
  showImmersiveVoice = true,
  showInlineVoice = true,
  className = '',
  barClassName = '',
  sendButtonClassName = 'bg-[var(--brand-primary)] hover:brightness-110',
  immersiveButtonClassName = 'bg-[var(--brand-primary)]/60 hover:bg-[var(--brand-primary)]',
  above,
}: ChatInputBarProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { isDesktop } = useInputMode()
  const { attachments, addAttachment, removeAttachment, clearAttachments } = useFileAttachments()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [voiceImmersiveOpen, setVoiceImmersiveOpen] = useState(false)

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`
  }, [onChange])

  const handleSend = useCallback(() => {
    if (!value.trim() && attachments.length === 0) return
    const atts = attachments.length > 0 ? [...attachments] : undefined
    clearAttachments()
    onSend(value.trim(), atts)
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [value, attachments, clearAttachments, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return

    if (isDesktop) {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleSend()
      }
    } else {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        handleSend()
      }
    }
  }, [isDesktop, handleSend])

  const handleVoiceTranscript = useCallback((text: string) => {
    onChange(text)
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 140)}px`
    }
  }, [onChange])

  const handleVoiceFinalResult = useCallback((text: string) => {
    if (text.trim()) {
      onChange('')
      onSend(text.trim())
    }
  }, [onChange, onSend])

  const handleImmersiveSubmit = useCallback((text: string) => {
    setVoiceImmersiveOpen(false)
    onSend(text)
  }, [onSend])

  const hasContent = value.trim().length > 0 || attachments.length > 0

  return (
    <>
      <div className={`shrink-0 ${className}`}>
        {above}

        {/* Attachment chips */}
        {showAttachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 px-1">
            {attachments.map((att) => (
              <span key={att.path} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl
                                              bg-white/[0.07] border border-white/[0.10] text-xs text-zinc-300">
                <FileIcon ext={att.ext} category={att.category as FileCategory} size={12} />
                <span className="truncate max-w-[130px] font-medium">{att.name}</span>
                <span className="text-zinc-600">{formatSize(att.size)}</span>
                <button onClick={() => removeAttachment(att.path)}
                  className="ml-0.5 text-zinc-600 hover:text-zinc-300 transition-colors" aria-label={`Remove ${att.name}`}>
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className={`flex items-end gap-2 bg-white/[0.05] rounded-2xl px-3 py-2
                        border border-white/[0.10] focus-within:border-white/20 transition-colors ${barClassName}`}>
          {showAttachments && (
            <button onClick={() => setPickerOpen(true)}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg mb-1
                         text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.08] transition-colors"
              aria-label="Attach file from vault" title="Attach file">
              <Paperclip size={14} />
            </button>
          )}
          {showInlineVoice && (
            <VoiceMicButton
              onTranscript={handleVoiceTranscript}
              onFinalResult={handleVoiceFinalResult}
              disabled={disabled}
            />
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={`Message ${appName}`}
            style={{ fontSize: '16px' }}
            className="flex-1 bg-transparent text-white outline-none resize-none
                       placeholder:text-zinc-500 py-1.5 min-w-0 max-h-[140px] leading-relaxed disabled:opacity-50"
          />
          {busy && onStop ? (
            <button onClick={onStop}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl
                         bg-white/10 hover:bg-white/15 text-white transition-colors mb-0.5"
              aria-label="Stop">
              <Square size={13} fill="currentColor" />
            </button>
          ) : !hasContent && showImmersiveVoice ? (
            <button onClick={() => setVoiceImmersiveOpen(true)}
              disabled={disabled}
              className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-xl
                         disabled:opacity-30 disabled:cursor-not-allowed
                         text-white transition-colors mb-0.5 ${immersiveButtonClassName}`}
              aria-label="Voice input">
              <Mic size={14} />
            </button>
          ) : (
            <button onClick={handleSend}
              disabled={!hasContent}
              className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-xl
                         text-white transition-colors mb-0.5
                         disabled:opacity-30 disabled:cursor-not-allowed ${sendButtonClassName}`}
              aria-label="Send">
              <Send size={13} />
            </button>
          )}
        </div>
      </div>

      {showAttachments && (
        <FilePicker
          open={pickerOpen}
          onSelect={(att) => { addAttachment(att); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {showImmersiveVoice && (
        <VoiceImmersive
          open={voiceImmersiveOpen}
          onClose={() => setVoiceImmersiveOpen(false)}
          onSubmit={handleImmersiveSubmit}
          appName={appName}
          appColor={appColor}
        />
      )}
    </>
  )
}

/**
 * Ref handle for imperative control (e.g. focus, reset height).
 * Reserved for future use.
 */
