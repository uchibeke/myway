/**
 * TTS provider registry.
 */

import type { TTSProvider, TTSProviderId } from '../types'
import { mossProvider } from './moss'
import { lmntProvider } from './lmnt'
import { elevenlabsProvider } from './elevenlabs'
import { inworldProvider } from './inworld'
import { checkIntegration } from '@/lib/integrations'

const providers: Record<TTSProviderId, TTSProvider> = {
  moss: mossProvider,
  lmnt: lmntProvider,
  elevenlabs: elevenlabsProvider,
  inworld: inworldProvider,
}

/** Preferred order when no provider is specified — try each until one is configured. */
const FALLBACK_ORDER: TTSProviderId[] = ['lmnt', 'inworld', 'elevenlabs', 'moss']

/** Get a TTS provider by ID. Falls back to the first configured provider. */
export function getProvider(id?: TTSProviderId | string): TTSProvider {
  if (id && id in providers) return providers[id as TTSProviderId]

  for (const pid of FALLBACK_ORDER) {
    if (checkIntegration(`tts.${pid}`).configured) return providers[pid]
  }

  // No provider configured — return LMNT (will throw a clear error on generate)
  return providers['lmnt']
}
