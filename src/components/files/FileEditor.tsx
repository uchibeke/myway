'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import { Check, Loader2, AlertCircle, Clock } from 'lucide-react'
import { getLanguageKey } from '@/lib/file-types'

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'

type Props = {
  filePath: string
  ext: string
  initialContent: string
  onStatusChange?: (status: SaveStatus) => void
}

const AUTO_SAVE_DELAY_MS = 1500

function getExtensions(ext: string) {
  const lang = getLanguageKey(ext)
  const base = [
    EditorView.theme({
      '&': { backgroundColor: 'transparent', height: '100%' },
      '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '13px', lineHeight: '1.6' },
      '.cm-line': { padding: '0 16px' },
      '.cm-gutters': { backgroundColor: '#111113', borderRight: '1px solid #27272a', color: '#52525b' },
      '.cm-activeLineGutter': { backgroundColor: '#18181b' },
      '.cm-activeLine': { backgroundColor: '#18181b' },
      '.cm-cursor': { borderLeftColor: '#60a5fa' },
      '.cm-selectionBackground, ::selection': { backgroundColor: '#1e3a5f !important' },
    }),
  ]

  switch (lang) {
    case 'tsx': return [...base, javascript({ typescript: true, jsx: true })]
    case 'javascript': return [...base, javascript({ jsx: true })]
    case 'python': return [...base, python()]
    case 'json': return [...base, json()]
    case 'css': return [...base, css()]
    case 'html': return [...base, html()]
    case 'markdown': return [...base, markdown()]
    default: return base
  }
}

async function saveFile(filePath: string, content: string): Promise<void> {
  const res = await fetch('/api/files', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Save failed')
  }
}

export function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'saved') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <Check size={12} />
        Saved
      </span>
    )
  }
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1 text-xs text-zinc-400">
        <Loader2 size={12} className="animate-spin" />
        Saving…
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <AlertCircle size={12} />
        Error
      </span>
    )
  }
  // unsaved
  return (
    <span className="flex items-center gap-1 text-xs text-amber-400">
      <Clock size={12} />
      Unsaved
    </span>
  )
}

export default function FileEditor({ filePath, ext, initialContent, onStatusChange }: Props) {
  const [content, setContent] = useState(initialContent)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)

  const updateStatus = useCallback((s: SaveStatus) => {
    setStatus(s)
    onStatusChange?.(s)
  }, [onStatusChange])

  const triggerSave = useCallback(async (value: string) => {
    updateStatus('saving')
    try {
      await saveFile(filePath, value)
      updateStatus('saved')
    } catch {
      updateStatus('error')
    }
  }, [filePath, updateStatus])

  // Cmd/Ctrl + S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (debounceRef.current) clearTimeout(debounceRef.current)
        triggerSave(content)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [content, triggerSave])

  const handleChange = useCallback((value: string) => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setContent(value)
    updateStatus('unsaved')

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => triggerSave(value), AUTO_SAVE_DELAY_MS)
  }, [triggerSave, updateStatus])

  // Cleanup on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const extensions = getExtensions(ext)

  return (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      <CodeMirror
        value={content}
        onChange={handleChange}
        extensions={extensions}
        theme="dark"
        className="flex-1 overflow-auto text-sm"
        height="100%"
        style={{ height: '100%', overflow: 'auto' }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          indentOnInput: true,
          tabSize: 2,
        }}
      />
    </div>
  )
}
