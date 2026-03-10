'use client'

import { useState, useCallback } from 'react'
import type { MessageAttachment } from '@/types/attachments'

/**
 * Manages the list of files attached to the current message being composed.
 * Pure state — no side effects. Cleared automatically after each send.
 */
export function useFileAttachments() {
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])

  const addAttachment = useCallback((att: MessageAttachment) => {
    setAttachments((prev) => {
      // Deduplicate by path
      if (prev.some((a) => a.path === att.path)) return prev
      return [...prev, att]
    })
  }, [])

  const removeAttachment = useCallback((path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path))
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments([])
  }, [])

  return { attachments, addAttachment, removeAttachment, clearAttachments }
}
