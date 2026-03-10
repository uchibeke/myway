'use client'

/**
 * Notes — Google Keep-style AI notes app.
 *
 * Two-column card grid + inline creation + full-screen editor + AI chat drawer.
 * Notes are stored as markdown files in {MYWAY_ROOT}/notes/ via /api/notes.
 * AI drawer uses /api/openclaw/chat with note context injected.
 */

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Trash2, Sparkles, ChevronDown, Check } from 'lucide-react'
import AppPage from '@/components/AppPage'
import AppHeader from '@/components/AppHeader'
import ChatInputBar from '@/components/ChatInputBar'
import VoiceMicButton from '@/components/VoiceMicButton'
import { MarkdownContent } from '@/components/MarkdownContent'
import { getAppGradient } from '@/lib/design'
import { streamDeltas } from '@/lib/stream'
import { useClientContext } from '@/hooks/useClientContext'
import { buildChatBody } from '@/lib/chat-client'
import { uid } from '@/lib/uid'

// ─── Types ────────────────────────────────────────────────────────────────────

type Note = {
  id: string
  title: string
  preview: string
  content: string
  tags: string[]
  color?: string
  createdAt: number
  updatedAt: number
}

type AiMsg = { role: 'user' | 'assistant'; content: string; streaming?: boolean }

// ─── Design tokens ────────────────────────────────────────────────────────────

const CARD_COLORS: Record<string, string> = {
  default: 'bg-white/[0.06] border-white/[0.09]',
  yellow:  'bg-yellow-500/10 border-yellow-500/20',
  blue:    'bg-blue-500/10   border-blue-500/20',
  green:   'bg-emerald-500/10 border-emerald-500/20',
  red:     'bg-red-500/10    border-red-500/20',
  purple:  'bg-purple-500/10 border-purple-500/20',
  orange:  'bg-orange-500/10 border-orange-500/20',
}

const DOT_COLORS: Record<string, string> = {
  default: 'bg-white/25 ring-1 ring-white/20',
  yellow:  'bg-yellow-400',
  blue:    'bg-blue-400',
  green:   'bg-emerald-400',
  red:     'bg-red-400',
  purple:  'bg-purple-400',
  orange:  'bg-orange-400',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relDate(ts: number): string {
  const now = Date.now()
  const diff = Math.floor((now - ts * 1000) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  const d = new Date(ts * 1000)
  const diffDays = Math.floor((now - ts * 1000) / 86_400_000)
  if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── ColorPicker ──────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {Object.entries(DOT_COLORS).map(([key, cls]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`w-4 h-4 rounded-full transition-transform ${cls}
                      ${value === key ? 'scale-125 ring-2 ring-white/50' : 'hover:scale-110'}`}
          aria-label={`${key} color`}
        />
      ))}
    </div>
  )
}

// ─── NoteCard ─────────────────────────────────────────────────────────────────

