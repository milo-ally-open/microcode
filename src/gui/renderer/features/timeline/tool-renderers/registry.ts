import { AskToolRenderer } from './AskToolRenderer.ts'
import { BashToolRenderer } from './BashToolRenderer.ts'
import { FallbackToolRenderer } from './FallbackToolRenderer.ts'
import { FileEditToolRenderer } from './FileEditToolRenderer.ts'
import { FileReadToolRenderer } from './FileReadToolRenderer.ts'
import { FileWriteToolRenderer } from './FileWriteToolRenderer.ts'
import { GlobToolRenderer } from './GlobToolRenderer.ts'
import { GrepToolRenderer } from './GrepToolRenderer.ts'
import { McpToolRenderer } from './McpToolRenderer.ts'
import { SkillToolRenderer } from './SkillToolRenderer.ts'
import { TaskToolRenderer } from './TaskToolRenderer.ts'
import { ToolSearchRenderer } from './ToolSearchRenderer.ts'
import { VisionToolRenderer } from './VisionToolRenderer.ts'
import { WorktreeToolRenderer } from './WorktreeToolRenderer.ts'
import { WebFetchToolRenderer } from './WebFetchToolRenderer.ts'
import { WebSearchToolRenderer } from './WebSearchToolRenderer.ts'
import type { ToolRenderer } from './types.ts'

const renderers = new Map<string, ToolRenderer>([
  ['bash', BashToolRenderer],
  ['read', FileReadToolRenderer],
  ['write', FileWriteToolRenderer],
  ['edit', FileEditToolRenderer],
  ['grep', GrepToolRenderer],
  ['glob', GlobToolRenderer],
  ['WebSearch', WebSearchToolRenderer],
  ['WebFetch', WebFetchToolRenderer],
  ['vision', VisionToolRenderer],
  ['task', TaskToolRenderer],
  ['Ask', AskToolRenderer],
  ['worktree', WorktreeToolRenderer],
  ['skill', SkillToolRenderer],
  ['search', ToolSearchRenderer],
])

export function getToolRenderer(toolName: string): ToolRenderer {
  if (toolName.startsWith('mcp__')) return McpToolRenderer
  return renderers.get(toolName) ?? FallbackToolRenderer
}
