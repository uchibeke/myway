/**
 * Tests for the setup nudge / onboarding proposal system.
 *
 * The home screen's ambient layer weaves setup nudges into the proposal cards
 * based on what the user has configured. No wizard — just contextual hints.
 */

import { describe, it, expect } from 'vitest'
import {
  getSetupNudges,
  getProposals,
  getVisitorProposals,
  getContextLine,
  getVisitorContextLine,
  type SetupStatus,
} from '@/lib/home-proposals'

describe('getSetupNudges', () => {
  it('returns all nudges for a brand new user', () => {
    const nudges = getSetupNudges({
      hasProfile: false,
      hasConnections: false,
      hasNotes: false,
      hasUsedChat: false,
      hasTasks: false,
    })
    expect(nudges.length).toBe(5)
    expect(nudges[0].appId).toBe('settings')
    expect(nudges[0].href).toBe('/apps/settings?tab=profile')
    expect(nudges[1].appId).toBe('chat')
    expect(nudges[1].badge).toBe('start')
  })

  it('returns empty for a fully set up user', () => {
    const nudges = getSetupNudges({
      hasProfile: true,
      hasConnections: true,
      hasNotes: true,
      hasUsedChat: true,
      hasTasks: true,
    })
    expect(nudges).toEqual([])
  })

  it('returns only relevant nudges for partial setup', () => {
    const nudges = getSetupNudges({
      hasProfile: true,
      hasConnections: false,
      hasNotes: true,
      hasUsedChat: true,
      hasTasks: false,
    })
    expect(nudges.length).toBe(2)
    expect(nudges.map(n => n.appId)).toEqual(['tasks', 'settings'])
    expect(nudges[1].href).toBe('/apps/settings?tab=connections')
  })

  it('returns empty for undefined setup', () => {
    expect(getSetupNudges(undefined)).toEqual([])
  })

  it('prioritizes profile over chat over notes', () => {
    const nudges = getSetupNudges({
      hasProfile: false,
      hasConnections: true,
      hasNotes: false,
      hasUsedChat: false,
      hasTasks: true,
    })
    expect(nudges[0].title).toBe('Make Myway yours')
    expect(nudges[1].title).toBe('Say hello')
    expect(nudges[2].title).toBe('Capture your first thought')
  })

  it('deep-links settings nudges to the correct tab', () => {
    const nudges = getSetupNudges({
      hasProfile: false,
      hasConnections: false,
      hasNotes: true,
      hasUsedChat: true,
      hasTasks: true,
    })
    const profileNudge = nudges.find(n => n.title === 'Make Myway yours')
    const connectNudge = nudges.find(n => n.title === 'Connect your world')
    expect(profileNudge?.href).toBe('/apps/settings?tab=profile')
    expect(connectNudge?.href).toBe('/apps/settings?tab=connections')
  })
})

describe('getProposals', () => {
  const fullSetup: SetupStatus = {
    hasProfile: true, hasConnections: true, hasNotes: true,
    hasUsedChat: true, hasTasks: true,
  }

  it('returns 3 proposals for every time slot', () => {
    for (const hour of [0, 3, 6, 10, 13, 15, 18, 21, 23]) {
      const proposals = getProposals(hour, null, fullSetup)
      expect(proposals.length).toBe(3)
    }
  })

  it('weaves setup nudges into last slot for returning user with gaps', () => {
    const partialSetup: SetupStatus = {
      hasProfile: true, hasConnections: false, hasNotes: true,
      hasUsedChat: true, hasTasks: true,
    }
    const proposals = getProposals(10, null, partialSetup)
    expect(proposals.length).toBe(3)
    expect(proposals[2].title).toBe('Connect your world')
  })

  it('shows interactive apps + setup nudge for brand new user', () => {
    const newSetup: SetupStatus = {
      hasProfile: false, hasConnections: false, hasNotes: false,
      hasUsedChat: false, hasTasks: false,
    }
    const proposals = getProposals(10, null, newSetup)
    expect(proposals.length).toBe(3)
    // New users get fun/interactive apps first, with a setup nudge woven in
    expect(proposals[0].appId).toBe('chat')
    expect(proposals[0].badge).toBe('start')
    expect(proposals[1].appId).toBe('somni')
    // Last card is the top setup nudge (profile)
    expect(proposals[2].appId).toBe('settings')
    expect(proposals[2].badge).toBe('setup')
  })

  it('includes task context in subtitles when available', () => {
    const tasks = { totalOpen: 5, dueToday: 2, mit: 'Fix auth bug' }
    const proposals = getProposals(6, tasks, fullSetup)
    const brief = proposals.find(p => p.appId === 'brief')
    expect(brief?.subtitle).toContain('Fix auth bug')
  })
})

describe('getVisitorProposals', () => {
  it('returns 5 proposals for every time slot', () => {
    for (const hour of [0, 3, 6, 10, 13, 15, 18, 21, 23]) {
      const proposals = getVisitorProposals(hour, {})
      expect(proposals.length).toBe(5)
    }
  })

  it('includes city in hero subtitle when available', () => {
    const proposals = getVisitorProposals(10, { city: 'San Francisco' })
    expect(proposals[0].subtitle).toContain('San Francisco')
  })

  it('works without any hints', () => {
    const proposals = getVisitorProposals(10, {})
    expect(proposals.length).toBe(5)
    expect(proposals[0].badge).toBe('now')
  })

  it('hero card varies by time of day', () => {
    const morning = getVisitorProposals(7, {})
    const evening = getVisitorProposals(19, {})
    const night = getVisitorProposals(23, {})
    expect(morning[0].appId).toBe('brief')
    expect(evening[0].appId).toBe('mise')
    expect(night[0].appId).toBe('somni')
  })

  it('includes personality/fun apps', () => {
    const proposals = getVisitorProposals(10, {})
    const allIds = proposals.map(p => p.appId)
    // Should have a mix of hero + personality + depth, not just utility
    const funApps = ['roast', 'oracle', 'drama', 'decode', 'compliment-avalanche', 'somni']
    const hasFun = allIds.some(id => funApps.includes(id))
    expect(hasFun).toBe(true)
  })
})

describe('getContextLine', () => {
  it('returns welcome for new user with no profile and no chat', () => {
    const line = getContextLine(null, {
      hasProfile: false, hasConnections: false, hasNotes: false,
      hasUsedChat: false, hasTasks: false,
    }, 'ambient thought')
    expect(line).toContain('Welcome home')
  })

  it('returns task summary when tasks exist', () => {
    const line = getContextLine(
      { totalOpen: 3, dueToday: 1, mit: 'Ship it' },
      { hasProfile: true, hasConnections: true, hasNotes: true, hasUsedChat: true, hasTasks: true },
      'ambient',
    )
    expect(line).toContain('3 tasks')
    expect(line).toContain('1 due today')
    expect(line).toContain('Ship it')
  })

  it('falls back to ambient thought', () => {
    const line = getContextLine(null, {
      hasProfile: true, hasConnections: false, hasNotes: false,
      hasUsedChat: true, hasTasks: false,
    }, 'The golden hour')
    expect(line).toBe('The golden hour')
  })
})

describe('getVisitorContextLine', () => {
  it('includes city when available', () => {
    expect(getVisitorContextLine({ city: 'Tokyo' })).toContain('Tokyo')
  })

  it('returns a rotating thought without city', () => {
    const line = getVisitorContextLine({})
    // Should be one of the rotating visitor thoughts
    expect(line.length).toBeGreaterThan(10)
    expect(line).not.toContain('undefined')
  })
})
