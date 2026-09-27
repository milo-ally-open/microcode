export const COMMANDS = [
  '/clear',
  '/compact',
  '/status',
  '/model',
  '/thinking',
  '/mcp',
  '/session',
  '/tasks',
  '/new',
  '/permission',
  '/skills',
  '/help',
]

export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  '/clear': 'Clear the visible conversation',
  '/compact': 'Compact the current session context',
  '/status': 'Show runtime, model, and context state',
  '/model': 'Inspect or switch available models',
  '/thinking': 'Inspect or set reasoning effort',
  '/mcp': 'Inspect connected MCP servers',
  '/session': 'Inspect the active session and recent history',
  '/tasks': 'Inspect tracked task lists',
  '/new': 'Start a fresh session',
  '/permission': 'Inspect or set permission mode',
  '/skills': 'Inspect loaded and available skills',
  '/help': 'Show command reference',
}
