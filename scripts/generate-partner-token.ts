#!/usr/bin/env npx tsx
/**
 * CLI helper — generate an HMAC-signed partner token for testing.
 *
 * Usage:
 *   npx tsx scripts/generate-partner-token.ts --partner approom --user user-123 --secret <hex>
 *
 * Options:
 *   --partner <id>    Partner ID (e.g. approom)
 *   --user <id>       User/tenant ID
 *   --secret <hex>    Shared secret (hex string, 32+ chars)
 *   --ttl <minutes>   Token lifetime in minutes (default: 5)
 *
 * Output: the signed token string (base64url payload + '.' + hmac hex)
 */

import { createHmac } from 'crypto'

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString('base64url')
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      result[args[i].slice(2)] = args[i + 1]
      i++
    }
  }
  return result
}

const opts = parseArgs(process.argv.slice(2))

if (!opts.partner || !opts.user || !opts.secret) {
  console.error('Usage: npx tsx scripts/generate-partner-token.ts --partner <id> --user <userId> --secret <hex>')
  console.error('')
  console.error('Options:')
  console.error('  --partner <id>      Partner ID (e.g. approom)')
  console.error('  --user <id>         User/tenant ID')
  console.error('  --secret <hex>      Shared HMAC secret (hex, 32+ chars)')
  console.error('  --ttl <minutes>     Token lifetime (default: 5)')
  process.exit(1)
}

const ttlMinutes = parseInt(opts.ttl || '5', 10)
const now = Date.now()

const payload = {
  userId: opts.user,
  partnerId: opts.partner,
  timestamp: now,
  expiresAt: now + ttlMinutes * 60 * 1000,
}

const encoded = base64urlEncode(JSON.stringify(payload))
const signature = createHmac('sha256', opts.secret).update(encoded).digest('hex')
const token = `${encoded}.${signature}`

console.log('')
console.log('Payload:')
console.log(JSON.stringify(payload, null, 2))
console.log('')
console.log('Token:')
console.log(token)
console.log('')
console.log(`Expires in ${ttlMinutes} minutes (${new Date(payload.expiresAt).toISOString()})`)
console.log('')
console.log('Test with:')
console.log(`  curl -X POST http://localhost:48291/api/partner/auth \\`)
console.log(`    -H 'Content-Type: application/json' \\`)
console.log(`    -d '{"token":"${token}"}'`)
