import {
  loadSkills,
  readSkillBody,
  type Skill,
} from '../skill/skill.ts'

export interface LoadedSkillSnapshot {
  readonly name: string
  readonly body: string
}

export interface AgentSkillSnapshot {
  readonly available: readonly Readonly<Skill>[]
  readonly diagnostics: readonly string[]
  readonly loaded: readonly Readonly<LoadedSkillSnapshot>[]
}

export class AgentSkillManager {
  private skills: Skill[]
  private diagnostics: string[]
  private readonly loaded = new Map<string, string>()
  private readonly options: { cwd: string; skillPaths: string[]; includeDefaults: boolean }

  constructor(options: {
    cwd: string
    skillPaths?: string[]
    includeDefaults?: boolean
  }) {
    this.options = {
      cwd: options.cwd,
      skillPaths: options.skillPaths ?? [],
      includeDefaults: options.includeDefaults ?? true,
    }
    const result = loadSkills(this.options)
    this.skills = [...result.skills]
    this.diagnostics = [...result.diagnostics]
  }

  /** Reload skill definitions from configured and default skill directories. */
  refresh(): boolean {
    const result = loadSkills(this.options)
    let changed = this.diagnostics.join('\n') !== result.diagnostics.join('\n')
    const previousByName = new Map(this.skills.map((skill) => [skill.name, skill]))
    const nextByName = new Map(result.skills.map((skill) => [skill.name, skill]))

    if (previousByName.size !== nextByName.size) changed = true
    for (const [name, next] of nextByName) {
      const previous = previousByName.get(name)
      if (!previous || previous.description !== next.description || previous.filePath !== next.filePath ||
        previous.baseDir !== next.baseDir || previous.disableModelInvocation !== next.disableModelInvocation) {
        changed = true
      }
    }

    for (const [name, body] of this.loaded) {
      const skill = nextByName.get(name)
      if (!skill) {
        this.loaded.delete(name)
        changed = true
        continue
      }
      const nextBody = readSkillBody(skill)
      if (nextBody !== body) {
        this.loaded.set(name, nextBody)
        changed = true
      }
    }

    this.skills = [...result.skills]
    this.diagnostics = [...result.diagnostics]
    return changed
  }

  getSkills(): readonly Skill[] {
    return [...this.skills]
  }

  getDiagnostics(): readonly string[] {
    return [...this.diagnostics]
  }

  findSkill(name: string): Skill | undefined {
    return this.skills.find((skill) => skill.name === name)
  }

  isLoaded(name: string): boolean {
    return this.loaded.has(name)
  }

  getLoadedNames(): readonly string[] {
    return [...this.loaded.keys()]
  }

  load(name: string): Skill {
    const skill = this.findSkill(name)
    if (!skill) {
      throw new Error(
        `Skill "${name}" not found. Available skills: ${this.skills.map((item) => item.name).join(', ')}`,
      )
    }
    if (!this.loaded.has(name)) {
      this.loaded.set(name, readSkillBody(skill))
    }
    return skill
  }

  unload(name: string): boolean {
    return this.loaded.delete(name)
  }

  appendLoadedSkills(basePrompt: string): string {
    let prompt = basePrompt
    for (const [name, body] of this.loaded) {
      prompt += `\n\n# Skill: ${name}\n\n${body}`
    }
    return prompt
  }

  getSnapshot(): Readonly<AgentSkillSnapshot> {
    return Object.freeze({
      available: Object.freeze(
        this.skills.map((skill) => Object.freeze({ ...skill })),
      ),
      diagnostics: Object.freeze([...this.diagnostics]),
      loaded: Object.freeze(
        [...this.loaded.entries()].map(([name, body]) =>
          Object.freeze({ name, body }),
        ),
      ),
    })
  }
}
