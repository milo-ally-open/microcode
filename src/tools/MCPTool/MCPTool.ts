import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type, type TSchema } from 'typebox'
import type { McpClientManager } from '../../mcp/client.ts'
import type { McpToolInfo } from '../../mcp/types.ts'
import { registerDynamicDeferredTool } from '../registry.ts'

export function formatMcpInputSchema(inputSchema: Record<string, any>): string {
  return JSON.stringify(inputSchema, null, 2)
}

function jsonSchemaToTypeBox(inputSchema: Record<string, any>): TSchema {
  if (inputSchema.properties) {
    const properties: Record<string, TSchema> = {}
    const required = Array.isArray(inputSchema.required)
      ? new Set(inputSchema.required.filter((key): key is string => typeof key === 'string'))
      : new Set<string>()

    for (const [key, prop] of Object.entries(
      inputSchema.properties as Record<string, any>,
    )) {
      let schema: TSchema
      switch (prop.type) {
        case 'string':
          schema = Type.String({ description: prop.description })
          break
        case 'number':
        case 'integer':
          schema = Type.Number({ description: prop.description })
          break
        case 'boolean':
          schema = Type.Boolean({ description: prop.description })
          break
        case 'array':
          schema = Type.Array(Type.Any(), {
            description: prop.description,
          })
          break
        case 'object':
          schema = Type.Object({}, { description: prop.description })
          break
        default:
          schema = Type.Any({ description: prop.description })
      }
      properties[key] = required.has(key) ? schema : Type.Optional(schema)
    }

    return Type.Object(properties, {
      description: inputSchema.description,
      additionalProperties: true,
    })
  }

  return Type.Object({}, { description: inputSchema.description })
}

export function createMcpTool(
  clientManager: McpClientManager,
  toolInfo: McpToolInfo,
): AgentTool {
  const schema = jsonSchemaToTypeBox(toolInfo.inputSchema)

  return {
    name: `mcp__${toolInfo.serverName}__${toolInfo.name}`,
    label: `MCP: ${toolInfo.name}`,
    description: `[MCP:${toolInfo.serverName}] ${toolInfo.description}`,
    parameters: schema,
    async execute(
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      onUpdate?: (partial: AgentToolResult<any>) => void,
    ): Promise<AgentToolResult<any>> {
      onUpdate?.({
        content: [{ type: 'text', text: `Calling ${toolInfo.serverName}/${toolInfo.name}...` }],
        details: {},
      })
      try {
        const result = await clientManager.callTool(
          toolInfo.serverName,
          toolInfo.name,
          params as Record<string, any>,
        )

        const textContent =
          result.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n') ?? ''

        return {
          content: [
            { type: 'text', text: textContent || 'Tool executed successfully' },
          ],
          details: result,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`MCP tool error: ${message}`)
      }
    },
  }
}

export function createMcpTools(clientManager: McpClientManager): AgentTool[] {
  const tools = clientManager.getAllTools()
  return tools.map((toolInfo) => createMcpTool(clientManager, toolInfo))
}

/**
 * Register MCP tools as dynamic deferred tools so they can be discovered
 * via ToolSearchTool. Call this when MCP servers connect.
 */
export function registerMcpToolsAsDeferred(clientManager: McpClientManager): void {
  const tools = clientManager.getAllTools()
  for (const toolInfo of tools) {
    const toolName = `mcp__${toolInfo.serverName}__${toolInfo.name}`
    registerDynamicDeferredTool({
      name: toolName,
      policy: { defaultPermission: 'ask' },
      agent: {
        create: () => createMcpTool(clientManager, toolInfo),
        description: `[MCP:${toolInfo.serverName}] ${toolInfo.description}`,
        schema: formatMcpInputSchema(toolInfo.inputSchema),
        shouldDefer: true,
      },
      presentation: {},
    })
  }
}
