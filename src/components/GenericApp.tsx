'use client'

/**
 * GenericApp — renders the correct interaction shell based on app.interactionType.
 *
 * This is the single entry point for all non-tool apps. Adding a new app type
 * means adding one case here — nothing else changes.
 */

import type { MywayApp } from '@/lib/apps'
import AppShell from '@/components/AppShell'
import TransformerShell from '@/components/TransformerShell'
import ButtonShell from '@/components/ButtonShell'
import FeedShell from '@/components/FeedShell'
import GenericOpener from '@/components/GenericOpener'
import AppUsageInfo from '@/components/AppUsageInfo'

type Props = {
  app: MywayApp
  /** Auto-send this message on mount — passed from URL ?q= param. */
  initialMessage?: string
  /** When true, renders in demo mode with no interactivity. */
  demo?: boolean
  /** Pre-set messages for demo mode (AppShell / chat-type apps). */
  demoMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** True while demo content is still streaming (shows streaming cursor). */
  demoStreaming?: boolean
  /** Progressively revealed content for demo mode (FeedShell / feed-type apps). */
  demoContent?: string
}

export default function GenericApp({ app, initialMessage, demo, demoMessages, demoStreaming, demoContent }: Props) {
  const type = app.interactionType ?? 'chat'
  const isPaid = app.pricing?.model === 'subscription'

  // Usage info icon for all apps (shows Pro badge for paid apps)
  const usageAction = demo ? undefined : <AppUsageInfo appId={app.id} isPaid={isPaid} />

  switch (type) {
    case 'transformer':
      return <TransformerShell app={app} initialMessage={initialMessage} contextAction={app.contextAction} />

    case 'button':
      return <ButtonShell app={app} />

    case 'feed':
      return <FeedShell app={app} demo={demo} demoContent={demoContent} demoStreaming={demoStreaming} />

    case 'canvas':
    case 'chat':
    default:
      return (
        <AppShell
          app={app}
          opener={!demo && app.opener
            ? (send) => <GenericOpener opener={app.opener!} onSend={send} contextAction={app.contextAction} />
            : undefined
          }
          headerActions={usageAction}
          initialMessage={demo ? undefined : (initialMessage ?? app.autoPrompt)}
          demo={demo}
          demoMessages={demoMessages}
          demoStreaming={demoStreaming}
        />
      )
  }
}