function NoteCard({ note, onClick }: { note: Note; onClick: () => void }) {
  const colorCls = CARD_COLORS[note.color || 'default']
  return (
    <button
      onClick={onClick}
      className={`w-full break-inside-avoid mb-3 rounded-2xl border p-3 text-left
                  cursor-pointer hover:brightness-110 active:scale-[0.97]
                  transition-all duration-150 ${colorCls}`}
    >
      {note.title && note.title !== 'Untitled' && (
        <p className="text-white text-xs font-semibold mb-1 leading-tight line-clamp-2">
          {note.title}
        </p>
      )}
      {note.preview && (
        <p className="text-zinc-400 text-xs leading-relaxed line-clamp-6">
          {note.preview}
        </p>
      )}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {note.tags.slice(0, 3).map((tag) => (
            <span key={tag}
              className="text-[10px] text-zinc-600 bg-white/[0.05] rounded-full px-2 py-0.5">
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="text-[10px] text-zinc-700 mt-2">{relDate(note.updatedAt)}</p>
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function NotesPageInner() {
  const router = useRouter()
  const clientContext = useClientContext()

  // ── Notes data ────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  // ── Quick create ──────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newColor, setNewColor] = useState('default')
  const [saving, setSaving] = useState(false)
  const createRef = useRef<HTMLTextAreaElement>(null)
  const voiceBaseRef = useRef<string | null>(null)

  // ── Editor (full-screen overlay) ──────────────────────────────────────────
  const [editNote, setEditNote] = useState<Note | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editColor, setEditColor] = useState('default')
  const [editSaving, setEditSaving] = useState(false)

  // ── AI drawer ─────────────────────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMsgs, setAiMsgs] = useState<AiMsg[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const aiAbort = useRef<AbortController | null>(null)
  const aiBottomRef = useRef<HTMLDivElement>(null)

  // ── Load notes ────────────────────────────────────────────────────────────
  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/notes')
      if (res.ok) {
        const { notes: data } = await res.json() as { notes: Note[] }
        setNotes(data ?? [])
      }
    } catch (err) { console.warn('[Notes] load notes failed', err) }
    setLoading(false)
  }, [])

  useEffect(() => { loadNotes() }, [loadNotes])

  // Scroll AI to bottom on new messages
  useEffect(() => {
    if (aiOpen) aiBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMsgs, aiOpen])

  // ── Quick create ──────────────────────────────────────────────────────────
  const startCreate = () => {
    setCreating(true)
    setNewContent('')
    setNewColor('default')
    setTimeout(() => createRef.current?.focus(), 30)
  }

  const cancelCreate = () => { setCreating(false); setNewContent('') }

  const saveNew = async () => {
    if (!newContent.trim()) { cancelCreate(); return }
    setSaving(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newContent,
          color: newColor === 'default' ? undefined : newColor,
        }),
      })
      if (res.ok) {
        const note = await res.json() as Note
        setNotes((prev) => [note, ...prev])
        setCreating(false)
        setNewContent('')
        setNewColor('default')
      }
    } catch (err) { console.warn('[Notes] create note failed', err) }
    setSaving(false)
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  const openEdit = (note: Note) => {
    setEditNote(note)
    setEditContent(note.content)
    setEditColor(note.color || 'default')
  }

  const closeEdit = () => { setEditNote(null) }

  const saveEdit = async () => {
    if (!editNote) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/notes?id=${encodeURIComponent(editNote.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editContent,
          tags: editNote.tags,
          color: editColor === 'default' ? undefined : editColor,
        }),
      })
      if (res.ok) {
        const updated = await res.json() as Note
        setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n))
        setEditNote(updated)
      }
    } catch (err) { console.warn('[Notes] save note failed', err) }
    setEditSaving(false)
  }

  /** Auto-save and close editor — Google Keep style */
  const handleCloseEdit = async () => {
    if (!editNote) return
    // Save if content or color changed
    const contentChanged = editContent !== editNote.content
    const colorChanged = editColor !== (editNote.color || 'default')
    if (contentChanged || colorChanged) {
      await saveEdit()
    }
    closeEdit()
  }

  const deleteNote = async (id: string) => {
    try {
      await fetch(`/api/notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      setNotes((prev) => prev.filter((n) => n.id !== id))
      closeEdit()
    } catch (err) { console.warn('[Notes] delete note failed', err) }
  }

  // ── AI chat ───────────────────────────────────────────────────────────────
  const closeAi = () => { setAiOpen(false); setAiMsgs([]) }

  const sendAi = async (overrideText?: string) => {
    const text = (overrideText ?? aiInput).trim()
    if (!text || aiBusy) return
    setAiInput('')
    setAiBusy(true)

    const assistantId = uid()
    const userMsg: AiMsg = { role: 'user', content: text }
    const assistantMsg: AiMsg = { role: 'assistant', content: '', streaming: true }
    setAiMsgs((prev) => [...prev, userMsg, assistantMsg])

    // Inject note context on first message only
    const isFirst = aiMsgs.length === 0
    const noteCtx = isFirst && notes.length > 0
      ? `\n\n---\nMy notes (${notes.length} total, most recent first):\n` +
        notes.slice(0, 30).map((n) =>
          `• **${n.title}**${n.tags.length > 0 ? ` [${n.tags.join(', ')}]` : ''}: ${n.preview.slice(0, 120)}`
        ).join('\n')
      : ''

    const apiMessages = [
      ...aiMsgs.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: text + noteCtx },
    ]

    const ac = new AbortController()
    aiAbort.current = ac

    try {
      const res = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify(buildChatBody('notes', apiMessages, { clientContext })),
      })
      if (!res.ok || !res.body) throw new Error('Request failed')

      for await (const delta of streamDeltas(res.body)) {
        setAiMsgs((prev) =>
          prev.map((m, i) => i === prev.length - 1 ? { ...m, content: m.content + delta } : m)
        )
      }

      // Reload notes in case AI created/modified any
      setTimeout(loadNotes, 800)

    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setAiMsgs((prev) =>
          prev.map((m, i) => i === prev.length - 1 ? { ...m, content: '⚠ Something went wrong' } : m)
        )
      }
    } finally {
      setAiBusy(false)
      setAiMsgs((prev) =>
        prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false } : m)
      )
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppPage
      gradient={getAppGradient('bg-green-500')}
    >
      <AppHeader
        title="Notes"
        icon="📝"
        onBack={() => router.push('/')}
        backLabel="Home"
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setAiOpen((v) => !v); setAiMsgs([]) }}
              className={`p-2 rounded-xl transition-colors
                          ${aiOpen
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-zinc-400 hover:text-white'}`}
              aria-label="Ask AI about notes"
              title="AI assistant"
            >
              <Sparkles size={17} />
            </button>
            <button
              onClick={startCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                         bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium
                         transition-colors"
              aria-label="New note"
            >
              <Plus size={13} /> New
            </button>
          </div>
        }
      />

      {/* ── Main scroll area ── */}
      <div className={`flex-1 overflow-y-auto overscroll-contain min-h-0
                       ${aiOpen ? 'pb-72' : 'pb-4'}`}>

        {/* Quick-create bar */}
        <div className="px-4 pt-4">
          {creating ? (
            <div className={`rounded-2xl border p-3 mb-1 ${CARD_COLORS[newColor]}`}>
              <textarea
                ref={createRef}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelCreate()
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNew()
                }}
                placeholder="Take a note…"
                style={{ fontSize: '16px' }}
                className="w-full bg-transparent text-white resize-none outline-none
                           placeholder:text-zinc-500 leading-relaxed min-h-[80px]"
                rows={3}
              />
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.06]">
                <div className="flex items-center gap-1">
                  <ColorPicker value={newColor} onChange={setNewColor} />
                  <VoiceMicButton
                    onTranscript={(text) => {
                      // Live: replace everything after the snapshot
                      const base = voiceBaseRef.current ?? newContent
                      if (voiceBaseRef.current === null) voiceBaseRef.current = newContent
                      const sep = base && !base.endsWith(' ') && !base.endsWith('\n') ? ' ' : ''
                      setNewContent(base + sep + text)
                    }}
                    onFinalResult={() => {
                      // Commit: snapshot becomes null, current content is final
                      voiceBaseRef.current = null
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelCreate}
                    className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveNew}
                    disabled={!newContent.trim() || saving}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg
                               bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30
                               text-white text-xs font-medium transition-colors"
                  >
                    {saving ? '…' : <><Check size={11} /> Save</>}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={startCreate}
              className="w-full px-4 py-3 rounded-2xl border border-white/[0.08]
                         bg-white/[0.03] text-zinc-500 text-sm text-left
                         hover:bg-white/[0.05] hover:border-white/[0.12] transition-colors mb-1"
            >
              Take a note…
            </button>
          )}
        </div>

        {/* Notes grid */}
        <div className="px-4 pt-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-white/10 border-t-emerald-400 rounded-full animate-spin" />
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <span className="text-5xl opacity-60">📝</span>
              <p className="text-zinc-400 text-sm font-medium">No notes yet</p>
              <p className="text-zinc-600 text-xs">
                Tap <span className="text-zinc-400 font-medium">New</span> or click the bar above
              </p>
            </div>
          ) : (
            <div className="columns-2 gap-3">
              {notes.map((note) => (
                <NoteCard key={note.id} note={note} onClick={() => openEdit(note)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Note editor modal (Google Keep style) ── */}
      {editNote && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center p-5"
          onClick={handleCloseEdit}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          {/* Modal card */}
          <div
            className={`relative w-full max-h-[80vh] flex flex-col rounded-2xl border overflow-hidden
                        ${CARD_COLORS[editColor]}`}
            style={{ backgroundColor: '#18181b' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.08] shrink-0">
              <button
                onClick={handleCloseEdit}
                className="text-zinc-400 hover:text-white transition-colors"
                aria-label="Close editor"
              >
                <X size={18} />
              </button>
              <div className="flex-1" />
              <ColorPicker value={editColor} onChange={setEditColor} />
              <button
                onClick={() => deleteNote(editNote.id)}
                className="ml-1 text-zinc-600 hover:text-red-400 transition-colors"
                aria-label="Delete note"
              >
                <Trash2 size={15} />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleCloseEdit()
              }}
              style={{ fontSize: '16px' }}
              className="flex-1 bg-transparent text-white resize-none outline-none
                         p-4 leading-relaxed placeholder:text-zinc-600 min-h-[200px]"
              placeholder="Write something…"
              autoFocus
            />

            {/* Footer */}
            <div className="px-4 py-3 border-t border-white/[0.06] flex items-center justify-between shrink-0">
              <p className="text-[10px] text-zinc-600">
                {editSaving ? 'Saving…' : 'Auto-saves on close'}
              </p>
              <button
                onClick={handleCloseEdit}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500
                           text-white text-xs font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI drawer (bottom sheet) ── */}
      {aiOpen && (
        <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col"
          style={{ height: '55%' }}>
          <div className="flex flex-col bg-zinc-950/95 backdrop-blur-xl
                          border-t border-white/[0.08] rounded-t-3xl overflow-hidden flex-1">

            {/* Drawer handle + header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
              <Sparkles size={13} className="text-emerald-400 shrink-0" />
              <span className="text-xs font-medium text-zinc-400 flex-1">
                Ask AI about your notes
              </span>
              <button
                onClick={closeAi}
                className="text-zinc-600 hover:text-zinc-300 transition-colors"
                aria-label="Close AI drawer"
              >
                <ChevronDown size={16} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
              {aiMsgs.length === 0 && (
                <div className="py-2 space-y-2">
                  {[
                    'Summarize all my notes',
                    'What did I note about work?',
                    'Help me organize my notes',
                    'What should I act on today?',
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendAi(prompt)}
                      className="w-full text-left px-3 py-2 rounded-xl bg-white/[0.04]
                                 border border-white/[0.06] text-xs text-zinc-400
                                 hover:text-zinc-200 hover:bg-white/[0.07] transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {aiMsgs.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`
                    max-w-[85%] rounded-xl text-xs leading-relaxed px-3 py-2
                    ${msg.role === 'user'
                      ? 'bg-[rgb(var(--brand-primary-rgb)/0.8)] text-white rounded-br-sm'
                      : 'bg-white/[0.06] text-zinc-300 border border-white/[0.08] rounded-bl-sm'}
                  `}>
                    {msg.role === 'user' ? msg.content : (
                      <>
                        <MarkdownContent content={msg.content} compact streaming={msg.streaming} />
                        {msg.streaming && (
                          <span className="inline-block w-0.5 h-3 bg-zinc-400 ml-0.5 animate-pulse" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={aiBottomRef} />
            </div>

            {/* AI input */}
            <div className="px-3 shrink-0">
              <ChatInputBar
                value={aiInput}
                onChange={setAiInput}
                onSend={(text) => sendAi(text)}
                placeholder="Ask about your notes…"
                disabled={aiBusy}
                appName="Notes"
                appColor="#059669"
                showAttachments={false}
                showImmersiveVoice={false}
                sendButtonClassName="bg-emerald-600 hover:bg-emerald-500"
                className="app-footer-bottom pt-2 border-t border-white/[0.06]"
              />
            </div>
          </div>
        </div>
      )}
    </AppPage>
  )
}

export default function NotesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--brand-bg)' }}>
        <div className="w-5 h-5 border-2 border-white/10 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    }>
      <NotesPageInner />
    </Suspense>
  )
}
