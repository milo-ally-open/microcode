import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'fs/promises'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentModelManager, resolveAgentModelConfig } from '../../src/agent/AgentModelManager.ts'
import { AgentSkillManager } from '../../src/agent/AgentSkillManager.ts'
import { AgentTokenTracker } from '../../src/agent/AgentTokenTracker.ts'

describe('agent modules', () => {
  test('model manager resolves, commits, snapshots, and tracks thinking level', () => {
    const initial = resolveAgentModelConfig('deepseek-v4-pro', 'openai-completions')
    const manager = new AgentModelManager({ ...initial, thinkingLevel: 'low' })

    const next = manager.resolve('gemini-2.5-flash', 'google-generative-ai')
    manager.commit(next)
    manager.setThinkingLevel('high')

    const snapshot = manager.getSnapshot()
    expect(manager.getModel().id).toBe('gemini-2.5-flash')
    expect(manager.getProvider()).toBe('google')
    expect(snapshot.thinkingLevel).toBe('high')
    expect(() => ((snapshot as any).provider = 'mutated')).toThrow()
  })

  test('skill manager loads skill bodies once and appends them to prompts', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'microcode-agent-skill-'))
    try {
      const dir = join(cwd, 'skills', 'alpha')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), `---\nname: alpha\ndescription: Alpha skill\n---\nBody\n`)

      const manager = new AgentSkillManager({ cwd, skillPaths: [join(cwd, 'skills')], includeDefaults: false })
      expect(manager.findSkill('alpha')?.name).toBe('alpha')
      manager.load('alpha')
      manager.load('alpha')
      expect(manager.getLoadedNames()).toEqual(['alpha'])
      expect(manager.appendLoadedSkills('Base')).toContain('# Skill: alpha')
      expect(manager.getSkills()).toHaveLength(1)
      expect(manager.getDiagnostics()).toEqual([])
      expect(manager.isLoaded('alpha')).toBe(true)
      expect(manager.getSnapshot().loaded[0].body).toBe('Body\n')
      expect(manager.unload('alpha')).toBe(true)
      expect(() => manager.load('missing')).toThrow('Skill "missing" not found')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('token tracker deduplicates assistant usage and computes context budget', () => {
    const model = resolveAgentModelConfig('deepseek-v4-pro', 'openai-completions').model
    const tracker = new AgentTokenTracker()
    const assistant = {
      role: 'assistant',
      responseId: 'resp-1',
      provider: model.provider,
      api: model.api,
      model: model.id,
      content: [{ type: 'text', text: 'done' }],
      usage: {
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheWrite: 1,
        totalTokens: 18,
        cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
      },
      timestamp: 1,
    } as any

    tracker.recordMessage(assistant)
    tracker.recordMessage(assistant)
    const snapshot = tracker.getSnapshot({ systemPrompt: '1234', messages: [assistant], model })

    expect(snapshot.session.requests).toBe(1)
    expect(snapshot.currentModel.totalTokens).toBe(18)
    expect(snapshot.context.usedTokens).toBeGreaterThan(0)
    tracker.reset()
    expect(tracker.getSnapshot({ systemPrompt: '', messages: [], model }).session.requests).toBe(0)
    tracker.rebuild([assistant])
    expect(tracker.getSnapshot({ systemPrompt: '', messages: [], model }).session.requests).toBe(1)
  })
})
