/**
 * GET /api/integrations/status — which integrations are configured.
 *
 * Returns booleans + setup hints only — never leaks env var values.
 */

import { checkAllIntegrations, isAnyTTSConfigured } from '@/lib/integrations'

export async function GET() {
  const all = checkAllIntegrations()

  // Strip missingVars from the public response (only expose configured + hint)
  const integrations: Record<string, { configured: boolean; name: string; setupHint: string }> = {}
  for (const [id, status] of Object.entries(all)) {
    integrations[id] = {
      configured: status.configured,
      name: status.name,
      setupHint: status.setupHint,
    }
  }

  return Response.json({
    integrations,
    ttsAvailable: isAnyTTSConfigured(),
  })
}
