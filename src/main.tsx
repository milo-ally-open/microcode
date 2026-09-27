import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { createMicrocodeAgentRuntime } from './agent/index.ts'
import { getAllModels, getCustomModelDefs, getModels } from './models/index.ts'
import { App } from './tui/app.ts'
import { McpClientManager } from './mcp/client.ts'
import { loadMcpConfig, isMcpConfigEmpty } from './mcp/config.ts'
import { listMcpServers, type ConfigScope } from './mcp/configWrite.ts'
import { SessionManager } from './session/SessionManager.ts'
import { createGitWorkTreeTool } from './tools/index.ts'
import { type PermissionMode, PERMISSION_MODES } from './permissions/index.ts'
import { cleanupImageCache } from './utils/imageUtils.ts'
import { GitWorkTreeSystem } from './git/index.ts'

declare const MACRO: {
  VERSION: string
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const val = args[idx + 1]
  if (!val || val.startsWith('-')) return undefined
  return val
}

async function handleMcpList(args: string[]): Promise<void> {
  const scope = (parseFlag(args, '--scope') ?? 'all') as ConfigScope | 'all'

  try {
    const servers = await listMcpServers(scope, process.cwd())

    if (servers.length === 0) {
      console.log('No MCP servers configured.')
      return
    }

    console.log('Configured MCP servers:\n')
    for (const { scope: s, name, config } of servers) {
      let typeDesc: string
      if ('command' in config) {
        typeDesc = `stdio → ${config.command} ${(config.args ?? []).join(' ')}`.trim()
      } else if (config.type === 'sse') {
        typeDesc = `sse → ${config.url}`
      } else if (config.type === 'http' || config.type === 'streamableHttp') {
        typeDesc = `${config.type} → ${config.url}`
      } else if (config.type === 'ws') {
        typeDesc = `ws → ${config.url}`
      } else {
        typeDesc = 'unknown transport'
      }
      console.log(`  ${name} [${s}]`)
      console.log(`    ${typeDesc}`)
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

function handleModelList(): void {
  const all = getAllModels()
  const customs = getCustomModelDefs()
  const customIds = new Set(customs.map(c => c.id))

  if (all.length === 0) {
    console.log('No models available.')
    return
  }

  console.log('Available models (provider/model):\n')
  const providers = getModels().getProviders()
  for (const provider of providers) {
    const providerModels = all.filter((model) => model.provider === provider.id)
    if (providerModels.length === 0) continue
    console.log(`${provider.name} (${provider.id})${provider.auth.oauth?.isSubscription ? ' · subscription OAuth' : ''}`)
    for (const m of providerModels) {
    const isCustom = customIds.has(m.id)
    const source = isCustom ? '[custom]' : '[built-in]'
    const keyInfo = (m as any).apiKeyEnv
      ? ` (key: $${(m as any).apiKeyEnv})`
      : provider.auth.oauth && !provider.auth.apiKey?.login
        ? ' (OAuth: /login)'
        : ` (key: ${m.api === 'openai-completions' ? '$OPENAI_API_KEY' : m.api === 'anthropic-messages' ? '$ANTHROPIC_API_KEY' : m.api === 'google-generative-ai' ? '$GEMINI_API_KEY' : '$API_KEY'})`
    const reasoning = m.reasoning ? ', reasoning' : ''
    const vision = m.input.includes('image') ? ', vision' : ''

    console.log(`  ${m.provider}/${m.id} ${source}`)
    console.log(`    ${m.name} | ${m.api} | ${m.baseUrl}`)
    console.log(`    context: ${m.contextWindow.toLocaleString()}, max tokens: ${m.maxTokens.toLocaleString()}${reasoning}${vision}${keyInfo}`)
    console.log()
    }
  }
}

async function main(): Promise<void> {
  // Set process title for better visibility in process lists
  try {
    // Try to set process title (may be limited on some platforms)
    process.title = 'microcode'
    // Also set argv0 if possible
    process.argv0 = 'microcode'
  } catch {
    // process.title may not be supported on all platforms
  }

  const args = process.argv.slice(2)

  // Handle --version/-v
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    console.log(`${MACRO.VERSION} (Microcode)`)
    process.exit(0)
  }

  // Handle --help/-h
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(`
Microcode - AI-powered coding assistant

Usage:
  microcode [options] [prompt]
  microcode mcp list

Options:
  --version, -v              Show version
  --help, -h                 Show this help
  --resume [id]              Resume a session (last session if no id given)
  --permission <mode>        Set permission mode: interactive, auto-approve, plan
  --permission-mode <mode>   (alias for --permission)
  --model <provider/model>  Override the model (e.g., anthropic/claude-sonnet-4-20250514)
  --thinking <level>         Set thinking depth: off, minimal, low, medium, high, xhigh

Interactive authentication:
  /login [provider]          Sign in (provider and method are selectable)
  /logout [provider]         Sign out of a provider
  /auth                      Show provider authentication status

MCP Commands:
  mcp list                               List configured MCP servers

Model Commands:
  model list                             List all available models (built-in + custom)

Environment Variables:
  ANTHROPIC_API_KEY     Anthropic API key
  ANTHROPIC_BASE_URL    Anthropic API base URL (default: https://api.anthropic.com/v1)
  ANTHROPIC_MODEL       Anthropic model ID (default: claude-sonnet-4-20250514)

  OPENAI_API_KEY        OpenAI API key
  OPENAI_BASE_URL       OpenAI API base URL (default: https://api.openai.com/v1)
  OPENAI_MODEL          OpenAI model ID (default: gpt-4o)

  API_KEY               Fallback API key (used with OpenAI-compatible APIs)
  BASE_URL              Fallback base URL
  MODEL                 Fallback model ID

Custom Models:
  Define custom models in ~/.microcode/config.json (user) or
  .microcode/config.json (project). See CLAUDE.md for the config format.
  Custom models appear in /model list alongside built-in ones.

MCP Configuration:
  Place config.json in ~/.microcode/ (user) or .microcode/ (project)
  with a "mcpServers" key containing server definitions.

Session Management:
  Sessions are automatically saved to ~/.microcode/sessions/
  Use --resume to continue where you left off.
  Use /compact to manually compress conversation context.
`)
    process.exit(0)
  }

  // Handle mcp subcommands: microcode mcp list
  if (args[0] === 'mcp') {
    const subcommand = args[1]
    const mcpArgs = args.slice(2)

    if (subcommand === 'list' || !subcommand) {
      await handleMcpList(mcpArgs)
      process.exit(0)
    } else {
      console.error(`Unknown mcp subcommand: ${subcommand}`)
      console.log('Usage: microcode mcp list [--scope user|project|all]')
      process.exit(1)
    }
  }

  // Handle model subcommands: microcode model list
  if (args[0] === 'model') {
    const subcommand = args[1]
    if (subcommand === 'list') {
      handleModelList()
      process.exit(0)
    } else {
      console.error(`Unknown model subcommand: ${subcommand}`)
      console.log('Usage: microcode model list')
      process.exit(1)
    }
  }

  const cwd = process.cwd()
  const resumeFlagIdx = args.indexOf('--resume')
  const resumeFlag = resumeFlagIdx !== -1
  // Session ID is the arg after --resume, if it exists and isn't another flag
  const resumeSessionId = resumeFlag
    ? (args[resumeFlagIdx + 1] && !args[resumeFlagIdx + 1].startsWith('-')
        ? args[resumeFlagIdx + 1]
        : undefined)
    : undefined
  const filteredArgs = args.filter((a) => !a.startsWith('-'))

  // Parse --permission / --permission-mode flag
  const permModeIdx = args.indexOf('--permission') !== -1
    ? args.indexOf('--permission')
    : args.indexOf('--permission-mode')
  let permissionMode: PermissionMode | undefined
  if (permModeIdx !== -1) {
    const modeArg = args[permModeIdx + 1]?.toLowerCase()
    if (modeArg && PERMISSION_MODES.includes(modeArg as PermissionMode)) {
      permissionMode = modeArg as PermissionMode
    } else {
      console.error(`Invalid permission mode: ${modeArg}. Valid modes: ${PERMISSION_MODES.join(', ')}`)
      process.exit(1)
    }
  }

  // Parse --model flag
  const modelIdx = args.indexOf('--model')
  let modelId: string | undefined
  if (modelIdx !== -1) {
    modelId = args[modelIdx + 1]
    if (!modelId || modelId.startsWith('-')) {
      console.error('Missing model ID after --model')
      process.exit(1)
    }
  }

  // Parse --thinking flag
  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
  type ThinkingLevel = (typeof THINKING_LEVELS)[number]
  const thinkingIdx = args.indexOf('--thinking')
  let thinkingLevel: ThinkingLevel | undefined
  if (thinkingIdx !== -1) {
    const levelArg = args[thinkingIdx + 1]?.toLowerCase()
    if (levelArg && THINKING_LEVELS.includes(levelArg as ThinkingLevel)) {
      thinkingLevel = levelArg as ThinkingLevel
    } else {
      console.error(`Invalid thinking level: ${levelArg}. Valid levels: ${THINKING_LEVELS.join(', ')}`)
      process.exit(1)
    }
  }

  // Create session manager
  const sessionManager = new SessionManager()

  // Resume or create session
  let restoredMessages: AgentMessage[] | null = null
  if (resumeFlag) {
    let targetSession = null

    if (resumeSessionId) {
      // Resume specific session by ID
      const sessions = await sessionManager.list()
      targetSession = sessions.find((s) => s.id.startsWith(resumeSessionId)) ?? null
      if (!targetSession) {
        console.error(`Session not found: ${resumeSessionId}`)
        process.exit(1)
      }
    } else {
      // Resume latest session for this directory
      targetSession = await sessionManager.getLatestSession(cwd)
    }

    if (targetSession) {
      try {
        restoredMessages = await sessionManager.open(targetSession)
        console.log(`Resumed session: ${targetSession.id.slice(0, 8)}`)
      } catch (error) {
        console.error(`Failed to resume session: ${error instanceof Error ? error.message : String(error)}`)
        sessionManager.beginDraft(cwd)
      }
    } else {
      console.log('No previous session found. Starting new session.')
      sessionManager.beginDraft(cwd)
    }
  } else {
    sessionManager.beginDraft(cwd)
  }

  // Create MCP client and agent without waiting for MCP servers
  const mcpClient = new McpClientManager()
  const agent = createMicrocodeAgentRuntime({
    cwd,
    modelId,
    thinkingLevel,
    permission: { mode: permissionMode },
    persistence: sessionManager,
    identity: {
      id: `assistant-${sessionManager.getSessionId() ?? 'session'}`,
      name: 'Microcode',
      role: 'assistant',
    },
  })
  // Restore messages if resuming
  if (restoredMessages && restoredMessages.length > 0) {
    agent.replaceMessages(restoredMessages, 'rebuild')
  }

  agent.addTools([createGitWorkTreeTool(() => GitWorkTreeSystem.open(cwd))])

  // Create TUI app (REPL starts immediately)
  const app = new App(agent, mcpClient, sessionManager)

  // Wire permission prompt to TUI (own tool calls)
  agent.setPermissionRequestHandler(
    (toolName, input, description) => app.promptPermission(toolName, input, description),
  )
  // Wire ask_user_question interactive handler to TUI
  agent.setAskUserQuestionHandler(
    (toolName, input) => app.promptAskUserQuestion(toolName, input),
  )

  // Handle exit from TUI (Ctrl+C, Ctrl+D, Escape)
  app.onExit = async () => {
    try {
      await agent.persistMessages()
    } catch {
      // Ignore save errors on shutdown
    }
    await sessionManager.close()
    await mcpClient.disconnectAll()
    const sessionId = sessionManager.getSessionId()
    if (sessionId) {
      console.log(`\nResume this session with: microcode --resume ${sessionId.slice(0, 8)}`)
    }
    cleanupImageCache(sessionId ?? '')
    process.exit(0)
  }

  // Connect MCP servers in background — non-blocking
  const mcpConfigs = await loadMcpConfig(cwd)
  if (!isMcpConfigEmpty(mcpConfigs)) {
    void mcpClient.connectAll(mcpConfigs).then(() => {
      // Rebuild system prompt with MCP info and deferred tool names
      app.updateMcpState(mcpClient)

      // Notify user in chat
      app.showMcpReady(mcpClient.getServerStates())
    })
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    // Save session before exit
    try {
      await agent.persistMessages()
    } catch {
      // Ignore save errors on shutdown
    }
    await sessionManager.close()
    await mcpClient.disconnectAll()
    app.stop()
    // Print resume command
    const sessionId = sessionManager.getSessionId()
    if (sessionId) {
      console.log(`\nResume this session with: microcode --resume ${sessionId.slice(0, 8)}`)
    }
    cleanupImageCache(sessionId ?? '')
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })

  // If there's an initial prompt argument, send it after app starts
  const initialPrompt = filteredArgs.join(' ')
  if (initialPrompt) {
    // Will be handled after app.run() starts
  }

  await app.run()
}

void main()
