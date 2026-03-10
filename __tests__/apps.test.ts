import { describe, it, expect } from 'vitest'
import {
  getAllApps,
  getLiveApps,
  getApp,
  getGenericApps,
  isPersistentApp,
  type MywayApp,
} from '@/lib/apps'

describe('App Registry', () => {
  const apps = getAllApps()

  it('has at least one app', () => {
    expect(apps.length).toBeGreaterThan(0)
  })

  it('all apps have required fields', () => {
    for (const app of apps) {
      expect(app.id, `${app.id} missing id`).toBeTruthy()
      expect(app.name, `${app.id} missing name`).toBeTruthy()
      expect(app.description, `${app.id} missing description`).toBeTruthy()
      expect(app.icon, `${app.id} missing icon`).toBeTruthy()
      expect(app.color, `${app.id} missing color`).toBeTruthy()
      expect(app.route, `${app.id} missing route`).toBeTruthy()
      expect(typeof app.live, `${app.id} live not boolean`).toBe('boolean')
      expect(app.category, `${app.id} missing category`).toBeTruthy()
    }
  })

  it('no duplicate app IDs', () => {
    const ids = apps.map(a => a.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('all routes start with /apps/', () => {
    for (const app of apps) {
      expect(app.route, `${app.id} route malformed`).toMatch(/^\/apps\//)
    }
  })

  it('route slug matches id', () => {
    for (const app of apps) {
      expect(app.route, `${app.id} route doesn't match id`).toBe(`/apps/${app.id}`)
    }
  })

  it('color is a Tailwind bg-* class', () => {
    for (const app of apps) {
      expect(app.color, `${app.id} color not bg-*`).toMatch(/^bg-/)
    }
  })

  it('interactionType is valid when set', () => {
    const valid = new Set(['chat', 'transformer', 'feed', 'canvas', 'button', 'tool'])
    for (const app of apps) {
      if (app.interactionType) {
        expect(valid.has(app.interactionType), `${app.id} has invalid interactionType: ${app.interactionType}`).toBe(true)
      }
    }
  })

  it('category is valid', () => {
    const valid = new Set(['ai', 'utility', 'system', 'daily-driver', 'meta'])
    for (const app of apps) {
      expect(valid.has(app.category), `${app.id} has invalid category: ${app.category}`).toBe(true)
    }
  })
})

describe('App Helpers', () => {
  it('getLiveApps returns only live apps', () => {
    for (const app of getLiveApps()) {
      expect(app.live).toBe(true)
    }
  })

  it('getApp returns undefined for non-existent ID', () => {
    expect(getApp('nonexistent-app-id-xyz')).toBeUndefined()
  })

  it('getApp finds known apps', () => {
    const all = getAllApps()
    if (all.length > 0) {
      const first = all[0]
      expect(getApp(first.id)?.id).toBe(first.id)
    }
  })

  it('getGenericApps excludes tool apps', () => {
    for (const app of getGenericApps()) {
      expect(app.interactionType).not.toBe('tool')
    }
  })
})

describe('isPersistentApp', () => {
  it('chat apps are persistent by default', () => {
    const app = { interactionType: 'chat' } as MywayApp
    expect(isPersistentApp(app)).toBe(true)
  })

  it('feed apps are persistent by default', () => {
    const app = { interactionType: 'feed' } as MywayApp
    expect(isPersistentApp(app)).toBe(true)
  })

  it('transformer apps are not persistent by default', () => {
    const app = { interactionType: 'transformer' } as MywayApp
    expect(isPersistentApp(app)).toBe(false)
  })

  it('button apps are not persistent by default', () => {
    const app = { interactionType: 'button' } as MywayApp
    expect(isPersistentApp(app)).toBe(false)
  })

  it('explicit storage.conversations overrides default', () => {
    const app = { interactionType: 'chat', storage: { conversations: false } } as MywayApp
    expect(isPersistentApp(app)).toBe(false)
  })

  it('explicit storage.conversations=true on transformer', () => {
    const app = { interactionType: 'transformer', storage: { conversations: true } } as MywayApp
    expect(isPersistentApp(app)).toBe(true)
  })
})
