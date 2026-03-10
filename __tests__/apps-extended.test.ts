import { describe, it, expect } from 'vitest'
import {
  getSortedAppTabs,
  getAIApps,
  getAmbientApps,
  getAppIncludingPrivate,
  getAllApps,
  type AppTabDef,
  type MywayApp,
} from '@/lib/apps'

describe('getSortedAppTabs', () => {
  it('sorts tabs by order field ascending', () => {
    const tabs: AppTabDef[] = [
      { id: 'c', label: 'C', icon: 'circle', order: 30 },
      { id: 'a', label: 'A', icon: 'arrow', order: 10 },
      { id: 'b', label: 'B', icon: 'box', order: 20 },
    ]

    const sorted = getSortedAppTabs(tabs)

    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate original array', () => {
    const tabs: AppTabDef[] = [
      { id: 'b', label: 'B', icon: 'box', order: 20 },
      { id: 'a', label: 'A', icon: 'arrow', order: 10 },
    ]

    getSortedAppTabs(tabs)

    expect(tabs[0].id).toBe('b') // original unchanged
  })

  it('handles empty array', () => {
    expect(getSortedAppTabs([])).toEqual([])
  })

  it('handles single element', () => {
    const tabs: AppTabDef[] = [{ id: 'only', label: 'Only', icon: 'star', order: 1 }]
    expect(getSortedAppTabs(tabs)).toHaveLength(1)
  })
})

describe('getAIApps', () => {
  it('returns only AI-category apps with skills', () => {
    const aiApps = getAIApps()

    for (const app of aiApps) {
      expect(app.category).toBe('ai')
      expect(app.skill).toBeTruthy()
    }
  })

  it('returns a non-empty list (at least one AI app exists)', () => {
    expect(getAIApps().length).toBeGreaterThan(0)
  })
})

describe('getAmbientApps', () => {
  it('returns only apps with autonomy.ambient set', () => {
    const ambientApps = getAmbientApps()

    for (const app of ambientApps) {
      expect(app.autonomy?.ambient).toBeTruthy()
    }
  })
})

describe('getAppIncludingPrivate', () => {
  it('finds a known public app', () => {
    const all = getAllApps()
    if (all.length > 0) {
      const found = getAppIncludingPrivate(all[0].id)
      expect(found).toBeDefined()
      expect(found?.id).toBe(all[0].id)
    }
  })

  it('returns undefined for nonexistent app', () => {
    expect(getAppIncludingPrivate('definitely-not-an-app-xyz')).toBeUndefined()
  })
})

describe('per-app model selection fields', () => {
  const allApps = getAllApps()

  it('creative apps (brief, somni, outreach) have modelClass set to creative', () => {
    const creativeIds = ['brief', 'somni', 'outreach']
    for (const id of creativeIds) {
      const app = allApps.find(a => a.id === id)
      expect(app, `app ${id} should exist`).toBeDefined()
      expect(app!.modelClass).toBe('creative')
    }
  })

  it('non-creative apps do not have modelClass set to creative', () => {
    const creativeIds = new Set(['brief', 'somni', 'outreach'])
    const others = allApps.filter(a => !creativeIds.has(a.id))
    for (const app of others) {
      expect(app.modelClass).not.toBe('creative')
    }
  })

  it('modelClass is only creative or fast or undefined', () => {
    for (const app of allApps) {
      if (app.modelClass !== undefined) {
        expect(['creative', 'fast']).toContain(app.modelClass)
      }
    }
  })

  it('provider and model fields are optional strings when set', () => {
    for (const app of allApps) {
      if (app.provider !== undefined) {
        expect(typeof app.provider).toBe('string')
        expect(app.provider.length).toBeGreaterThan(0)
      }
      if (app.model !== undefined) {
        expect(typeof app.model).toBe('string')
        expect(app.model.length).toBeGreaterThan(0)
      }
    }
  })
})
