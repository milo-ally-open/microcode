import { createMicrocodeAgentRuntime, type MicrocodeAgent } from '../agent/index.ts'
import { getWorkerPrompt } from './prompts.ts'
import type { AgentFactoryContext } from './types.ts'

import { TOOL_NAME as READ_TOOL_NAME } from '../tools/FileReadTool/FileReadTool.ts'
import { TOOL_NAME as GREP_TOOL_NAME } from '../tools/GrepTool/GrepTool.ts'
import { TOOL_NAME as GLOB_TOOL_NAME } from '../tools/GlobTool/GlobTool.ts'
import { TOOL_NAME as VISION_TOOL_NAME } from '../tools/VisionTool/VisionTool.ts'
import { TOOL_NAME as SKILL_TOOL_NAME } from '../tools/SkillTool/SkillTool.ts'
import { TOOL_SEARCH_TOOL_NAME } from '../tools/ToolSearchTool/ToolSearchTool.ts'
import { TOOL_NAME as TASK_TOOL_NAME } from '../tools/TaskTool/TaskTool.ts'
import { ASK_USER_QUESTION_TOOL_NAME } from '../tools/AskUserQuestionTool/AskUserQuestionTool.ts'
import { TOOL_NAME as SPAWN_TOOL_NAME } from '../tools/SpawnAgentTool/SpawnAgentTool.ts'
import { TOOL_NAME as MESSAGE_TOOL_NAME } from '../tools/SendAgentMessageTool/SendAgentMessageTool.ts'
import { TOOL_NAME as STOP_TOOL_NAME } from '../tools/StopAgentTool/StopAgentTool.ts'
import { TOOL_NAME as STATUS_TOOL_NAME } from '../tools/GetAgentStatusTool/GetAgentStatusTool.ts'
import { TOOL_NAME as BASH_TOOL_NAME } from '../tools/BashTool/BashTool.ts'
import { TOOL_NAME as EDIT_TOOL_NAME } from '../tools/FileEditTool/FileEditTool.ts'
import { TOOL_NAME as WRITE_TOOL_NAME } from '../tools/FileWriteTool/FileWriteTool.ts'

const ALWAYS_DENIED = new Set([
  TASK_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  SPAWN_TOOL_NAME,
  MESSAGE_TOOL_NAME,
  STOP_TOOL_NAME,
  STATUS_TOOL_NAME,
])

const DEFAULT_TOOLS = [
  READ_TOOL_NAME,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  VISION_TOOL_NAME,
  SKILL_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
]

export function getDefaultWorkerTools(): string[] {
  return [...DEFAULT_TOOLS]
}

export function createWorkerAgent(context: AgentFactoryContext): MicrocodeAgent {
  const { parent, request, agentId } = context
  const parentSnapshot = parent.getSnapshot()

  const parentToolNames = new Set(parentSnapshot.toolNames)
  const allowed = request.tools
    ? request.tools.filter((name) => parentToolNames.has(name))
    : DEFAULT_TOOLS.filter((name) => parentToolNames.has(name))

  const cwd = request.cwd ?? parentSnapshot.cwd
  const worker = createMicrocodeAgentRuntime({
    cwd,
    modelId: request.modelId ?? `${parentSnapshot.model.provider}/${parentSnapshot.model.id}`,
    api: parentSnapshot.model.api,
    thinkingLevel: parent.getThinkingLevel(),
    identity: {
      id: agentId,
      name: request.description,
      role: request.role ?? 'worker',
      parentId: request.parentAgentId,
    },
    permission: {
      mode: 'auto-approve',
    },
    systemPromptSuffix: getWorkerPrompt(
      request.parentAgentId,
      request.description,
      cwd,
      allowed.filter((name) => !ALWAYS_DENIED.has(name)),
    ),
  })

  worker.inheritPermissions(parent.getPermissionSnapshot(), [], false)

  for (const skillName of parent.getLoadedSkillNames()) {
    if (worker.getSkills().some((skill) => skill.name === skillName)) {
      worker.loadSkill(skillName)
    }
  }

  const allToolNames = worker.getSnapshot().toolNames
  const toRemove = allToolNames.filter(
    (name) => ALWAYS_DENIED.has(name) || !allowed.includes(name),
  )
  worker.removeTools(toRemove)
  return worker
}
