/**
 * Cloudflare D1 client for Myway — wraps the D1 REST API.
 *
 * Used by Hunter resource handlers (pipeline_runs, hunter_properties)
 * when CLOUDFLARE_D1_DB_ID is configured.
 *
 * Falls back to SQLite (better-sqlite3) automatically when env vars are absent.
 */

const D1_BASE = 'https://api.cloudflare.com/client/v4'

interface D1Result {
  results: Array<Record<string, unknown>>
  success: boolean
  errors: Array<{ code: number; message: string }>
  messages: string[]
  meta?: { duration: number; rows_read: number; rows_written: number }
}

export class CloudflareD1Client {
  private readonly baseUrl: string

  constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string,
  ) {
    this.baseUrl = `${D1_BASE}/accounts/${accountId}/d1/database/${databaseId}`
  }

  async query(sql: string, params: unknown[] = []): Promise<D1Result> {
    const res = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    })

    if (!res.ok) {
      throw new Error(`D1 API error ${res.status}: ${await res.text()}`)
    }

    const data = (await res.json()) as { result: D1Result[] }
    const result = data.result[0]
    if (!result) throw new Error('D1 returned empty result array')
    if (!result.success) {
      throw new Error(`D1 query error: ${result.errors.map((e) => e.message).join(', ')}`)
    }
    return result
  }

  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query(sql, params)
    return result.results as T[]
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.query(sql, params)
    return result.meta?.rows_written ?? 0
  }
}

/** Returns a D1 client if Cloudflare credentials are configured, otherwise null (use SQLite). */
export function getD1Client(): CloudflareD1Client | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const databaseId = process.env.CLOUDFLARE_D1_DB_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !databaseId || !apiToken) return null
  return new CloudflareD1Client(accountId, databaseId, apiToken)
}
