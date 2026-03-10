'use client'

import { memo } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

/** Allow standard HTML tags but strip scripts, event handlers, iframes. */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Allow class on any element for markdown rendering (style intentionally excluded — XSS vector)
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'class'],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => !['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'].includes(tag),
  ),
}

/**
 * MarkdownContent — shared, DRY markdown renderer for all Myway surfaces.
 *
 * Layout guarantees:
 *   - Tables always scroll horizontally, never blow out the container
 *   - Code blocks scroll horizontally, never wrap
 *   - All content stays within max-w-full
 *   - Handles incomplete streaming markdown gracefully (unclosed fences, etc.)
 *
 * Used by: AppShell (chat), TransformerShell (output), ButtonShell (output), FileViewer
 *
 * Props:
 *   content  — markdown string (may be incomplete during streaming)
 *   compact  — true for chat bubbles (prose-sm), false for file viewer (regular prose)
 *   streaming — if true, patches incomplete markdown syntax at tail for clean display
 */

// ─── Myway action block stripping ────────────────────────────────────────────
//
// <myway:*> blocks are machine-readable action instructions embedded by the AI
// for server-side execution (task creation, content saves, email drafts, etc.).
// They must be stripped before display — users never see them.
//
// Also strips incomplete blocks at end-of-stream (safe for streaming rendering).
//
function stripMywayActions(text: string): string {
  return text
    .replace(/<myway:task>[\s\S]*?<\/myway:task>/g, '')             // complete task blocks
    .replace(/<myway:task>[\s\S]*$/, '')                              // incomplete task block at stream end
    .replace(/<myway:connection>[\s\S]*?<\/myway:connection>/g, '') // complete connection blocks
    .replace(/<myway:connection>[\s\S]*$/, '')                        // incomplete connection block at stream end
    .replace(/<myway:content>[\s\S]*?<\/myway:content>/g, '')       // complete content blocks (recipes, notes, etc.)
    .replace(/<myway:content>[\s\S]*$/, '')                            // incomplete content block at stream end
    .replace(/<myway:recipe>[\s\S]*?<\/myway:recipe>/g, '')         // legacy recipe blocks
    .replace(/<myway:recipe>[\s\S]*$/, '')                             // incomplete legacy recipe block
    .replace(/<myway:note>[\s\S]*?<\/myway:note>/g, '')             // legacy note blocks
    .replace(/<myway:note>[\s\S]*$/, '')                               // incomplete legacy note block
    .replace(/\n{3,}/g, '\n\n')                                        // collapse extra blank lines
}

// ─── Streaming markdown repair ────────────────────────────────────────────────
//
// During streaming, markdown can be mid-parse: an unclosed ``` fence turns everything
// after it into a code block. We detect this and add a closing fence for display only.
// The underlying content is never mutated.
//
// Also handles incomplete markdown links: [text](url streams in character-by-character,
// rendering ugly partial syntax for seconds. We detect these and show just the link
// text with a subtle "..." indicator until the full link has arrived.
//
function patchStreamingMarkdown(text: string): string {
  // 1. Fix unclosed code fences
  const fenceMatches = text.match(/^```/gm)
  const openFences = fenceMatches?.length ?? 0
  if (openFences % 2 !== 0) {
    return text + '\n```'
  }

  // 2. Fix incomplete markdown links at the tail of the stream.
  //    Patterns (all at end of content, possibly followed by whitespace):
  //      [link text](partial-url     → show "link text\u2026"
  //      [link text](                → show "link text\u2026"
  //      [partial text               → show "partial text\u2026"
  //
  //    We only patch the LAST occurrence to avoid mangling complete links
  //    earlier in the text. The regex is anchored to the end.
  text = text.replace(
    /\[([^\]]*)\]\([^)]*$/,
    (_, linkText: string) => linkText ? `${linkText}\u2026` : '\u2026',
  )
  text = text.replace(
    /\[([^\]]*?)$/,
    (match, linkText: string) => {
      // Only patch if there's no matching ] later (it's truly incomplete)
      // The $ anchor + no ] in capture already guarantees this
      return linkText ? `${linkText}\u2026` : '\u2026'
    },
  )

  return text
}

