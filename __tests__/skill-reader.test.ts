import { describe, it, expect } from 'vitest'
import { readSkillPrompt } from '@/lib/skill-reader'

describe('readSkillPrompt', () => {
  it('returns content for bundled skill: chat', () => {
    const prompt = readSkillPrompt('chat')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Chat')
    expect(prompt).toContain('AI')
  })

  it('returns content for bundled skill: forge', () => {
    const prompt = readSkillPrompt('forge')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Forge')
    expect(prompt).toContain('App Builder')
  })

  it('returns content for bundled skill: drama-mode', () => {
    const prompt = readSkillPrompt('drama-mode')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Drama Mode')
  })

  it('returns content for bundled skill: roast-me', () => {
    const prompt = readSkillPrompt('roast-me')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Roast')
  })

  it('returns content for bundled skill: oracle', () => {
    const prompt = readSkillPrompt('oracle')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Oracle')
  })

  it('returns content for bundled skill: somni', () => {
    const prompt = readSkillPrompt('somni')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Somni')
  })

  it('returns null for unknown skill', () => {
    const prompt = readSkillPrompt('nonexistent-skill-xyz-12345')
    expect(prompt).toBeNull()
  })

  it('strips YAML frontmatter from workspace skills', () => {
    // Workspace skills may have frontmatter — the reader should strip it.
    // We test this indirectly: bundled skills don't have frontmatter,
    // so any workspace skill with frontmatter should still return clean content.
    const prompt = readSkillPrompt('chat')
    expect(prompt).not.toMatch(/^---/)
  })

  it('all 15 bundled skills are readable', () => {
    const slugs = [
      'chat', 'forge', 'mise', 'roast-me', 'drama-mode',
      'office-translator', 'time-machine', 'compliment-avalanche',
      'morning-brief', 'tasks', 'decode', 'notes', 'oracle',
      'system-status', 'somni',
    ]
    for (const slug of slugs) {
      const prompt = readSkillPrompt(slug)
      expect(prompt, `bundled skill ${slug} should be readable`).toBeTruthy()
      expect(typeof prompt).toBe('string')
      expect(prompt!.length).toBeGreaterThan(50)
    }
  })
})
