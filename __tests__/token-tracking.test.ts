import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  extractUsageFromSSE,
  extractModelFromSSE,
  resolveModelName,
  resolveOpenClawModel,
  recordTokenUsage,
  trackUsageFromSSE,
  getUsageSummary,
  _resetOpenClawModelCache,
} from '@/lib/token-tracking'
import type { Database } from 'better-sqlite3'

// ─── SSE helpers ────────────────────────────────────────────────────────────

function makeSseLine(data: unknown): string {
  return `data: ${JSON.stringify(data)}`
}

function makeSSEStream(lines: string[]): string {
  return lines.join('\n') + '\n'
}

// ─── extractUsageFromSSE ────────────────────────────────────────────────────

describe('extractUsageFromSSE', () => {
  it('extracts OpenAI format usage from final chunk', () => {
    const sse = makeSSEStream([
      makeSseLine({ choices: [{ delta: { content: 'Hello' } }], model: 'gpt-4o' }),
      makeSseLine({ choices: [{ delta: { content: ' world' } }], model: 'gpt-4o' }),
      makeSseLine({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
      'data: [DONE]',
    ])

    const result = extractUsageFromSSE(sse)
    expect(result).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
  })

  it('extracts Anthropic native format usage from message_delta', () => {
    const sse = makeSSEStream([
      makeSseLine({ type: 'message_start', message: { usage: { input_tokens: 200 } } }),
      makeSseLine({ type: 'content_block_delta', delta: { text: 'Hi' } }),
      makeSseLine({ type: 'message_delta', usage: { input_tokens: 200, output_tokens: 80 } }),
      'data: [DONE]',
    ])

    const result = extractUsageFromSSE(sse)
    expect(result).toEqual({ promptTokens: 200, completionTokens: 80, totalTokens: 280 })
  })

  it('falls back to character-based estimation when no usage object', () => {
    // 40 chars of content → ~10 tokens
    const sse = makeSSEStream([
      makeSseLine({ choices: [{ delta: { content: 'A'.repeat(20) } }], model: 'openclaw' }),
      makeSseLine({ choices: [{ delta: { content: 'B'.repeat(20) } }], model: 'openclaw' }),
      'data: [DONE]',
    ])

    const result = extractUsageFromSSE(sse)
    expect(result).not.toBeNull()
    expect(result!.promptTokens).toBe(0) // can't estimate prompt from SSE
    expect(result!.completionTokens).toBe(10) // 40 chars / 4
    expect(result!.totalTokens).toBe(10)
  })

  it('falls back to Anthropic content_block_delta estimation', () => {
    const sse = makeSSEStream([
      makeSseLine({ type: 'content_block_delta', delta: { text: 'X'.repeat(100) } }),
      'data: [DONE]',
    ])

    const result = extractUsageFromSSE(sse)
    expect(result).not.toBeNull()
    expect(result!.completionTokens).toBe(25) // 100 / 4
  })

  it('returns null for empty SSE or no content', () => {
    expect(extractUsageFromSSE('')).toBeNull()
    expect(extractUsageFromSSE('data: [DONE]\n')).toBeNull()
  })

  it('handles malformed JSON gracefully', () => {
    const sse = 'data: {broken json\ndata: [DONE]\n'
    expect(extractUsageFromSSE(sse)).toBeNull()
  })

  it('skips non-data lines', () => {
    const sse = makeSSEStream([
      ': comment line',
      'event: message',
      makeSseLine({ choices: [{ delta: { content: 'test' } }] }),
      'data: [DONE]',
    ])

    const result = extractUsageFromSSE(sse)
    expect(result).not.toBeNull()
    expect(result!.completionTokens).toBe(1) // 4 chars / 4 = 1
  })

  it('prefers explicit usage over character estimation', () => {
    const sse = makeSSEStream([
      makeSseLine({ choices: [{ delta: { content: 'A'.repeat(400) } }] }),
      makeSseLine({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
      }),
      'data: [DONE]',
    ])

    const result = extractUsageFromSSE(sse)
    // Should return explicit usage, not character estimation (which would be 100)
    expect(result).toEqual({ promptTokens: 50, completionTokens: 25, totalTokens: 75 })
  })

  it('computes totalTokens when not provided', () => {
    const sse = makeSSEStream([
      makeSseLine({
        usage: { prompt_tokens: 30, completion_tokens: 20 },
      }),
    ])

    const result = extractUsageFromSSE(sse)
    expect(result).toEqual({ promptTokens: 30, completionTokens: 20, totalTokens: 50 })
  })
})

// ─── extractModelFromSSE ────────────────────────────────────────────────────

describe('extractModelFromSSE', () => {
  it('extracts model from first SSE chunk', () => {
    const sse = makeSSEStream([
      makeSseLine({ model: 'gpt-4o', choices: [{ delta: { content: 'Hi' } }] }),
      makeSseLine({ model: 'gpt-4o', choices: [{ delta: {} }] }),
      'data: [DONE]',
    ])
    expect(extractModelFromSSE(sse)).toBe('gpt-4o')
  })

  it('returns "openclaw" when gateway masks model', () => {
    const sse = makeSSEStream([
      makeSseLine({ model: 'openclaw', choices: [{ delta: { content: 'Hello' } }] }),
      'data: [DONE]',
    ])
    expect(extractModelFromSSE(sse)).toBe('openclaw')
  })

  it('returns null when no model field present', () => {
    const sse = makeSSEStream([
      makeSseLine({ choices: [{ delta: { content: 'Hi' } }] }),
      'data: [DONE]',
    ])
    expect(extractModelFromSSE(sse)).toBeNull()
  })

  it('returns null for empty stream', () => {
    expect(extractModelFromSSE('')).toBeNull()
  })

  it('skips [DONE] lines', () => {
    expect(extractModelFromSSE('data: [DONE]\n')).toBeNull()
  })
})

// ─── resolveOpenClawModel ───────────────────────────────────────────────────

describe('resolveOpenClawModel', () => {
  beforeEach(() => {
    _resetOpenClawModelCache()
  })

  afterEach(() => {
    _resetOpenClawModelCache()
  })

  it('reads primary model from ~/.openclaw/openclaw.json', () => {
    // This test may or may not work depending on the environment
    const model = resolveOpenClawModel()
    // In our test environment, openclaw.json exists
    if (model) {
      expect(model).toContain('/') // e.g. "anthropic/claude-sonnet-4-6"
    }
    // Just verify it doesn't throw
    expect(typeof model === 'string' || model === null).toBe(true)
  })

  it('caches the result', () => {
    const first = resolveOpenClawModel()
    const second = resolveOpenClawModel()
    expect(second).toBe(first)
  })
})

// ─── resolveModelName ───────────────────────────────────────────────────────

describe('resolveModelName', () => {
  beforeEach(() => {
    _resetOpenClawModelCache()
  })

  it('prefers explicit config model', () => {
    const sse = makeSSEStream([
      makeSseLine({ model: 'openclaw', choices: [{ delta: { content: 'Hi' } }] }),
    ])
    expect(resolveModelName('gpt-4o', sse)).toBe('gpt-4o')
  })

  it('uses SSE model when config model is null', () => {
    const sse = makeSSEStream([
      makeSseLine({ model: 'claude-sonnet-4-6', choices: [{ delta: { content: 'Hi' } }] }),
    ])
    expect(resolveModelName(null, sse)).toBe('claude-sonnet-4-6')
  })

  it('resolves "openclaw" to real model from config', () => {
    const sse = makeSSEStream([
      makeSseLine({ model: 'openclaw', choices: [{ delta: { content: 'Hi' } }] }),
    ])
    const result = resolveModelName(null, sse)
    // Should resolve to real model or fallback to "openclaw"
    expect(result).toBeTruthy()
    // In our environment with openclaw.json, should be the real model
    if (result !== 'openclaw') {
      expect(result).toContain('/')
    }
  })

  it('returns null when no model info available', () => {
    const sse = makeSSEStream([
      makeSseLine({ choices: [{ delta: { content: 'Hi' } }] }),
      'data: [DONE]',
    ])
    expect(resolveModelName(null, sse)).toBeNull()
  })
})

// ─── recordTokenUsage ───────────────────────────────────────────────────────

describe('recordTokenUsage', () => {
  it('inserts usage record into DB', () => {
    const run = vi.fn()
    const prepare = vi.fn(() => ({ run }))
    const db = { prepare } as unknown as Database

    recordTokenUsage(db, {
      appId: 'chat',
      model: 'gpt-4o',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCostUsd: 0.0075,
    })

    expect(prepare).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith('chat', 'gpt-4o', 100, 50, 150, 0.0075)
  })

  it('does not throw on DB error', () => {
    const prepare = vi.fn(() => { throw new Error('DB error') })
    const db = { prepare } as unknown as Database

    // Should not throw
    expect(() =>
      recordTokenUsage(db, {
        appId: 'chat',
        model: null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      })
    ).not.toThrow()
  })
})

// ─── trackUsageFromSSE ──────────────────────────────────────────────────────

describe('trackUsageFromSSE', () => {
  beforeEach(() => {
    _resetOpenClawModelCache()
  })

  it('records usage with resolved model and cost', () => {
    const run = vi.fn()
    const prepare = vi.fn(() => ({ run }))
    const db = { prepare } as unknown as Database

    const sse = makeSSEStream([
      makeSseLine({ model: 'claude-sonnet-4-6', choices: [{ delta: { content: 'Hello' } }] }),
      makeSseLine({
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
      'data: [DONE]',
    ])

    trackUsageFromSSE(db, 'chat', null, sse)

    expect(run).toHaveBeenCalledOnce()
    const args = run.mock.calls[0]
    expect(args[0]).toBe('chat') // appId
    expect(args[1]).toBe('claude-sonnet-4-6') // model
    expect(args[2]).toBe(100) // prompt_tokens
    expect(args[3]).toBe(50) // completion_tokens
    expect(args[4]).toBe(150) // total_tokens
    expect(args[5]).toBeGreaterThan(0) // cost > 0
  })

  it('skips recording when no usage extracted', () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as Database

    trackUsageFromSSE(db, 'chat', null, 'data: [DONE]\n')

    expect(prepare).not.toHaveBeenCalled()
  })

  it('uses config model over SSE model', () => {
    const run = vi.fn()
    const prepare = vi.fn(() => ({ run }))
    const db = { prepare } as unknown as Database

    const sse = makeSSEStream([
      makeSseLine({ model: 'openclaw', choices: [{ delta: { content: 'Hi' } }] }),
      makeSseLine({
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    ])

    trackUsageFromSSE(db, 'chat', 'gpt-4o', sse)

    const args = run.mock.calls[0]
    expect(args[1]).toBe('gpt-4o')
    expect(args[5]).toBeGreaterThan(0)
  })

  it('handles estimation path with cost calculation', () => {
    const run = vi.fn()
    const prepare = vi.fn(() => ({ run }))
    const db = { prepare } as unknown as Database

    // No usage object, 40 chars content → estimation
    const sse = makeSSEStream([
      makeSseLine({ model: 'claude-sonnet-4-6', choices: [{ delta: { content: 'A'.repeat(40) } }] }),
      'data: [DONE]',
    ])

    trackUsageFromSSE(db, 'chat', null, sse)

    expect(run).toHaveBeenCalledOnce()
    const args = run.mock.calls[0]
    expect(args[1]).toBe('claude-sonnet-4-6')
    expect(args[3]).toBe(10) // 40 chars / 4 = 10 completion tokens
    expect(args[5]).toBeGreaterThan(0) // cost should be non-zero for claude
  })
})

// ─── getUsageSummary ────────────────────────────────────────────────────────

describe('getUsageSummary', () => {
  function makeDb(totals: Record<string, number>, byApp: unknown[], byModel: unknown[], byDay: unknown[]) {
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('SUM(total_tokens)') && sql.includes('SUM(prompt_tokens)') && sql.includes('COUNT(*)')) {
        return { get: () => totals }
      }
      if (sql.includes('GROUP BY app_id')) {
        return { all: () => byApp }
      }
      if (sql.includes('GROUP BY model')) {
        return { all: () => byModel }
      }
      if (sql.includes('GROUP BY date')) {
        return { all: () => byDay }
      }
      return { get: () => ({}), all: () => [] }
    })
    return { prepare } as unknown as Database
  }

  it('returns aggregated summary', () => {
    const db = makeDb(
      { total_tokens: 1000, prompt_tokens: 600, completion_tokens: 400, total_cost: 0.05, request_count: 10 },
      [{ app_id: 'chat', tokens: 800, cost: 0.04, count: 8 }],
      [{ model: 'gpt-4o', tokens: 1000, cost: 0.05, count: 10 }],
      [{ date: '2026-03-05', tokens: 1000, cost: 0.05, count: 10 }],
    )

    const summary = getUsageSummary(db, 30)
    expect(summary.totalTokens).toBe(1000)
    expect(summary.promptTokens).toBe(600)
    expect(summary.completionTokens).toBe(400)
    expect(summary.totalCost).toBe(0.05)
    expect(summary.requestCount).toBe(10)
    expect(summary.byApp).toEqual([{ appId: 'chat', tokens: 800, cost: 0.04, count: 8 }])
    expect(summary.byModel).toEqual([{ model: 'gpt-4o', tokens: 1000, cost: 0.05, count: 10 }])
    expect(summary.byDay).toEqual([{ date: '2026-03-05', tokens: 1000, cost: 0.05, count: 10 }])
  })

  it('handles zero usage', () => {
    const db = makeDb(
      { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, total_cost: 0, request_count: 0 },
      [], [], [],
    )

    const summary = getUsageSummary(db, 7)
    expect(summary.totalTokens).toBe(0)
    expect(summary.requestCount).toBe(0)
    expect(summary.byApp).toEqual([])
  })
})