// ─── Component ───────────────────────────────────────────────────────────────

type Props = {
  content: string
  compact?: boolean    // true = prose-sm (chat bubbles), false = regular (file viewer)
  streaming?: boolean  // true = patch incomplete markdown syntax for clean display
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  compact = false,
  streaming = false,
}: Props) {
  const stripped = stripMywayActions(content)
  const displayContent = streaming ? patchStreamingMarkdown(stripped) : stripped

  return (
    <div
      className={[
        'prose prose-invert max-w-none',
        // min-w-0: allows this div to shrink in a flex context (prevents flex item
        // expansion when content is wider than the container, e.g. long pre elements).
        // break-words: forces long unbreakable strings (box-drawing chars, URLs, etc.)
        // to wrap at the container boundary rather than cause horizontal overflow.
        'min-w-0 break-words',
        compact ? 'prose-sm' : '',

        // Headings
        'prose-headings:text-zinc-100 prose-headings:font-semibold prose-headings:tracking-tight',

        // Body text
        'prose-p:text-zinc-300 prose-p:leading-relaxed',

        // Links
        'prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-a:transition-colors',

        // Inline code — remove the default backtick pseudo-elements that prose adds
        'prose-code:text-cyan-300 prose-code:bg-white/[0.08] prose-code:px-1.5 prose-code:py-0.5',
        'prose-code:rounded prose-code:text-[0.8em] prose-code:font-mono',
        'prose-code:before:content-none prose-code:after:content-none',

        // Code blocks — horizontal scroll, never wrap or blowout
        'prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/[0.08] prose-pre:rounded-xl',
        'prose-pre:overflow-x-auto prose-pre:max-w-full prose-pre:text-xs',

        // Blockquotes
        'prose-blockquote:border-l-white/20 prose-blockquote:text-zinc-400 prose-blockquote:not-italic',

        // Strong + em
        'prose-strong:text-zinc-100 prose-em:text-zinc-300',

        // HR
        'prose-hr:border-white/[0.08]',

        // Lists
        'prose-li:text-zinc-300 prose-li:my-0.5',
        'prose-ul:my-2 prose-ol:my-2',

        // Tables — overflow handled via custom wrapper below
        'prose-table:text-sm prose-table:my-0',
        'prose-th:text-zinc-300 prose-th:font-semibold prose-th:bg-white/[0.06]',
        'prose-td:text-zinc-400 prose-td:border-white/[0.06]',
        'prose-thead:border-white/[0.08] prose-tbody:divide-white/[0.06]',

        // Images
        'prose-img:rounded-xl prose-img:max-w-full',
      ].filter(Boolean).join(' ')}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          /**
           * Links — internal /apps/... routes use Next.js Link for client-side
           * navigation (deep links to tasks, notes, recipes, etc).
           * External links open in a new tab.
           */
          a: ({ href, children }) => {
            if (href && href.startsWith('/')) {
              return (
                <Link href={href} className="text-blue-400 hover:underline transition-colors">
                  {children}
                </Link>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                {children}
              </a>
            )
          },

          /**
           * Tables — wrap in a scrollable container so wide tables
           * scroll horizontally instead of busting out of the card on mobile.
           */
          table: ({ children }) => (
            <div className="overflow-x-auto w-full rounded-lg border border-white/[0.06] my-3">
              <table className="min-w-full">{children}</table>
            </div>
          ),

          /**
           * Pre (code blocks) — ensure horizontal scroll.
           * The prose-pre styles above handle background + border.
           */
          pre: ({ children }) => (
            <pre className="overflow-x-auto max-w-full">{children}</pre>
          ),
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  )
})
