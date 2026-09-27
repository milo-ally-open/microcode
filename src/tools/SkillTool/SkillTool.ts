import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { Type, type Static } from 'typebox'
import type { Skill } from '../../skill/skill.ts'
import type { PermissionBehavior } from '../../permissions/types.ts'

export const TOOL_NAME = 'skill'
export const TOOL_DEFAULT_PERMISSION: PermissionBehavior = 'allow'

const skillSchema = Type.Object({
  skill: Type.String({ description: 'The skill name to execute (e.g., "commit", "review")' }),
  args: Type.Optional(Type.String({ description: 'Optional arguments for the skill' })),
})

export type SkillToolInput = Static<typeof skillSchema>

export interface SkillToolDetails {
  skillName: string
  filePath: string
  description: string
  content: string
}

export interface SkillToolOptions {
  getSkills: () => Skill[]
}

export function createSkillToolWithAgent(
  options: SkillToolOptions,
): AgentTool<typeof skillSchema, SkillToolDetails> {
  return {
    name: 'skill',
    label: 'Skill',
    description: 'Execute a skill by name. Skills are specialized instructions for specific tasks.',
    parameters: skillSchema,
    async execute(
      _toolCallId: string,
      params: SkillToolInput,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<SkillToolDetails>> {
      const { skill: skillName } = params
      const normalizedSkill = skillName.trim()

      // Get skills from agent
      const skills = options.getSkills()

      // Find the skill by name
      const skill = skills.find((s) => s.name === normalizedSkill)

      if (!skill) {
        throw new Error(
          `Skill "${normalizedSkill}" not found. Available skills: ${skills.map((s) => s.name).join(', ')}`,
        )
      }

      // Check if skill is disabled for model invocation
      if (skill.disableModelInvocation) {
        throw new Error(
          `Skill "${normalizedSkill}" cannot be invoked by the model (disable-model-invocation is set)`,
        )
      }

      // Read the skill file content
      if (!existsSync(skill.filePath)) {
        throw new Error(`Skill file not found: ${skill.filePath}`)
      }

      const content = await readFile(skill.filePath, 'utf-8')

      return {
        content: [
          {
            type: 'text',
            text: `Executing skill: ${normalizedSkill}\n\n${content}`,
          },
        ],
        details: {
          skillName: normalizedSkill,
          filePath: skill.filePath,
          description: skill.description,
          content,
        },
      }
    },
  }
}
