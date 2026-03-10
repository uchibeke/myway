/**
 * Influence Posts resource handler.
 * Manages the social media content calendar — drafts, approvals, scheduled and posted content.
 */

import type { Database } from 'better-sqlite3'
import type { ResourceHandler, ListQuery } from './registry'

export const influencePostsResource: ResourceHandler = {
  list(db: Database, query: ListQuery) {
    const limit  = Math.min(Number(query.limit)  || 50, 200)
    const offset = Number(query.offset) || 0
    const status   = query.status   as string | undefined
    const platform = query.platform as string | undefined

    const conditions: string[] = ['is_deleted = 0']
    const params: unknown[] = []

    if (status)   { conditions.push('status = ?');   params.push(status) }
    if (platform) { conditions.push('platform = ?'); params.push(platform) }

    const where = conditions.join(' AND ')
    const items = db.prepare(
      `SELECT id, platform, account, integration_id, content, topic,
              status, scheduled_at, posted_at, postiz_id, tags, notes, created_at,
              qa_score, qa_report, qa_version, original_content, settings
       FROM influence_posts
       WHERE ${where}
       ORDER BY COALESCE(scheduled_at, created_at) ASC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as unknown[]

    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM influence_posts WHERE ${where}`
    ).get(...params) as { n: number }).n

    return { items, total, limit, offset }
  },

  get(db: Database, id: string) {
    return db.prepare(
      `SELECT * FROM influence_posts WHERE id = ? AND is_deleted = 0`
    ).get(id) ?? null
  },

  create(db: Database, body: Record<string, unknown>) {
    const { id, platform, account, integration_id, content } = body
    if (!id || !platform || !account || !integration_id || !content) {
      throw new Error('id, platform, account, integration_id, content are required')
    }
    db.prepare(
      `INSERT OR REPLACE INTO influence_posts
         (id, platform, account, integration_id, content, topic,
          status, scheduled_at, tags, notes, settings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, platform, account, integration_id, content,
      body.topic ?? null,
      body.status ?? 'draft',
      body.scheduled_at ?? null,
      typeof body.tags === 'string' ? body.tags : JSON.stringify(body.tags ?? []),
      body.notes ?? null,
      typeof body.settings === 'string' ? body.settings : body.settings ? JSON.stringify(body.settings) : null,
    )
    return { id: id as string }
  },

  update(db: Database, id: string, body: Record<string, unknown>) {
    const allowed = ['content', 'status', 'scheduled_at', 'notes', 'postiz_id', 'posted_at', 'tags', 'topic', 'qa_score', 'qa_report', 'qa_version', 'original_content', 'settings']
    const sets: string[] = []
    const params: unknown[] = []

    for (const key of allowed) {
      if (key in body) {
        sets.push(`${key} = ?`)
        params.push(key === 'tags' && typeof body[key] !== 'string'
          ? JSON.stringify(body[key])
          : body[key])
      }
    }
    if (sets.length === 0) return { ok: true as const }
    params.push(id)
    db.prepare(
      `UPDATE influence_posts SET ${sets.join(', ')} WHERE id = ? AND is_deleted = 0`
    ).run(...params)
    return { ok: true as const }
  },

  delete(db: Database, id: string) {
    db.prepare(
      `UPDATE influence_posts SET is_deleted = 1 WHERE id = ?`
    ).run(id)
    return { ok: true as const }
  },

  action(db: Database, actionName: string, id: string, body: Record<string, unknown>) {
    switch (actionName) {
      case 'approve':
        db.prepare(`UPDATE influence_posts SET status = 'approved' WHERE id = ? AND is_deleted = 0`).run(id)
        return { ok: true }
      case 'reject':
        db.prepare(`UPDATE influence_posts SET status = 'rejected', notes = ? WHERE id = ? AND is_deleted = 0`)
          .run(body.notes ?? null, id)
        return { ok: true }
      case 'schedule': {
        const scheduledAt = body.scheduled_at as number | undefined
        db.prepare(
          `UPDATE influence_posts SET status = 'scheduled', scheduled_at = ? WHERE id = ? AND is_deleted = 0`
        ).run(scheduledAt ?? null, id)
        return { ok: true }
      }
      case 'mark-posted': {
        db.prepare(
          `UPDATE influence_posts SET status = 'posted', posted_at = ?, postiz_id = ? WHERE id = ? AND is_deleted = 0`
        ).run(body.posted_at ?? Math.floor(Date.now() / 1000), body.postiz_id ?? null, id)
        return { ok: true }
      }
      case 'qa-pass': {
        const score = body.qa_score as number | undefined
        const report = typeof body.qa_report === 'string' ? body.qa_report : JSON.stringify(body.qa_report ?? null)
        db.prepare(
          `UPDATE influence_posts SET qa_score = ?, qa_report = ?, qa_version = COALESCE(qa_version, 0) + 1, status = 'approved' WHERE id = ? AND is_deleted = 0`
        ).run(score ?? 100, report, id)
        return { ok: true }
      }
      case 'qa-fail': {
        const score = body.qa_score as number | undefined
        const report = typeof body.qa_report === 'string' ? body.qa_report : JSON.stringify(body.qa_report ?? null)
        db.prepare(
          `UPDATE influence_posts SET qa_score = ?, qa_report = ?, qa_version = COALESCE(qa_version, 0) + 1 WHERE id = ? AND is_deleted = 0`
        ).run(score ?? 0, report, id)
        return { ok: true }
      }
      default:
        throw new Error(`Unknown action: ${actionName}`)
    }
  },
}
