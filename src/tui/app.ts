import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import type { AuthPrompt, AuthType } from '@earendil-works/pi-ai'
import {
  TUI,
  ProcessTerminal,
  Container,
  Text,
  Spacer,
  SelectList,
  type SelectItem,
  type Component,
  type AutocompleteProvider,
  type SlashCommand,
} from '@earendil-works/pi-tui'
import chalk from 'chalk'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { getAllModels, getModels, resolveApiKey } from '../models/index.ts'
import { theme, getEditorTheme, getMarkdownTheme, getBashModeBorderColor } from './theme.ts'
import { MicrocodeEditor } from './components/microcodeEditor.ts'
import { FooterComponent } from './components/footer.ts'
import { AssistantMessageComponent } from './components/assistantMessage.ts'
import { ToolExecutionComponent } from './components/toolExecution.ts'
import { BashExecutionComponent } from './components/bashExecution.ts'
import { getToolUIConstructor, type ToolUIComponent } from '../tools/registry.ts'
import { UserMessage } from './components/userMessage.ts'
import { TurnTimeline } from './components/turnTimeline.ts'
import type { ImageContent } from '@earendil-works/pi-ai'
import { modelSupportsImages } from '../models/index.ts'
import {
  collectImagePathsFromText,
  stripImagePathsFromText,
  tryReadImageFromPath,
  storeImage,
  type CachedImage,
} from '../utils/imageUtils.ts'
import { existsSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import type { McpClientManager } from '../mcp/client.ts'
import type { McpServerState } from '../mcp/types.ts'
import { TOOL_NAME as BASH_TOOL_NAME } from '../tools/BashTool/BashTool.ts'
import { TOOL_NAME as READ_TOOL_NAME } from '../tools/FileReadTool/FileReadTool.ts'
import { TOOL_NAME as WRITE_TOOL_NAME } from '../tools/FileWriteTool/FileWriteTool.ts'
import { TOOL_NAME as EDIT_TOOL_NAME } from '../tools/FileEditTool/FileEditTool.ts'
import { SessionManager } from '../session/SessionManager.ts'
import type { MicrocodeAgent, MicrocodeAgentEvent } from '../agent/index.ts'
import type { Skill } from '../skill/skill.ts'
import { type PermissionMode, PERMISSION_MODES } from '../permissions/index.ts'
import type { TaskList } from '../tasks/TaskSystem.ts'
import { MultiSelectList, type MultiSelectItem } from './components/multiSelectList.ts'



declare const MACRO: {
  VERSION: string
}

const APP_NAME = 'Microcode'
const INTERACTIVE_SHELL_COMMANDS = new Set(['node', 'codex', 'claude', 'microcode'])
const NON_INTERACTIVE_FLAGS = new Set(['--help', '-h', '--version', '-v'])
const MICROCODE_NON_INTERACTIVE_SUBCOMMANDS = new Set(['mcp', 'model'])

function countStreamingLines(content: string): number {
  if (!content) return 0
  let lines = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++
  }
  return content.endsWith('\n') ? lines - 1 : lines
}

function splitShellWords(command: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaping = false

  for (const ch of command.trim()) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }
    if (ch === '\\' && quote !== "'") {
      escaping = true
      continue
    }
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch
      continue
    }
    if (ch === quote) {
      quote = undefined
      continue
    }
    if (/\s/.test(ch) && !quote) {
      if (current) {
        words.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }

  if (current) words.push(current)
  return words
}

function getShellConfig(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    if (process.env.PSModulePath || process.env.SHELL?.includes('powershell')) {
      return { shell: 'powershell.exe', args: ['-NoProfile', '-Command'] }
    }
    return { shell: 'cmd.exe', args: ['/c'] }
  }
  return { shell: '/bin/bash', args: ['-c'] }
}

export function isBareInteractiveCommand(command: string): boolean {
  if (/[|&;<>()]/.test(command)) return false
  const words = splitShellWords(command)
  const first = words[0]?.split(/[\\/]/).at(-1)
  if (!first || !INTERACTIVE_SHELL_COMMANDS.has(first)) return false
  if (words.length === 1) return true
  if (words.some((word) => NON_INTERACTIVE_FLAGS.has(word))) return false
  if (first === 'node') return false
  if (first === 'microcode' && MICROCODE_NON_INTERACTIVE_SUBCOMMANDS.has(words[1])) return false
  return true
}

const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Clear the conversation history' },
  { name: 'compact', description: 'Compress conversation context (usage: /compact [instructions])', argumentHint: '[instructions]' },
  { name: 'status', description: 'Show context usage, token statistics, and model details' },
  { name: 'model', description: 'Browse providers and select a model (usage: /model [provider/model])', argumentHint: '[provider/model]' },
  { name: 'login', description: 'Sign in to a model provider (usage: /login <provider> [api_key|oauth])', argumentHint: '<provider> [api_key|oauth]' },
  { name: 'logout', description: 'Sign out of a model provider (usage: /logout <provider>)', argumentHint: '<provider>' },
  { name: 'auth', description: 'Show provider authentication status' },
  { name: 'thinking', description: 'Show or set thinking depth (usage: /thinking [level])', argumentHint: '[off|minimal|low|medium|high|xhigh|max]' },
  { name: 'mcp', description: 'Show MCP servers', argumentHint: '' },
  { name: 'session', description: 'Browse and load saved sessions', argumentHint: '' },
  { name: 'tasks', description: 'Browse tasks and prioritize unfinished work in the current session', argumentHint: '' },
  { name: 'new', description: 'Start a new conversation session' },
  { name: 'permission', description: 'Show or switch permission mode (usage: /permission [mode])', argumentHint: '[mode]' },
  { name: 'skills', description: 'Show available skills' },
  { name: 'exit', description: 'Exit Microcode' },
  { name: 'help', description: 'Show help and available commands' },
]

export class App {
  private ui: TUI
  private headerContainer: Container
  private chatContainer: Container
  private statusContainer: Container
  private editorContainer: Container
  private workingContainer: Container
  private agent: MicrocodeAgent
  private editor!: MicrocodeEditor
  private footer: FooterComponent
  private isInitialized = false
  private streamingComponent?: AssistantMessageComponent
  private streamingMessage?: AssistantMessage
  private pendingTools = new Map<string, ToolUIComponent>()
  private pendingToolStartedAt = new Map<string, number>()
  private streamingToolLastRenderAt = new Map<string, number>()
  private toolRows = new Map<string, ToolUIComponent>()
  private activeTurnTimeline?: TurnTimeline
  private toolDetailsExpanded = false
  private turnFinalized = false
  private toolElapsedTimer?: ReturnType<typeof setInterval>
  private agentWorking = false
  private lastSigintTime = 0
  private mcpClient?: McpClientManager
  private sessionManager: SessionManager
  private compacting = false
  private compactionProgressText?: Text
  private permissionPromptActive = false
  private pendingEventsWhilePermission: Array<() => void> = []
  private isBashMode = false
  private bashComponent?: BashExecutionComponent
  private activeBashProcess?: ChildProcessWithoutNullStreams
  private bashCancelRequested = false
  private startupWarnings: string[] = []
  private pendingImages: CachedImage[] = []
  private imagePathProcessing = false
  private suppressTrailingQuote = false
  private titleGenerated = false
  private workingText: Text | null = null
  private agentActivityLabel = 'Working…'
  private workingFrameIndex = 0
  private workingTimer: ReturnType<typeof setInterval> | undefined
  onExit?: () => void | Promise<void>

  constructor(
    agent: MicrocodeAgent,
    mcpClient?: McpClientManager,
    sessionManager?: SessionManager,
  ) {
    this.agent = agent
    this.mcpClient = mcpClient
    this.sessionManager = sessionManager ?? new SessionManager()
    this.agent.setPersistence(this.sessionManager)
    this.ui = new TUI(new ProcessTerminal())
    this.headerContainer = new Container()
    this.chatContainer = new Container()
    this.statusContainer = new Container()
    this.editorContainer = new Container()
    this.workingContainer = new Container()
    this.footer = new FooterComponent(
      agent,
      process.cwd(),
    )
  }

  getSessionManager(): SessionManager {
    return this.sessionManager
  }

  /** Queue a warning to be shown in the chat area after TUI initializes. */
  addStartupWarning(message: string): void {
    this.startupWarnings.push(message)
  }

  async run(): Promise<void> {
    this.init()
    this.setupAgentSubscription()

    // Show existing session title in footer (e.g., from --resume)
    const currentId = this.sessionManager.getSessionId()
    if (currentId) {
      const existingTitle = this.sessionManager.getTitle(currentId)
      if (existingTitle) {
        this.footer.setSessionTitle(existingTitle)
        this.footer.invalidate()
        this.ui.requestRender()
      }
    }

    // Show any queued startup warnings
    for (const msg of this.startupWarnings) {
      this.chatContainer.addChild(new Text(chalk.hex('#ffff00')(`⚠ ${msg}`), 1, 0))
      this.chatContainer.addChild(new Spacer(1))
    }
    if (this.startupWarnings.length > 0) {
      this.ui.requestRender()
    }

    // Main interactive loop
    while (true) {
      const rawInput = await this.getUserInput()
      if (!rawInput.trim()) continue

      // Handle bash commands (! for normal, !! for excluded from context)
      if (rawInput.startsWith('!')) {
        const isExcluded = rawInput.startsWith('!!')
        const command = isExcluded ? rawInput.slice(2).trim() : rawInput.slice(1).trim()
        if (command) {
          await this.handleBashCommand(command, isExcluded)
          this.isBashMode = false
          continue
        }
      }

      // Handle slash commands locally
      if (rawInput.startsWith('/')) {
        const handled = this.handleSlashCommand(rawInput.trim())
        if (handled) continue
      }

      // --- Image processing at submit time ---
      // If pendingImages were already populated by onChange, skip re-scanning.
      const imagePaths = this.pendingImages.length === 0
        ? collectImagePathsFromText(rawInput)
        : []
      const userInput = stripImagePathsFromText(rawInput)

      if (imagePaths.length > 0) {
        if (modelSupportsImages(this.agent.getCurrentModel())) {
          for (const filePath of imagePaths) {
            const image = tryReadImageFromPath(filePath)
            if (image) {
              await this.sessionManager.ensureCreated(process.cwd())
              const sessionId = this.sessionManager.getSessionId() ?? 'unknown'
              const { cachePath, fileName } = storeImage(image.data, image.mimeType, sessionId)
              this.pendingImages.push({ cachePath, fileName, mimeType: image.mimeType, base64Data: image.data })
            }
          }
        } else {
          this.showStatus(
            chalk.hex('#ffff00')(
              'Warning: Current model does not support image input. Switch to a vision-capable model (e.g. Gemini, MiMo v2.5).',
            ),
          )
        }
      }

      // Skip if nothing to send (no text and no images)
      const images = this.getPendingImageContents()
      if (!userInput.trim() && images.length === 0) continue
      await this.sessionManager.ensureCreated(process.cwd())

      // Add user message to chat (with grey background)
      this.activeTurnTimeline = new TurnTimeline()
      this.activeTurnTimeline.addEntry(new UserMessage(userInput, images.length > 0 ? images : undefined))
      this.chatContainer.addChild(this.activeTurnTimeline)
      this.turnFinalized = false
      this.ui.requestRender()

      try {
        if (images.length > 0) {
          await this.agent.prompt(userInput, images)
        } else {
          await this.agent.prompt(userInput)
        }
        this.clearPendingImages()
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
        this.appendTurnEntry(new Text(chalk.hex('#cc6666')(`Error: ${errorMessage}`), 1, 0))
        this.chatContainer.addChild(new Spacer(1))
        this.ui.requestRender()
      }
    }
  }

  private init(): void {
    if (this.isInitialized) return

    // Header: logo + compact keybinding hints (matching pi-coding-agent style)
    const logo = theme.bold(theme.fg('accent', APP_NAME)) + theme.dim(` v${MACRO.VERSION}`)
    const compactInstructions = [
      theme.dim('escape') + theme.dim(' interrupt'),
      theme.dim('ctrl+c/ctrl+d') + theme.dim(' exit'),
      theme.dim('ctrl+o') + theme.dim(' tool details'),
      theme.dim('/') + theme.dim(' commands'),
      theme.dim('!') + theme.dim(' shell'),
    ].join(theme.dim(' · '))
    const onboarding = theme.dim(
      `${APP_NAME} can explain its own features and help you write, edit, and understand code. Ask it anything.`,
    )

    this.headerContainer.addChild(new Spacer(1))
    this.headerContainer.addChild(new Text(`${logo}  ${compactInstructions}`, 1, 0))
    this.headerContainer.addChild(new Text(onboarding, 1, 0))
    this.headerContainer.addChild(new Spacer(1))

    // Editor with border
    this.editor = new MicrocodeEditor(this.ui, getEditorTheme(), { paddingX: 1 })

    // Set up slash command autocomplete
    this.setupSlashCommands()

    this.editor.onSubmit = (text: string) => {
      this.handleEditorSubmit(text)
    }

    // Detect bash mode (! prefix)
    this.editor.onChange = (text: string) => {
      const wasBashMode = this.isBashMode
      this.isBashMode = text.trimStart().startsWith('!')
      if (wasBashMode !== this.isBashMode) {
        this.updateEditorBorderColor()
      }

      if (this.imagePathProcessing) return

      // Suppress trailing quote left behind after an image path was stripped.
      // Terminal drag-drop sends characters one by one. When a path is quoted
      // (e.g. '/path/file.jpg'), the regex may match before the closing quote
      // arrives. After we replace the path with a placeholder, the closing quote
      // arrives as a separate event — strip it from the end of the text.
      if (this.suppressTrailingQuote) {
        this.suppressTrailingQuote = false
        if (text.endsWith("'") || text.endsWith('"')) {
          this.editor.setText(text.slice(0, -1))
          return
        }
      }

      // Scan for image file paths.
      // Quoted paths (with spaces) require both quotes to match, so the closing
      // quote has already arrived and processing is safe.
      // Unquoted paths match immediately; the trailing quote (if any) will be
      // handled by suppressTrailingQuote above on the next onChange.
      const imagePaths = collectImagePathsFromText(text)
      if (imagePaths.length > 0) {
        this.imagePathProcessing = true

        const newImages: CachedImage[] = []
        if (modelSupportsImages(this.agent.getCurrentModel())) {
          for (const filePath of imagePaths) {
            const image = tryReadImageFromPath(filePath)
            if (image) {
              const sessionId = this.sessionManager.getSessionId() ?? 'unknown'
              const { cachePath, fileName } = storeImage(image.data, image.mimeType, sessionId)
              newImages.push({ cachePath, fileName, mimeType: image.mimeType, base64Data: image.data })
            }
          }
        } else {
          this.showStatus(
            chalk.hex('#ffff00')(
              'Warning: Current model does not support image input. Switch to a vision-capable model.',
            ),
          )
        }

        this.pendingImages = newImages

        let clean = stripImagePathsFromText(text)
        if (newImages.length > 0) {
          const markers = newImages.map(img => `[Image: ${img.fileName}]`).join(' ')
          clean = clean ? `${clean} ${markers}` : markers
        }
        // setText triggers onChange synchronously; imagePathProcessing guard
        // prevents the suppressTrailingQuote check from firing prematurely.
        this.editor.setText(clean)
        this.suppressTrailingQuote = true
        this.imagePathProcessing = false
      }
    }

    // App-level key handlers on the Editor (pi-coding-agent pattern)
    this.editor.onEscape = () => {
      const now = Date.now()
      if (now - this.lastSigintTime < 500) {
        this.exit()
        return
      }
      this.lastSigintTime = now
      if (this.activeBashProcess) {
        this.cancelBashCommand()
      } else if (this.isAgentBusy()) {
        this.agent.abort()
      } else {
        this.editor.setText('')
      }
    }
    this.editor.onCtrlC = () => {
      if (this.permissionPromptActive) {
        this.exit()
      } else if (this.activeBashProcess) {
        this.cancelBashCommand()
      } else if (this.isAgentBusy()) {
        this.agent.abort()
      } else {
        this.exit()
      }
    }
    this.editor.onCtrlD = () => {
      this.exit()
    }
    this.editor.onCtrlO = () => {
      this.toolDetailsExpanded = !this.toolDetailsExpanded
      for (const row of this.toolRows.values()) row.setExpanded(this.toolDetailsExpanded)
      this.ui.requestRender()
    }

    this.ui.addInputListener((data) => {
      return undefined
    })

    this.editorContainer.addChild(this.editor)

    // Assemble UI layout (matching pi-coding-agent order)
    this.ui.addChild(this.headerContainer)
    this.ui.addChild(this.chatContainer)
    this.ui.addChild(this.statusContainer)
    this.ui.addChild(this.editorContainer)
    this.ui.addChild(this.workingContainer)
    this.ui.addChild(this.footer)

    this.ui.setFocus(this.editor)
    this.ui.start()
    this.isInitialized = true
  }

  private setupSlashCommands(): void {
    const provider: AutocompleteProvider = {
      getSuggestions: async (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        _options: { signal: AbortSignal; force?: boolean },
      ) => {
        const currentLine = lines[cursorLine] ?? ''
        const textBeforeCursor = currentLine.slice(0, cursorCol)

        if (!textBeforeCursor.startsWith('/')) return null

        const query = textBeforeCursor.slice(1).toLowerCase()
        const builtinMatches = BUILTIN_SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(query))

        const skills = this.agent.getSkills()
        const skillMatches = skills
          .filter(s => !s.disableModelInvocation && s.name.startsWith(query))
          .map(s => ({
            value: `/${s.name}`,
            label: `/${s.name}`,
            description: s.description,
          }))

        const allMatches = [
          ...builtinMatches.map(cmd => ({
            value: `/${cmd.name}`,
            label: `/${cmd.name}${cmd.argumentHint ? ` ${cmd.argumentHint}` : ''}`,
            description: cmd.description ?? '',
          })),
          ...skillMatches,
        ]

        if (allMatches.length === 0) return null

        return {
          items: allMatches,
          prefix: textBeforeCursor,
        }
      },

      applyCompletion: (
        lines: string[],
        cursorLine: number,
        _cursorCol: number,
        item: { value: string; label: string; description?: string },
        _prefix: string,
      ) => {
        const newLines = [...lines]
        newLines[cursorLine] = item.value + ' '
        return {
          lines: newLines,
          cursorLine,
          cursorCol: item.value.length + 1,
        }
      },
    }

    this.editor.setAutocompleteProvider(provider)
  }

  private async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
    // Create UI component for display
    this.bashComponent = new BashExecutionComponent(command, this.ui, excludeFromContext)
    this.chatContainer.addChild(this.bashComponent)
    this.ui.requestRender()

    if (isBareInteractiveCommand(command)) {
      this.bashComponent.appendOutput(
        'This command starts an interactive terminal session, which cannot run inside Microcode\'s inline shell.\n' +
        'Run it in a separate terminal, or pass a non-interactive flag/subcommand such as --help, --version, or an explicit script.\n',
      )
      this.bashComponent.setComplete(undefined, true)
      this.bashComponent = undefined
      this.updateEditorBorderColor()
      this.ui.requestRender()
      return
    }

    try {
      const { spawn } = await import('child_process')
      const { shell, args } = getShellConfig()
      const component = this.bashComponent
      this.bashCancelRequested = false

      await new Promise<void>((resolve) => {
        const child = spawn(shell, [...args, command], {
          cwd: process.cwd(),
          detached: process.platform !== 'win32',
          stdio: 'pipe',
          windowsHide: true,
        })

        this.activeBashProcess = child
        child.stdin.end()

        child.stdout.on('data', (data: Buffer) => {
          component?.appendOutput(data.toString())
          this.ui.requestRender()
        })
        child.stderr.on('data', (data: Buffer) => {
          component?.appendOutput(data.toString())
          this.ui.requestRender()
        })

        child.on('close', (code) => {
          if (this.activeBashProcess === child) {
            this.activeBashProcess = undefined
          }
          component?.setComplete(code ?? undefined, this.bashCancelRequested)
          this.bashCancelRequested = false
          if (this.bashComponent === component) {
            this.bashComponent = undefined
          }
          this.updateEditorBorderColor()
          this.ui.requestRender()
          resolve()
        })

        child.on('error', (error) => {
          if (this.activeBashProcess === child) {
            this.activeBashProcess = undefined
          }
          component?.appendOutput(`Failed to start command: ${error.message}\n`)
          component?.setComplete(undefined, false)
          this.bashCancelRequested = false
          if (this.bashComponent === component) {
            this.bashComponent = undefined
          }
          this.updateEditorBorderColor()
          this.ui.requestRender()
          resolve()
        })
      })
    } catch (error) {
      if (this.bashComponent) {
        this.bashComponent.setComplete(undefined, false)
      }
      this.showError(`Bash command failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      this.activeBashProcess = undefined
      this.bashCancelRequested = false
      this.bashComponent = undefined
      this.updateEditorBorderColor()
    }
  }

  private cancelBashCommand(): void {
    const child = this.activeBashProcess
    if (!child) return

    this.bashCancelRequested = true
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGTERM')
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {}
    }

    setTimeout(() => {
      if (this.activeBashProcess !== child) return
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGKILL')
        } else {
          child.kill('SIGKILL')
        }
      } catch {}
    }, 1000).unref()
  }

  private updateEditorBorderColor(): void {
    if (this.isBashMode) {
      this.editor.borderColor = getBashModeBorderColor()
    } else {
      this.editor.borderColor = (text: string) => theme.fg('blue', text)
    }
    this.ui.requestRender()
  }

  private handleSlashCommand(input: string): boolean {
    this.editor.addToHistory(input)
    const parts = input.split(/\s+/)
    const command = parts[0]?.toLowerCase()
    const args = parts.slice(1).join(' ')

    switch (command) {
      case '/clear':
        this.chatContainer.clear()
        this.activeTurnTimeline = undefined
        this.toolRows.clear()
        this.pendingTools.clear()
        this.turnFinalized = false
        this.showStatus('Conversation cleared.')
        return true

      case '/compact':
        this.handleCompactCommand(args)
        return true

      case '/status':
        this.handleStatusCommand()
        return true

      case '/model':
        this.handleModelCommand(args || undefined)
        return true

      case '/login':
        void this.handleAuthCommand('login', args)
        return true

      case '/logout':
        void this.handleAuthCommand('logout', args)
        return true

      case '/auth':
        void this.handleAuthCommand('status', args)
        return true

      case '/mcp':
        this.handleMcpCommand(args)
        return true

      case '/session':
        this.handleSessionCommand(args)
        return true

      case '/tasks':
        this.handleTasksCommand()
        return true


      case '/permission':
        this.handlePermissionCommand(args)
        return true

      case '/thinking':
        this.handleThinkingCommand(args)
        return true

      case '/skills':
        this.handleSkillsCommand()
        return true

      case '/exit':
        this.exit()
        return true

      case '/new':
        this.handleNewSession()
        return true

      case '/help':
        this.showHelp()
        return true

      default: {
        // Check if command matches a loaded skill
        const skillName = command?.startsWith('/') ? command.slice(1) : ''
        const skills = this.agent.getSkills()
        const skill = skills.find(s => s.name === skillName && !s.disableModelInvocation)
        if (skill) {
          this.handleSkillSlashCommand(skill)
          return true
        }
        this.showError(`Unknown command: ${command}. Type /help for available commands.`)
        return true
      }
    }
  }

  private async handleAuthCommand(action: 'login' | 'logout' | 'status', args: string): Promise<void> {
    const abortController = new AbortController()
    try {
      const models = getModels()
      if (action === 'status') {
        const providers = models.getProviders()
        const statuses: SelectItem[] = []
        for (const provider of providers) {
          let status = 'not configured'
          try {
            const auth = await models.checkAuth(provider.id)
            if (auth) status = `${auth.type}${auth.source ? ` · ${auth.source}` : ''}`
          } catch (error) {
            status = `error · ${error instanceof Error ? error.message : String(error)}`
          }
          statuses.push({ value: provider.id, label: provider.name, description: `${provider.id} · ${status}` })
        }
        await this.selectAuthOption('Provider authentication status', statuses)
        return
      }

      const [providerArg, requestedType] = args.trim().split(/\s+/, 2)
      const providerId = providerArg || await this.selectAuthOption(
        action === 'login' ? 'Choose a provider to sign in' : 'Choose a provider to sign out',
        models.getProviders().map((provider) => ({ value: provider.id, label: provider.name, description: provider.id })),
      )
      if (!providerId) return
      const provider = models.getProvider(providerId)
      if (!provider) throw new Error(`Unknown provider "${providerId}". Run /auth to list providers.`)

      if (action === 'logout') {
        await models.logout(providerId)
        this.showStatus(`Signed out of ${provider.name}.`)
        return
      }

      const authChoices = [
        ...(provider.auth.oauth ? [{ value: 'oauth', label: 'OAuth subscription', description: 'Sign in in your browser' }] : []),
        ...(provider.auth.apiKey?.login ? [{ value: 'api_key', label: 'API key', description: provider.auth.apiKey.name }] : []),
      ]
      const type: AuthType | undefined = requestedType === 'oauth' || requestedType === 'api_key'
        ? requestedType
        : authChoices.length > 1
          ? await this.selectAuthOption(`Choose a sign-in method for ${provider.name}`, authChoices) as AuthType | undefined
          : authChoices[0]?.value as AuthType | undefined
      if (!type) return
      if (type === 'oauth' && !provider.auth.oauth) throw new Error(`Provider ${providerId} does not support OAuth login.`)
      await models.login(providerId, type, {
        signal: abortController.signal,
        prompt: async (prompt) => {
          if (prompt.type !== 'select') return this.promptAuthValue(prompt, abortController)
          const selected = await this.selectAuthOption(prompt.message, prompt.options)
          if (!selected) {
            abortController.abort()
            throw new Error('Authentication cancelled.')
          }
          return selected
        },
        notify: (event) => {
          if (event.type === 'auth_url') {
            this.showStatus(`${event.instructions ?? 'Complete authorization in your browser.'} ${event.url}`)
            void this.openAuthUrl(event.url)
          } else if (event.type === 'device_code') {
            this.showStatus(`Code: ${event.userCode} · ${event.verificationUri}`)
            void this.openAuthUrl(event.verificationUri)
          } else {
            this.showStatus(event.message)
          }
        },
      })
      this.showStatus(providerId === 'openai-codex'
        ? 'Signed in to OpenAI Codex. Use /model to select a Codex model, then start chatting.'
        : `Signed in to ${provider.name}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (abortController.signal.aborted || /cancel(?:led|ed)/i.test(message)) {
        if (action === 'login') this.showStatus('Sign-in cancelled.')
        return
      }
      this.showError(message)
    }
  }

  private async promptAuthValue(prompt: AuthPrompt, authController?: AbortController): Promise<string> {
    if (prompt.type === 'manual_code') return this.promptAuthCode(prompt, authController)
    const placeholder = 'placeholder' in prompt ? prompt.placeholder : undefined
    const secret = prompt.type === 'secret'
    const notice = new Text(
      theme.fg('accent', `${prompt.message}${placeholder ? ` (${placeholder})` : ''} · Enter to submit · Esc to cancel`),
      1,
      0,
    )
    const inputLine = new Text('> ', 1, 0)
    this.chatContainer.addChild(notice)
    this.chatContainer.addChild(inputLine)
    this.ui.requestRender()

    return new Promise<string>((resolve, reject) => {
      let value = ''
      let settled = false
      let removeInputListener = () => {}
      const cleanup = () => {
        if (settled) return
        settled = true
        removeInputListener()
        prompt.signal?.removeEventListener('abort', onAbort)
        authController?.signal.removeEventListener('abort', onAbort)
        this.chatContainer.removeChild(inputLine)
        this.chatContainer.removeChild(notice)
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
      }
      const onAbort = () => {
        cleanup()
        // A second Escape immediately after cancelling auth must not be
        // mistaken for the app-level double-Escape exit gesture.
        this.lastSigintTime = 0
        if (!authController?.signal.aborted) authController?.abort()
        reject(new Error('Authentication cancelled.'))
      }
      const cancel = () => {
        authController?.abort()
        if (!settled) onAbort()
      }
      const updateInput = () => {
        inputLine.setText(`> ${secret ? '*'.repeat([...value].length) : value}`)
        this.ui.requestRender()
      }
      const appendText = (text: string) => {
        for (const char of text) {
          if (char === '\r' || char === '\n') continue
          if (char === '\u007f' || char === '\b') {
            value = [...value].slice(0, -1).join('')
          } else if (char >= ' ') {
            value += char
          }
        }
        updateInput()
      }

      removeInputListener = this.ui.addInputListener((data) => {
        if (data === '\u001b' || data === '\u0003' || data === '\u0004') {
          cancel()
          return { consume: true }
        }
        if (data === '\r' || data === '\n') {
          const answer = value.trim()
          if (!answer) {
            cancel()
          } else {
            cleanup()
            resolve(answer)
          }
          return { consume: true }
        }

        const pasteStart = '\u001b[200~'
        const pasteEnd = '\u001b[201~'
        if (data.startsWith(pasteStart) && data.endsWith(pasteEnd)) {
          appendText(data.slice(pasteStart.length, -pasteEnd.length))
          return { consume: true }
        }
        if (data.startsWith('\u001b[')) {
          // Let terminal reports through to TUI (for example, image cell size).
          if (/^\u001b\[6;\d+;\d+t$/.test(data)) return undefined
          return { consume: true }
        }
        appendText(data)
        return { consume: true }
      })

      prompt.signal?.addEventListener('abort', onAbort, { once: true })
      authController?.signal.addEventListener('abort', onAbort, { once: true })
      if (prompt.signal?.aborted || authController?.signal.aborted) onAbort()
    })
  }

  private promptAuthCode(prompt: Extract<AuthPrompt, { type: 'manual_code' }>, authController?: AbortController): Promise<string> {
    const previousSubmit = this.editor.onSubmit
    const previousEscape = this.editor.onEscape
    const notice = new Text(theme.fg('accent', `${prompt.message} Press Esc to cancel.`), 1, 0)
    this.chatContainer.addChild(notice)
    this.editor.setText('')
    this.ui.setFocus(this.editor)
    this.ui.requestRender()

    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        if (settled) return
        settled = true
        prompt.signal?.removeEventListener('abort', onAbort)
        this.editor.onSubmit = previousSubmit
        this.editor.onEscape = previousEscape
        this.chatContainer.removeChild(notice)
        this.editor.setText('')
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
      }
      const onAbort = () => {
        cleanup()
        reject(new Error('Authentication cancelled.'))
      }
      this.editor.onSubmit = (value: string) => {
        const code = value.trim()
        if (!code) return
        cleanup()
        resolve(code)
      }
      this.editor.onEscape = () => {
        authController?.abort()
        cleanup()
        reject(new Error('Authentication cancelled.'))
      }
      if (prompt.signal?.aborted) return onAbort()
      prompt.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async selectAuthOption(
    title: string,
    options: readonly { value?: string; id?: string; label: string; description?: string }[],
  ): Promise<string | undefined> {
    if (options.length === 0) return undefined
    const items: SelectItem[] = options.map((option) => ({
      value: option.value ?? option.id ?? option.label,
      label: option.label,
      description: option.description,
    }))
    const list = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (text) => chalk.cyan(text),
      selectedText: (text) => chalk.cyan(text),
      description: (text) => theme.dim(text),
      scrollInfo: (text) => theme.dim(text),
      noMatch: (text) => theme.dim(text),
    })
    const removeFilter = this.addSelectListFilter(list)
    this.editorContainer.removeChild(this.editor)
    const titleText = new Text(theme.fg('accent', title), 1, 0)
    this.chatContainer.addChild(titleText)
    this.chatContainer.addChild(list)
    this.ui.setFocus(list)
    this.ui.requestRender()
    return new Promise((resolve) => {
      let finished = false
      const finish = (value?: string) => {
        if (finished) return
        finished = true
        removeFilter()
        this.chatContainer.removeChild(list)
        this.chatContainer.removeChild(titleText)
        this.editorContainer.addChild(this.editor)
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        resolve(value)
      }
      list.onSelect = (item) => finish(item.value)
      list.onCancel = () => finish()
    })
  }

  private addSelectListFilter(list: SelectList): () => void {
    let filter = ''
    return this.ui.addInputListener((data) => {
      if (data === '\u007f' || data === '\b') {
        if (filter) {
          filter = filter.slice(0, -1)
          list.setFilter(filter)
          this.ui.requestRender()
        }
        return { consume: true }
      }
      if (Array.from(data).length === 1 && data >= ' ' && !data.startsWith('\u001b')) {
        filter += data
        list.setFilter(filter)
        this.ui.requestRender()
        return { consume: true }
      }
      return undefined
    })
  }

  private async openAuthUrl(url: string): Promise<void> {
    const parsed = URL.canParse(url) ? new URL(url) : undefined
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      this.showError(`Refusing to open an invalid authentication URL: ${url}`)
      return
    }
    const command = process.platform === 'win32'
      ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
      : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url]
    try {
      const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
      void child.exited.then((code) => {
        if (code !== 0) this.showError(`Could not open the browser automatically. Open this URL: ${url}`)
      })
    } catch {
      this.showError(`Could not open the browser automatically. Open this URL: ${url}`)
    }
  }

  private async handleCompactCommand(args: string): Promise<void> {
    if (this.compacting) {
      this.showError('Compaction already in progress.')
      return
    }

    const customInstructions = args.trim() || undefined
    this.compacting = true

    const progressText = new Text(
      theme.fg('accent', '⟳ Compacting conversation context...'),
      1,
      0,
    )
    this.compactionProgressText = progressText
    this.chatContainer.addChild(progressText)
    this.ui.requestRender()

    try {
      await this.agent.compact({
        instructions: customInstructions,
        persistToSession: true,
      })

      // Update footer
      this.updateContextUsage()
      this.footer.invalidate()
      const usage = this.agent.getTokenStats().context
      progressText.setText(
        theme.dim(`Compacted. Context: ${usage.percentUsed}% used (${Math.round(usage.usedTokens / 1000)}k/${Math.round(usage.contextWindow / 1000)}k)`),
      )
      this.chatContainer.addChild(new Spacer(1))
    } catch (error) {
      progressText.setText(
        chalk.hex('#cc6666')(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`),
      )
      this.chatContainer.addChild(new Spacer(1))
    } finally {
      this.compacting = false
      this.compactionProgressText = undefined
      this.ui.requestRender()
    }
  }

  private handleStatusCommand(): void {
    const tokenStats = this.agent.getTokenStats()
    const { context: usage } = tokenStats

    const formatTokens = (value: number): string => value.toLocaleString('en-US')
    const formatPrice = (value: number): string => {
      if (value === 0) return '$0'
      if (value < 0.0001) return `$${value.toFixed(6)}`
      return `$${value.toFixed(4)}`
    }

    const lines: string[] = [
      theme.fg('accent', 'Status'),
      '',
      theme.bold('Context window'),
    ]

    const ratio = Math.min(1, Math.max(0, usage.usedTokens / usage.contextWindow))
    const barWidth = 24
    const filled = Math.round(ratio * barWidth)
    const bar = `${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}`
    lines.push(
      `  ${theme.fg('accent', bar)}  ${usage.percentUsed}% used`,
      `  Used       ${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindow)} tokens`,
      `  Remaining  ${formatTokens(usage.remainingTokens)} tokens (${usage.percentRemaining}%)`,
      `  Breakdown  system ${formatTokens(usage.systemPromptTokens)} + messages ${formatTokens(usage.messageTokens)}`,
    )

    // Show the current session's accumulated usage by model.
    const mergedByModel: Record<string, { modelId: string; provider: string; api: string; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalTokens: number; totalCost: number }> = {}

    const mergeStats = (stats: Readonly<import('../agent/AgentTokenTracker.js').AgentTokenSnapshot>) => {
      for (const [key, mu] of Object.entries(stats.byModel)) {
        const existing = mergedByModel[key]
        if (existing) {
          existing.requests += mu.requests
          existing.inputTokens += mu.inputTokens
          existing.outputTokens += mu.outputTokens
          existing.cacheReadTokens += mu.cacheReadTokens
          existing.cacheWriteTokens += mu.cacheWriteTokens
          existing.totalTokens += mu.totalTokens
          existing.totalCost += mu.totalCost
        } else {
          mergedByModel[key] = { ...mu }
        }
      }
    }

    mergeStats(tokenStats)

    const modelUsages = Object.values(mergedByModel)
    if (modelUsages.length > 0) {
      lines.push('', theme.bold('Usage by model'))
      for (const mu of modelUsages) {
        lines.push(
          `  ${mu.modelId} (${mu.provider}, ${mu.api})`,
          `    ${formatTokens(mu.requests)} requests · ${formatTokens(mu.totalTokens)} tokens · ${formatPrice(mu.totalCost)}`,
        )
      }
    }

    for (const line of lines) {
      this.chatContainer.addChild(new Text(line, 1, 0))
    }
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private async handleSessionCommand(_args: string): Promise<void> {
    const sessions = await this.sessionManager.listWithTitles()
    const currentId = this.sessionManager.getSessionId()

    if (sessions.length === 0) {
      this.chatContainer.addChild(
        new Text(theme.dim('No saved sessions found.'), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))
      this.ui.requestRender()
      return
    }

    const items: SelectItem[] = []
    for (const s of sessions.slice(0, 20)) {
      const isCurrent = s.id === currentId
      const prefix = isCurrent ? '* ' : '  '
      const date = new Date(s.createdAt).toLocaleString()
      const title = s.title ?? theme.dim('(no title)')
      const label = `${prefix}${title}`
      const desc = `${s.id.slice(0, 8)}  ${date}  ${s.cwd}${isCurrent ? ' (current)' : ''}`
      items.push({ value: s.id, label, description: desc })
    }
    items.push({ value: '__cancel__', label: 'Cancel', description: 'Return without loading' })

    const selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => chalk.cyan(text),
      selectedText: (text) => chalk.cyan(text),
      description: (text) => theme.dim(text),
      scrollInfo: (text) => theme.dim(text),
      noMatch: (text) => theme.dim(text),
    })

    this.chatContainer.addChild(
      new Text(theme.fg('accent', 'Select a session to load:'), 1, 0),
    )
    this.chatContainer.addChild(selectList)
    this.ui.setFocus(selectList)
    this.ui.requestRender()

    let finished = false

    const removeListener = this.ui.addInputListener((data) => {
      if (data === '\x03') {
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)
        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        return { consume: true }
      }
      return undefined
    })

    const finish = async (value?: string) => {
      if (finished) return
      if (!value || value === '__cancel__') {
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)
        this.chatContainer.addChild(new Text(theme.dim('Cancelled.'), 1, 0))
        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        return
      }

      const selected = sessions.find((s) => s.id === value)
      if (!selected) return

      finished = true
      removeListener()
      this.chatContainer.removeChild(selectList)

      if (selected.id === currentId) {
        this.chatContainer.addChild(
          new Text(theme.dim('Already in this session.'), 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        return
      }

      try {
        await this.agent.persistMessages()
        const messages = await this.sessionManager.switchToSession(selected)

        // Replace messages on agent
        this.agent.replaceMessages(messages, 'rebuild')

        // Rebuild system prompt preserving loaded skills
        this.rebuildSystemPromptForResume()

        // Clear and re-render chat
        this.rerenderChat(messages)

        this.chatContainer.addChild(
          new Text(theme.fg('accent', `Loaded session: ${selected.title ?? selected.id.slice(0, 8)}`), 1, 0),
        )
        this.chatContainer.addChild(
          new Text(theme.dim(`  ${selected.id}  ${new Date(selected.createdAt).toLocaleString()}`), 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
        this.updateContextUsage()
        // Show session title in footer
        this.footer.setSessionTitle(selected.title ?? null)
        this.footer.invalidate()
      } catch (error) {
        this.chatContainer.addChild(
          new Text(theme.fg('red', `Failed to load session: ${error instanceof Error ? error.message : 'Unknown error'}`), 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
      }

      this.ui.setFocus(this.editor)
      this.ui.requestRender()
    }

    selectList.onSelect = (item) => finish(item.value)
    selectList.onCancel = () => finish(undefined)
  }

  private async handleTasksCommand(): Promise<void> {
    if (!this.sessionManager.getSessionId()) {
      this.showError('No active session.')
      return
    }

    let lists: TaskList[]
    try {
      lists = await this.sessionManager.listTaskLists()
    } catch (error) {
      this.showError(`Failed to load tasks: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    if (lists.length === 0) {
      this.chatContainer.addChild(
        new Text(theme.dim('No task lists in the current session.'), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))
      this.ui.requestRender()
      return
    }

    const listItems: SelectItem[] = lists.map((list) => {
      const completed = list.tasks.filter((task) => task.completed).length
      return {
        value: list.id,
        label: `${completed === list.tasks.length ? '✓' : '▣'} ${list.title}`,
        description: `${completed}/${list.tasks.length} completed  ${list.id}`,
      }
    })
    listItems.push({
      value: '__cancel__',
      label: 'Cancel',
      description: 'Return without opening a task list',
    })

    const listSelect = new SelectList(listItems, Math.min(listItems.length, 10), {
      selectedPrefix: (text) => chalk.cyan(text),
      selectedText: (text) => chalk.cyan(text),
      description: (text) => theme.dim(text),
      scrollInfo: (text) => theme.dim(text),
      noMatch: (text) => theme.dim(text),
    })
    const heading = new Text(
      theme.fg('accent', 'Task lists in this session:'),
      1,
      0,
    )
    this.chatContainer.addChild(heading)
    this.chatContainer.addChild(listSelect)
    this.ui.setFocus(listSelect)
    this.ui.requestRender()

    let finished = false
    let activeSelect: Component = listSelect
    const close = (message?: string) => {
      if (finished) return
      finished = true
      removeListener()
      this.chatContainer.removeChild(activeSelect)
      if (message) this.chatContainer.addChild(new Text(message, 1, 0))
      this.chatContainer.addChild(new Spacer(1))
      this.ui.setFocus(this.editor)
      this.ui.requestRender()
    }
    const removeListener = this.ui.addInputListener((data) => {
      if (data === '\x03') {
        close(theme.dim('Closed task browser.'))
        return { consume: true }
      }
      return undefined
    })

    const showTasks = (list: TaskList) => {
      this.chatContainer.removeChild(activeSelect)
      heading.setText(
        `${theme.fg('accent', list.title)}  ${theme.dim('(Space toggle · Enter confirm · Esc back)')}`,
      )

      // Track original reminder state so we can compute toggle diffs
      const reminderBefore = new Map<string, boolean>()
      const preSelected: number[] = []
      const taskItems: MultiSelectItem[] = list.tasks.map((task, index) => {
        reminderBefore.set(task.id, task.reminder === true)
        if (task.reminder) preSelected.push(index)
        const marker = task.pending ? '◌ ' : '  '
        return {
          value: task.id,
          label: `${marker}${task.content}`,
          description: task.completed
            ? `${task.id}  completed`
            : task.pending
              ? `${task.id}  pending`
              : `${task.id}`,
          disabled: task.completed,
        }
      })
      const taskSelect = new MultiSelectList(
        taskItems,
        Math.min(taskItems.length, 14),
        {
          selectedText: (text) => chalk.cyan(text),
          disabledText: (text) => theme.dim(text),
          description: (text) => theme.dim(text),
          scrollInfo: (text) => theme.dim(text),
        },
        preSelected.length > 0 ? preSelected : undefined,
      )
      activeSelect = taskSelect
      this.chatContainer.addChild(taskSelect)
      this.ui.setFocus(taskSelect)
      this.ui.requestRender()

      taskSelect.onConfirm = async (selected) => {
        const selectedIds = new Set(selected.map((item) => item.value))

        const toAdd: string[] = []
        const toRemove: string[] = []

        for (const task of list.tasks) {
          if (task.completed) continue
          const wasReminded = reminderBefore.get(task.id) ?? false
          const isNowSelected = selectedIds.has(task.id)
          if (!wasReminded && isNowSelected) {
            toAdd.push(task.id)
          } else if (wasReminded && !isNowSelected) {
            toRemove.push(task.id)
          }
        }

        if (toAdd.length === 0 && toRemove.length === 0) {
          close()
          return
        }

        const added: string[] = []
        const removed: string[] = []
        const errors: string[] = []
        for (const id of toAdd) {
          const task = list.tasks.find((t) => t.id === id)!
          try {
            await this.sessionManager.remindTask(list.id, id, true)
            added.push(task.content)
          } catch (error) {
            errors.push(`${task.content}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        for (const id of toRemove) {
          const task = list.tasks.find((t) => t.id === id)!
          try {
            await this.sessionManager.remindTask(list.id, id, false)
            removed.push(task.content)
          } catch (error) {
            errors.push(`${task.content}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        let message = ''
        if (added.length > 0) {
          message += `${theme.fg('accent', '◆')} Prioritized ${added.length} task${added.length > 1 ? 's' : ''}:\n`
          for (const content of added) {
            message += `  ${theme.fg('text', content)}\n`
          }
        }
        if (removed.length > 0) {
          message += `${theme.dim('✕')} Removed ${removed.length} task${removed.length > 1 ? 's' : ''}:\n`
          for (const content of removed) {
            message += `  ${theme.dim(content)}\n`
          }
        }
        if (added.length > 0 || removed.length > 0) {
          message += `  ${theme.dim('Microcode will be reminded until each task is marked complete.')}`
        }
        if (errors.length > 0) {
          message += `\n${theme.fg('error', `Failed: ${errors.join('; ')}`)}`
        }
        close(message || undefined)
      }

      taskSelect.onCancel = () => {
        this.chatContainer.removeChild(taskSelect)
        activeSelect = listSelect
        heading.setText(theme.fg('accent', 'Task lists in this session:'))
        this.chatContainer.addChild(listSelect)
        this.ui.setFocus(listSelect)
        this.ui.requestRender()
      }
    }

    listSelect.onSelect = (item) => {
      if (item.value === '__cancel__') {
        close(theme.dim('Closed task browser.'))
        return
      }
      const list = lists.find((candidate) => candidate.id === item.value)
      if (list) showTasks(list)
    }
    listSelect.onCancel = () => close(theme.dim('Closed task browser.'))
  }

  private async handleNewSession(): Promise<void> {
    await this.agent.persistMessages()
    this.sessionManager.beginDraft(process.cwd())

    // Reset state
    this.agent.clearMessages()
    this.activeTurnTimeline = undefined
    this.toolRows.clear()
    this.pendingTools.clear()
    this.turnFinalized = false
    this.titleGenerated = false
    this.footer.setSessionTitle(null)
    this.footer.invalidate()

    // Clear chat and show confirmation
    this.chatContainer.clear()
    this.chatContainer.addChild(
      new Text(theme.fg('accent', 'New session ready.'), 1, 0),
    )
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private async generateSessionTitle(): Promise<void> {
    const messages = this.agent.getMessages()
    const firstUser = messages.find((m) => m.role === 'user')
    if (!firstUser) return

    let text = ''
    if (typeof firstUser.content === 'string') {
      text = firstUser.content
    } else if (Array.isArray(firstUser.content)) {
      text = firstUser.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join(' ')
    }

    text = text.trim()
    if (!text) return

    const fallbackTitle = text.length > 60 ? text.slice(0, 57) + '...' : text

    let title = fallbackTitle
    try {
      const model = this.agent.getCurrentModel()
      const result = await getModels().completeSimple(model, {
        systemPrompt: 'Generate a short, concise title (5 words max) for a conversation. Reply with ONLY the title, no quotes, no explanation.',
        messages: [{ role: 'user', content: [{ type: 'text', text: `Generate a title for a conversation that starts with: "${text.slice(0, 200)}"` }] }],
      } as any, { maxTokens: 30, temperature: 0.3 })

      const titleContent = result.content.find((c: any) => c.type === 'text') as any
      if (titleContent?.text) {
        title = titleContent.text.trim().replace(/^["']|["']$/g, '')
      }
    } catch {
      // Use fallback title
    }

    const sessionId = this.sessionManager.getSessionId()
    if (sessionId) {
      this.sessionManager.setTitle(sessionId, title)
      this.footer.setSessionTitle(title)
      this.footer.invalidate()
      this.ui.requestRender()
    }
  }

  /**
   * Rebuild system prompt for a resumed session, preserving loaded skills.
   */
  private rebuildSystemPromptForResume(): void {
    this.agent.refreshSystemPrompt()
  }

  /**
   * Clear the chat container and re-render all messages from history.
   */
  private rerenderChat(messages: AgentMessage[]): void {
    this.chatContainer.clear()
    this.toolRows.clear()
    this.pendingTools.clear()
    this.activeTurnTimeline = undefined
    this.turnFinalized = false

    for (const msg of messages) {
      if (msg.role === 'user') {
        let text = ''
        let images: ImageContent[] | undefined
        if (typeof msg.content === 'string') {
          text = msg.content
        } else if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text)
          text = textParts.join('\n')
          const imageParts = msg.content.filter((c: any) => c.type === 'image') as ImageContent[]
          if (imageParts.length > 0) images = imageParts
        }
        const timeline = new TurnTimeline()
        timeline.addEntry(new UserMessage(text, images))
        this.chatContainer.addChild(timeline)
        this.activeTurnTimeline = timeline
        this.turnFinalized = false
      } else if (msg.role === 'assistant') {
        if (!this.activeTurnTimeline) {
          this.activeTurnTimeline = new TurnTimeline()
          this.chatContainer.addChild(this.activeTurnTimeline)
        }
        const component = new AssistantMessageComponent(getMarkdownTheme())
        component.updateContent(msg as any)
        this.activeTurnTimeline.addEntry(component)

        for (const block of msg.content) {
          if (block.type !== 'toolCall') continue
          const row = this.createToolRow(block.id, block.name, block.arguments ?? {})
          row.markExecutionStarted()
          this.activeTurnTimeline.addEntry(row)
        }

        if (msg.stopReason === 'aborted') {
          this.activeTurnTimeline.addEntry(new Text(theme.fg('error', 'Interrupted'), 1, 0))
          this.turnFinalized = true
        } else if (msg.stopReason === 'error') {
          this.activeTurnTimeline.addEntry(new Text(theme.fg('error', `Error: ${msg.errorMessage || 'Unknown error'}`), 1, 0))
          this.turnFinalized = true
        } else if (msg.stopReason === 'stop') {
          this.activeTurnTimeline.addEntry(new Text(theme.fg('muted', 'Completed'), 1, 0))
          this.turnFinalized = true
        }
      } else if ((msg as any).role === 'toolResult') {
        const toolResult = msg as any
        let row = this.toolRows.get(toolResult.toolCallId)
        if (!row) {
          row = this.createToolRow(toolResult.toolCallId, toolResult.toolName, {})
          row.markExecutionStarted()
          this.appendTurnEntry(row)
        }
        row.updateResult({ content: toolResult.content ?? [], isError: toolResult.isError === true })
        if (row.updateDetails && toolResult.details && typeof toolResult.details === 'object') {
          row.updateDetails(toolResult.details)
        }
      }
    }

    this.activeTurnTimeline = undefined
  }

  private handleModelCommand(searchTerm?: string): void {
    if (searchTerm?.trim()) {
      const term = searchTerm.trim()
      const exact = getAllModels().filter((model) => `${model.provider}/${model.id}` === term || model.id === term)
      if (exact.length === 1) {
        this.switchModel(`${exact[0]!.provider}/${exact[0]!.id}`)
        return
      }
      this.showModelChoices(getAllModels().filter((model) =>
        `${model.provider} ${model.id} ${model.name}`.toLowerCase().includes(term.toLowerCase()),
      ), `Models matching “${term}”`)
      return
    }

    const allModels = getAllModels()
    const providers = getModels().getProviders()
      .map((provider) => ({
        value: provider.id,
        label: provider.name,
        description: `${allModels.filter((model) => model.provider === provider.id).length} models · ${provider.id}`,
      }))
      .filter((provider) => !provider.description.startsWith('0 models'))
    const currentProvider = String(this.agent.getCurrentModel().provider)
    const items: SelectItem[] = providers.map((provider) => ({ ...provider, label: `${provider.label}${provider.value === currentProvider ? ' (current)' : ''}` }))
    const selectList = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (text) => chalk.cyan(text),
      selectedText: (text) => chalk.cyan(text),
      description: (text) => theme.dim(text),
      scrollInfo: (text) => theme.dim(text),
      noMatch: (text) => theme.dim(text),
    }, { maxPrimaryColumnWidth: 52 })
    const removeFilter = this.addSelectListFilter(selectList)
    const providerTitle = new Text(theme.fg('accent', 'Choose provider — type to filter'), 1, 0)
    this.chatContainer.addChild(providerTitle)
    this.chatContainer.addChild(selectList)
    this.ui.setFocus(selectList)
    this.ui.requestRender()
    selectList.onSelect = (item) => {
      removeFilter()
      this.chatContainer.removeChild(selectList)
      this.chatContainer.removeChild(providerTitle)
      this.showModelChoices(allModels.filter((model) => model.provider === item.value), `${item.label} models`)
    }
    selectList.onCancel = () => {
      removeFilter()
      this.chatContainer.removeChild(selectList)
      this.chatContainer.removeChild(providerTitle)
      this.chatContainer.addChild(new Spacer(1))
      this.ui.setFocus(this.editor)
      this.ui.requestRender()
    }
  }

  private showModelChoices(models: Model<Api>[], title: string): void {
    if (models.length === 0) {
      this.showError('No matching models.')
      return
    }
    const currentModel = this.agent.getCurrentModel()
    const currentId = currentModel.id
    const currentApi = currentModel.api
    const currentProvider = currentModel.provider

    const items: SelectItem[] = models.sort((a, b) => a.id.localeCompare(b.id)).map((m) => {
      const isCurrent = m.id === currentId && m.api === currentApi && m.provider === currentProvider
      return {
        value: `${m.provider}/${m.id}`,
        label: `${m.name ?? m.id}${isCurrent ? ' (current)' : ''}`,
        description: `${m.id} · ${m.api}`,
      }
    })

    const selectList = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (text) => chalk.cyan(text),
      selectedText: (text) => chalk.cyan(text),
      description: (text) => theme.dim(text),
      scrollInfo: (text) => theme.dim(text),
      noMatch: (text) => theme.dim(text),
    }, { maxPrimaryColumnWidth: 52 })
    const removeFilter = this.addSelectListFilter(selectList)

    const label = theme.fg('accent', `${title} — type to filter`)
    const titleText = new Text(label, 1, 0)
    this.chatContainer.addChild(titleText)
    this.chatContainer.addChild(selectList)
    this.ui.setFocus(selectList)
    this.ui.requestRender()

    let finished = false
    const removeListener = this.ui.addInputListener((data) => {
      if (data === '\x03') {
        // Ctrl+C
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)
        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        return { consume: true }
      }
      return undefined
    })

    const finish = (selectedValue?: string) => {
      if (finished) return
      finished = true
      removeFilter()
      removeListener()
      this.chatContainer.removeChild(selectList)
      this.chatContainer.removeChild(titleText)

      if (selectedValue) {
        this.switchModel(selectedValue)
      }

      this.chatContainer.addChild(new Spacer(1))
      this.ui.setFocus(this.editor)
      this.ui.requestRender()
    }

    selectList.onSelect = (item) => {
      finish(item.value)
    }

    selectList.onCancel = () => {
      finish()
    }
  }

  /** Switch to a model by ID and update all dependent state. */
  private switchModel(modelId: string, api?: Api): void {
    try {
      const slash = modelId.indexOf('/')
      const provider = slash > 0 ? modelId.slice(0, slash) : undefined
      const id = provider ? modelId.slice(slash + 1) : modelId
      const snapshot = this.agent.switchModel(id, api, provider)
      const model = snapshot.model

      // Clear image state on model switch
      this.clearPendingImages()
      this.suppressTrailingQuote = false

      // Rebuild footer with new model info
      this.footer.invalidate()

      this.showStatus(`Model switched to: ${snapshot.provider}/${model.id} (${model.api})`)
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error))
    }
  }

  private handleMcpCommand(args: string): void {
    if (!this.mcpClient) {
      this.showError('No MCP client available.')
      return
    }

    void args

    const states = this.mcpClient.getServerStates()
    if (states.length === 0) {
      this.chatContainer.addChild(
        new Text(theme.dim('No MCP servers configured.'), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))
      this.ui.requestRender()
      return
    }

    this.chatContainer.addChild(
      new Text(theme.fg('accent', 'MCP Servers:'), 1, 0),
    )
    this.chatContainer.addChild(new Spacer(1))

    for (const state of states) {
      const statusIcon = state.status === 'connected' ? '✓'
        : state.status === 'failed' ? '✗'
        : state.status === 'disabled' ? '○'
        : '◌'
      const statusLine = `${statusIcon} ${theme.bold(state.name)} ${theme.dim(`(${state.status})`)}`
      this.chatContainer.addChild(new Text(statusLine, 1, 0))

      if (state.status === 'connected' && state.tools.length > 0) {
        const toolNames = state.tools.map(t => t.name).join(', ')
        this.chatContainer.addChild(
          new Text(`  ${theme.dim('Tools:')} ${toolNames}`, 1, 0),
        )
      }

      if (state.status === 'connected' && state.resources.length > 0) {
        const resourceNames = state.resources.map(r => r.name).join(', ')
        this.chatContainer.addChild(
          new Text(`  ${theme.dim('Resources:')} ${resourceNames}`, 1, 0),
        )
      }

      if (state.status === 'failed' && state.error) {
        this.chatContainer.addChild(
          new Text(`  ${chalk.hex('#cc6666')(state.error)}`, 1, 0),
        )
      }
    }

    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private rebuildSystemPrompt(mcpServers?: McpServerState[]): void {
    this.agent.updateMcpServers(mcpServers)
  }

  updateMcpState(mcpClient: McpClientManager): void {
    this.mcpClient = mcpClient
    this.rebuildSystemPrompt(mcpClient.getServerStates())
  }

  showMcpReady(states: McpServerState[]): void {
    const connected = states.filter(s => s.status === 'connected')
    const failed = states.filter(s => s.status === 'failed')

    const parts: string[] = []
    if (connected.length > 0) {
      parts.push(`${connected.length} server(s) connected`)
    }
    if (failed.length > 0) {
      parts.push(`${failed.length} failed`)
    }

    this.chatContainer.addChild(
      new Text(theme.dim(`MCP ready: ${parts.join(', ')}`), 1, 0),
    )
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private static PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
    'interactive': 'Read: auto-allow | Write/Edit/Bash: prompt before execution',
    'auto-approve': 'All tools execute without confirmation (YOLO mode)',
    'plan': 'Read-only — all write/edit/bash operations are blocked',
  }

  private handlePermissionCommand(args: string): void {
    const mode = args.trim().toLowerCase() as PermissionMode

    if (!mode) {
      const current = this.agent.getPermissionMode()
      const items: SelectItem[] = PERMISSION_MODES.map((m) => ({
        value: m,
        label: m,
        description: `${App.PERMISSION_DESCRIPTIONS[m]}${m === current ? ' (current)' : ''}`,
      }))

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      const label = theme.fg('accent', 'Select permission mode:')
      this.chatContainer.addChild(new Text(label, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') {
          finished = true
          removeListener()
          this.chatContainer.removeChild(selectList)
          this.chatContainer.addChild(new Spacer(1))
          this.ui.setFocus(this.editor)
          this.ui.requestRender()
          return { consume: true }
        }
        return undefined
      })

      const finish = (selectedMode?: PermissionMode) => {
        if (finished) return
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)

        if (selectedMode) {
          this.agent.setPermissionMode(selectedMode)
          this.showStatus(`Permission mode set to: ${selectedMode}`)
        }

        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
      }

      selectList.onSelect = (item) => {
        finish(item.value as PermissionMode)
      }

      selectList.onCancel = () => {
        finish()
      }

      return
    }

    if (!PERMISSION_MODES.includes(mode)) {
      this.showError(`Invalid permission mode: ${mode}. Valid modes: ${PERMISSION_MODES.join(', ')}`)
      return
    }

    this.agent.setPermissionMode(mode)
    this.showStatus(`Permission mode set to: ${mode}`)
  }

  private static THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  private static THINKING_DESCRIPTIONS: Record<ThinkingLevel, string> = {
    off: 'No reasoning',
    minimal: 'Very brief reasoning (~1k tokens)',
    low: 'Light reasoning (~2k tokens)',
    medium: 'Moderate reasoning (~8k tokens)',
    high: 'Deep reasoning (~16k tokens)',
    xhigh: 'Maximum reasoning (~32k tokens)',
    max: 'Maximum supported reasoning budget',
  }

  private handleThinkingCommand(args: string): void {
    const level = args.trim().toLowerCase() as ThinkingLevel

    if (!level) {
      const items: SelectItem[] = App.THINKING_LEVELS.map((l) => ({
        value: l,
        label: l,
        description: App.THINKING_DESCRIPTIONS[l],
      }))

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      const thinkingLabel = theme.fg('accent', 'Select thinking level:')
      this.chatContainer.addChild(new Text(thinkingLabel, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') {
          // Ctrl+C
          finished = true
          removeListener()
          this.chatContainer.removeChild(selectList)
          this.chatContainer.addChild(new Spacer(1))
          this.ui.setFocus(this.editor)
          this.ui.requestRender()
          return { consume: true }
        }
        return undefined
      })

      const finish = (selectedLevel?: ThinkingLevel) => {
        if (finished) return
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)

        if (selectedLevel) {
          this.agent.setThinkingLevel(selectedLevel)
          this.footer.invalidate()
          this.showStatus(`Thinking level set to: ${selectedLevel}`)
        }

        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
      }

      selectList.onSelect = (item) => {
        finish(item.value as ThinkingLevel)
      }

      selectList.onCancel = () => {
        finish()
      }

      return
    }

    if (!App.THINKING_LEVELS.includes(level)) {
      this.showError(`Invalid thinking level: ${level}. Valid levels: ${App.THINKING_LEVELS.join(', ')}`)
      return
    }

    this.agent.setThinkingLevel(level)
    this.footer.invalidate()
    this.showStatus(`Thinking level set to: ${level}`)
  }

  private handleSkillsCommand(): void {
    const skillSnapshot = this.agent.getSkillSnapshot()
    const skills = skillSnapshot.available
    const diagnostics = skillSnapshot.diagnostics

    if (skills.length === 0) {
      this.chatContainer.addChild(
        new Text(theme.dim('No skills loaded.'), 1, 0),
      )
      this.chatContainer.addChild(
        new Text(theme.dim('Create SKILL.md files in ~/.microcode/skills/ or .microcode/skills/ to add skills.'), 1, 0),
      )
    } else {
      this.chatContainer.addChild(
        new Text(theme.fg('accent', `Available skills (${skills.length}):`), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))

      for (const skill of skills) {
        const disabled = skill.disableModelInvocation ? theme.dim(' (disabled)') : ''
        const loaded = this.agent.isSkillLoaded(skill.name) ? chalk.green(' (loaded)') : theme.dim(' (unloaded)')
        this.chatContainer.addChild(
          new Text(`${theme.bold(skill.name)}${disabled}${loaded}`, 1, 0),
        )
        this.chatContainer.addChild(
          new Text(`  ${theme.dim(skill.description)}`, 1, 0),
        )
        this.chatContainer.addChild(
          new Text(`  ${theme.dim(skill.filePath)}`, 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
      }
    }

    if (diagnostics.length > 0) {
      this.chatContainer.addChild(
        new Text(theme.fg('yellow', 'Skill diagnostics:'), 1, 0),
      )
      for (const diagnostic of diagnostics) {
        this.chatContainer.addChild(
          new Text(`  ${theme.dim(diagnostic)}`, 1, 0),
        )
      }
      this.chatContainer.addChild(new Spacer(1))
    }

    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private handleSkillSlashCommand(skill: Skill): void {
    const currentlyLoaded = this.agent.isSkillLoaded(skill.name)

    const statusText = currentlyLoaded
      ? chalk.green('loaded')
      : theme.dim('unloaded')

    const headerLabel = theme.fg('accent', `Skill '${skill.name}':`)
    this.chatContainer.addChild(
      new Text(`${headerLabel} ${statusText}`, 1, 0),
    )
    this.chatContainer.addChild(
      new Text(theme.dim(`  ${skill.description}`), 1, 0),
    )

    const items: SelectItem[] = []
    if (currentlyLoaded) {
      items.push({ value: 'unload', label: 'Unload', description: 'Remove skill from system prompt' })
    } else {
      items.push({ value: 'load', label: 'Load', description: 'Add skill to system prompt' })
    }
    items.push({ value: 'cancel', label: 'Cancel', description: 'Do nothing' })

    const selectList = new SelectList(items, items.length, {
      selectedPrefix: (text) => chalk.cyan(text),
      selectedText: (text) => chalk.cyan(text),
      description: (text) => theme.dim(text),
      scrollInfo: (text) => theme.dim(text),
      noMatch: (text) => theme.dim(text),
    })

    this.chatContainer.addChild(selectList)
    this.ui.setFocus(selectList)
    this.ui.requestRender()

    let finished = false

    const removeListener = this.ui.addInputListener((data) => {
      if (data === '\x03') {
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)
        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        return { consume: true }
      }
      return undefined
    })

    const finish = (value?: string) => {
      if (finished) return
      finished = true
      removeListener()
      this.chatContainer.removeChild(selectList)

      if (value === 'load') {
        try {
          this.agent.loadSkill(skill.name)
          this.chatContainer.addChild(
            new Text(theme.fg('accent', `Loaded skill '${skill.name}' into system prompt.`), 1, 0),
          )
        } catch (error) {
          this.chatContainer.addChild(
            new Text(theme.fg('red', `Failed to load skill '${skill.name}': ${error instanceof Error ? error.message : 'Unknown error'}`), 1, 0),
          )
        }
      } else if (value === 'unload') {
        this.agent.unloadSkill(skill.name)
        this.chatContainer.addChild(
          new Text(theme.fg('accent', `Unloaded skill '${skill.name}' from system prompt.`), 1, 0),
        )
      } else {
        this.chatContainer.addChild(
          new Text(theme.dim('Cancelled.'), 1, 0),
        )
      }

      this.chatContainer.addChild(new Spacer(1))
      this.ui.setFocus(this.editor)
      this.ui.requestRender()
    }

    selectList.onSelect = (item) => finish(item.value)
    selectList.onCancel = () => finish(undefined)
  }

  /**
   * Interactively present questions from the ask_user_question tool and collect answers.
   * Each question is shown as a SelectList in the chat area.
   * Returns the collected answers, or { block: true } if cancelled.
   */
  async promptAskUserQuestion(
    _toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ answers?: Record<string, string>; block?: boolean }> {
    const questions = input.questions as Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiSelect?: boolean
    }>

    if (!questions || questions.length === 0) {
      return { block: true }
    }

    const answers: Record<string, string> = {}

    for (const q of questions) {
      const answer = await this.promptSingleQuestion(q)
      if (answer === undefined) {
        // User cancelled
        return { block: true }
      }
      answers[q.question] = answer
    }

    return { answers }
  }

  /**
   * Present a single question with its options as a SelectList.
   * Returns the selected answer string, or undefined if cancelled.
   */
  private async promptSingleQuestion(q: {
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect?: boolean
  }): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      this.hideWorking()
      this.permissionPromptActive = true

      // Build select items from options + "Other"
      const items: SelectItem[] = q.options.map((opt) => ({
        value: opt.label,
        label: opt.label,
        description: opt.description,
      }))
      items.push({
        value: '__other__',
        label: 'Other',
        description: 'Provide a custom answer',
      })

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      // Show question header and the select list
      const headerLabel = theme.fg('accent', `${q.header}:`)
      this.chatContainer.addChild(new Text(`${headerLabel} ${q.question}`, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') {
          // Ctrl+C — cancel
          finished = true
          removeListener()
          this.permissionPromptActive = false
          this.chatContainer.removeChild(selectList)
          this.chatContainer.addChild(new Spacer(1))
          this.ui.setFocus(this.editor)
          this.ui.requestRender()
          this.flushPendingEventsWhilePermission()
          resolve(undefined)
          return { consume: true }
        }
        return undefined
      })

      const finish = (value?: string) => {
        if (finished) return
        finished = true
        removeListener()
        this.permissionPromptActive = false
        this.chatContainer.removeChild(selectList)
        this.flushPendingEventsWhilePermission()

        if (value === '__other__') {
          // Show "Other" prompt — let user type free-text
          this.chatContainer.addChild(
            new Text(theme.dim('Type your answer and press Enter:'), 1, 0),
          )
          this.ui.setFocus(this.editor)
          this.ui.requestRender()

          // Wait for user to type in the editor
          void this.getUserInput().then((text) => {
            const trimmed = text.trim()
            this.chatContainer.addChild(new Text(`  ${chalk.cyan(trimmed)}`, 1, 0))
            this.chatContainer.addChild(new Spacer(1))
            this.ui.requestRender()
            resolve(trimmed || undefined)
          })
          return
        }

        // Show selected answer
        this.chatContainer.addChild(
          new Text(`  ${chalk.cyan(value ?? '')}`, 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
        this.showWorking()
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        resolve(value)
      }

      selectList.onSelect = (item) => finish(item.value)
      selectList.onCancel = () => finish(undefined)
    })
  }

  /**
   * Prompt user for tool permission using an inline select list in the chat area.
   * Returns true if approved, false if denied.
   */
  async promptPermission(
    toolName: string,
    input: Record<string, unknown>,
    description: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Permission waiting is not tool execution time.
      this.pauseToolElapsedTimer()
      this.hideWorking()
      this.permissionPromptActive = true

      // Extract content for session rule matching
      const ruleContent = this.extractRuleContent(toolName, input)
      const sessionLabel = ruleContent ? `${toolName}(${ruleContent})` : toolName

      const items: SelectItem[] = [
        { value: 'allow', label: 'Allow', description: `Allow ${toolName} to execute` },
        { value: 'allow-session', label: `Allow for session`, description: `Don't ask again for ${sessionLabel}` },
        { value: 'deny', label: 'Deny', description: `Block ${toolName} execution` },
      ]

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      // Add inline to chat area
      const permLabel = theme.fg('accent', 'Permission requested:')
      this.chatContainer.addChild(new Text(`${permLabel} ${description}`, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      // Intercept Ctrl+C before it reaches SelectList — exit app instead of deny
      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') { // Ctrl+C
          finished = true
          removeListener()
          this.permissionPromptActive = false
          this.chatContainer.removeChild(selectList)
          this.flushPendingEventsWhilePermission()
          this.exit()
          return { consume: true }
        }
        return undefined
      })

      const finish = (approved: boolean) => {
        if (finished) return
        finished = true
        removeListener()
        this.permissionPromptActive = false
        this.chatContainer.removeChild(selectList)
        this.flushPendingEventsWhilePermission()
        const icon = approved ? theme.fg('green', '✓') : theme.fg('red', '✗')
        const resultText = approved ? 'Approved' : 'Denied'
        this.chatContainer.addChild(new Text(`${icon} ${resultText}`, 1, 0))
        this.chatContainer.addChild(new Spacer(1))
        // Start timing from approval, when execution is allowed to continue.
        if (approved) {
          this.resumeToolElapsedTimer()
          this.showWorking()
        }
        else {
          this.clearPendingToolState()
          this.hideWorking()
        }
        // Restore focus to editor so user can type again
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        if (!approved) this.agent.abort()
        resolve(approved)
      }

      selectList.onSelect = (item) => {
        if (item.value === 'allow-session') {
          this.agent.addSessionPermission(toolName, ruleContent)
        }
        finish(item.value === 'allow' || item.value === 'allow-session')
      }
      selectList.onCancel = () => finish(false)
    })
  }

  private extractRuleContent(toolName: string, input: Record<string, unknown>): string | undefined {
    switch (toolName) {
      case BASH_TOOL_NAME:
        return typeof input.command === 'string' ? input.command : undefined
      case EDIT_TOOL_NAME:
      case WRITE_TOOL_NAME:
      case READ_TOOL_NAME:
        return typeof input.path === 'string' ? input.path : undefined
      default:
        return undefined
    }
  }

  private showHelp(): void {
    const helpText = [
      `${theme.fg('accent', 'Available Commands:')}`,
      '',
      `  ${theme.bold('/clear')}              Clear the conversation history`,
      `  ${theme.bold('/compact')} [instr.]    Compress conversation context`,
      `  ${theme.bold('/status')}             Show context usage, token statistics, and model details`,
      `  ${theme.bold('/model')} [model-id]   Show current model or switch to a different model`,
      `  ${theme.bold('/login')} [provider]   Sign in with provider and method pickers`,
      `  ${theme.bold('/logout')} [provider]  Sign out with a provider picker`,
      `  ${theme.bold('/auth')}             Show provider authentication status`,
      `  ${theme.bold('/thinking')} [level]   Show or set thinking depth`,
      `  ${theme.bold('/mcp')}                Show MCP servers`,
      `  ${theme.bold('/session')}            Browse and load saved sessions`,
      `  ${theme.bold('/tasks')}              Browse and prioritize tasks in the current session`,
      `  ${theme.bold('/new')}                Start a new conversation session`,
      `  ${theme.bold('/permission')} [mode]  Show or switch permission mode`,
      `  ${theme.bold('/exit')}               Exit Microcode`,
      `  ${theme.bold('/help')}               Show this help message`,
      '',
      `${theme.fg('accent', 'Keyboard Shortcuts:')}`,
      '',
      `  ${theme.bold('Escape')}              Interrupt current operation`,
      `  ${theme.bold('Ctrl+C')}              Interrupt (when busy) / Exit`,
      `  ${theme.bold('Ctrl+D')}              Exit (when input is empty)`,
      `  ${theme.bold('Enter')}               Submit message`,
      `  ${theme.bold('Shift+Enter')}         New line in editor`,
      `  ${theme.bold('Up/Down')}             Browse command history`,
      `  ${theme.bold('Tab')}                 Accept autocomplete suggestion`,
      '',
      `${theme.fg('accent', 'Environment Variables:')}`,
      '',
      `  ANTHROPIC_API_KEY     Anthropic API key`,
      `  ANTHROPIC_BASE_URL    Anthropic API base URL`,
      `  ANTHROPIC_MODEL       Anthropic model ID`,
      `  OPENAI_API_KEY        OpenAI API key`,
      `  OPENAI_BASE_URL       OpenAI API base URL`,
      `  OPENAI_MODEL          OpenAI model ID`,
      `  API_KEY               Fallback API key`,
      `  BASE_URL              Fallback base URL`,
      `  MODEL                 Fallback model ID`,
    ]

    // Add available skills
    const skills = this.agent.getSkills()
    if (skills.length > 0) {
      helpText.push('')
      helpText.push(`${theme.fg('accent', 'Available Skills:')}`)
      helpText.push('')
      for (const skill of skills) {
        const disabled = skill.disableModelInvocation ? ' (disabled)' : ''
        helpText.push(`  ${theme.bold(`/${skill.name}`)}${disabled}    ${skill.description}`)
      }
    }

    for (const line of helpText) {
      this.chatContainer.addChild(new Text(line, 1, 0))
    }
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private showStatus(message: string): void {
    this.chatContainer.addChild(new Spacer(1))
    this.chatContainer.addChild(new Text(theme.dim(message), 1, 0))
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private showError(message: string): void {
    this.chatContainer.addChild(
      new Text(chalk.hex('#cc6666')(`Error: ${message}`), 1, 0),
    )
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  getPendingImageContents(): ImageContent[] {
    return this.pendingImages.map((img) => ({
      type: 'image' as const,
      data: img.base64Data,
      mimeType: img.mimeType,
    }))
  }

  clearPendingImages(): void {
    this.pendingImages = []
    this.suppressTrailingQuote = false
  }

  private handleEditorSubmit(text: string): void {
    this.editor.addToHistory(text)

    // Agent is busy — no one is listening for input yet. Handle slash commands
    // inline, or tell the user the agent is busy.
    if (!this._inputResolve && this.isAgentBusy()) {
      if (text.startsWith('/')) {
        this.handleSlashCommand(text.trim())
        this.ui.requestRender()
        return
      }
      if (text.startsWith('!')) {
        this.showStatus('Agent is busy — press Esc or Ctrl+C to cancel, then run the command.')
        return
      }
      this.showStatus(
        `Agent is busy — press Esc or Ctrl+C to cancel. Type /help for available commands.`,
      )
      return
    }

    this._pendingInput = text
    this._inputResolve?.()
  }

  private _pendingInput?: string
  private _inputResolve?: () => void

  async getUserInput(): Promise<string> {
    return new Promise<string>((resolve) => {
      this._inputResolve = () => {
        const text = this._pendingInput ?? ''
        this._pendingInput = undefined
        this._inputResolve = undefined
        resolve(text)
      }

      if (this._pendingInput !== undefined) {
        this._inputResolve()
      }
    })
  }

  private appendTurnEntry(component: Component): void {
    if (this.activeTurnTimeline) {
      this.activeTurnTimeline.addEntry(component)
    } else {
      this.chatContainer.addChild(component)
    }
  }

  private createToolRow(toolCallId: string, toolName: string, args: any): ToolUIComponent {
    const UIConstructor = getToolUIConstructor(toolName)
    const component: ToolUIComponent = UIConstructor
      ? new UIConstructor(toolCallId, args)
      : new ToolExecutionComponent(toolName, toolCallId, args)
    component.setExpanded(this.toolDetailsExpanded)
    this.toolRows.set(toolCallId, component)
    return component
  }

  private finishTurn(label?: string): void {
    if (this.turnFinalized) return
    this.activeTurnTimeline?.setActivity(undefined)
    if (label) {
      this.appendTurnEntry(new Text(theme.fg('muted', label), 1, 0))
    }
    this.turnFinalized = true
  }

  private setupAgentSubscription(): void {
    this.agent.subscribe((event: MicrocodeAgentEvent) => {
      const process = () => {
        switch (event.type) {
          case 'compaction_changed':
          this.updateCompactionProgress(event.progress)
          break

        case 'agent_start':
          this.showWorking('Thinking…')
          break

        case 'message_start':
          if (event.message.role === 'assistant') {
            this.streamingComponent = new AssistantMessageComponent(getMarkdownTheme())
            this.streamingMessage = event.message
            this.appendTurnEntry(this.streamingComponent)
            this.showWorking('Thinking…')
            this.streamingComponent.updateContent(this.streamingMessage)
            this.ui.requestRender()
          }
          break

        case 'message_update':
          if (this.streamingComponent && event.message.role === 'assistant') {
            this.streamingMessage = event.message
            this.streamingComponent.updateContent(this.streamingMessage)
            if (
              event.assistantMessageEvent.type === 'toolcall_start' ||
              event.assistantMessageEvent.type === 'toolcall_delta'
            ) {
              this.updateStreamingToolCall(
                event.message,
                event.assistantMessageEvent.type === 'toolcall_start',
              )
            }
            this.ui.requestRender()
          }
          break

        case 'message_end':
          if (event.message.role === 'assistant') {
            if (this.streamingComponent && this.streamingMessage) {
              this.streamingComponent.updateContent(this.streamingMessage)
              this.streamingComponent = undefined
              this.streamingMessage = undefined
            }
            this.updateContextUsage()
            this.footer.invalidate()
          }
          this.ui.requestRender()
          break

        case 'tool_execution_start': {
          const existing = this.pendingTools.get(event.toolCallId)
          const alreadyVisible = this.toolRows.has(event.toolCallId)
          const component: ToolUIComponent = existing ?? this.toolRows.get(event.toolCallId)
            ?? this.createToolRow(event.toolCallId, event.toolName, event.args)
          component.updateArgs?.(event.args)
          component.setExpanded(this.toolDetailsExpanded)
          component.markExecutionStarted()
          if (!alreadyVisible) {
            this.appendTurnEntry(component)
          }
          this.pendingTools.set(event.toolCallId, component)
          this.pendingToolStartedAt.set(event.toolCallId, performance.now())
          this.startToolElapsedTimer()
          // Keep the global working indicator alive across the model -> tool handoff.
          this.showWorking(`Running ${event.toolName}…`)
          this.commitToolFrame()
          break
        }

        case 'tool_execution_update': {
          const component = this.pendingTools.get(event.toolCallId)
          if (component) {
            if (component.updateDetails && event.partialResult.details) {
              component.updateDetails(event.partialResult.details)
            }
            component.updateResult(
              { ...event.partialResult, isError: false },
              true,
            )
            this.commitToolFrame()
          }
          break
        }

        case 'tool_execution_end': {
          const component = this.pendingTools.get(event.toolCallId)
          if (component) {
            const startedAt = this.pendingToolStartedAt.get(event.toolCallId)
            if (startedAt !== undefined) {
              component.updateElapsed?.(performance.now() - startedAt)
            }
            component.updateResult({
              ...event.result,
              isError: event.isError,
            })
            // Pass details to per-tool UI for diff rendering
            if (component.updateDetails && event.result.details) {
              component.updateDetails(event.result.details)
            }
            this.updateContextUsage()
            this.footer.invalidate()
          }
          this.pendingTools.delete(event.toolCallId)
          this.pendingToolStartedAt.delete(event.toolCallId)
          this.streamingToolLastRenderAt.delete(event.toolCallId)
          this.stopToolElapsedTimerIfIdle()
          this.showWorking(this.pendingTools.size > 0 ? 'Running tools…' : 'Thinking…')
          this.ui.requestRender()
          break
        }

        case 'turn_end':
          if (
            event.message.role === 'assistant' &&
            (event.message.stopReason === 'aborted' || event.message.stopReason === 'error')
          ) {
            this.clearPendingToolState()
            this.activeTurnTimeline?.setActivity(undefined)
            const isInterrupted = event.message.stopReason === 'aborted'
            this.appendTurnEntry(new Text(
              theme.fg('error', isInterrupted
                ? 'Interrupted'
                : `Error: ${event.message.errorMessage || 'Unknown error'}`),
              1,
              0,
            ))
            this.turnFinalized = true
            this.hideWorking()
          // A streamed tool call may already be pending before tool_execution_start.
          // Do not hide Working during that model -> tool handoff.
          } else if (this.pendingTools.size > 0) {
            this.showWorking('Running tools…')
          } else {
            this.hideWorking()
          }
          if (event.message.role === 'assistant' && event.message.stopReason === 'stop') {
            this.finishTurn('Completed')
          }
          this.chatContainer.addChild(new Spacer(1))
          // Generate session title from first user message
          if (!this.titleGenerated) {
            this.titleGenerated = true
            void this.generateSessionTitle()
          }
          void this.agent.persistMessages()
          this.updateContextUsage()
          this.footer.invalidate()
          this.ui.requestRender()
          break

        case 'agent_end':
          if (!this.isAgentBusy()) {
            this.clearPendingToolState()
            this.finishTurn(this.turnFinalized ? undefined : 'Completed')
            this.hideWorking()
            this.ui.requestRender()
            break
          }
          // Some agent implementations emit agent_end for the model turn before
          // executing its requested tools. Pending tools still mean real work remains.
          if (this.pendingTools.size === 0) {
            this.finishTurn('Completed')
            this.hideWorking()
          } else {
            this.showWorking('Running tools…')
          }
          this.ui.requestRender()
          break
        }
      }
      if (this.permissionPromptActive) {
        this.pendingEventsWhilePermission.push(() => process())
      } else {
        process()
      }
    })
  }

  private flushPendingEventsWhilePermission(): void {
    const queue = this.pendingEventsWhilePermission
    this.pendingEventsWhilePermission = []
    for (const replay of queue) {
      replay()
    }
  }

  private updateWorkingIndicator(): void {
    if (this.agentWorking) {
      this.workingFrameIndex++
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      const frame = frames[Math.floor(this.workingFrameIndex / 2) % frames.length]
      const label = `${theme.fg('accent', frame)} ${this.agentActivityLabel}`
      if (this.activeTurnTimeline) {
        this.activeTurnTimeline.setActivity(this.pendingTools.size > 0 ? undefined : label)
        if (this.workingText) {
          this.workingContainer.removeChild(this.workingText)
          this.workingText = null
        }
      } else if (this.workingText) {
        this.workingText.setText(label)
      } else {
        this.workingText = new Text(label, 1, 0)
        this.workingContainer.addChild(this.workingText)
      }
      if (!this.workingTimer) {
        this.workingTimer = setInterval(() => {
          this.updateWorkingIndicator()
          this.ui.requestRender()
        }, 80)
      }
      return
    }
    if (this.workingTimer) {
      clearInterval(this.workingTimer)
      this.workingTimer = undefined
    }
    if (this.workingText) {
      this.workingContainer.removeChild(this.workingText)
      this.workingText = null
    }
    this.activeTurnTimeline?.setActivity(undefined)
    this.workingFrameIndex = 0
  }
  private updateStreamingToolCall(message: AgentMessage, forceRender: boolean): void {
    if (message.role !== 'assistant') return

    const toolCalls = message.content.filter((block) => block.type === 'toolCall')
    for (const toolCall of toolCalls) {
      const args = toolCall.arguments ?? {}
      let component = this.pendingTools.get(toolCall.id) ?? this.toolRows.get(toolCall.id)

      if (!component) {
        component = this.createToolRow(toolCall.id, toolCall.name, args)
        component.markExecutionStarted()
        this.appendTurnEntry(component)
        this.pendingTools.set(toolCall.id, component)
        // The tool is pending as soon as its call starts streaming. Waiting for
        // tool_execution_start creates a visible gap where Working disappears.
        this.showWorking('Preparing tool calls…')
      } else {
        component.updateArgs?.(args)
      }

      if (toolCall.name === WRITE_TOOL_NAME && component.updateDetails) {
        const filePath = typeof args.file_path === 'string' ? args.file_path : ''
        const content = typeof args.content === 'string' ? args.content : ''
        const resolvedPath = filePath
          ? (isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath))
          : ''
        const isNewFile = resolvedPath ? !existsSync(resolvedPath) : false
        component.updateDetails({
          path: resolvedPath || filePath,
          bytesWritten: Buffer.byteLength(content, 'utf8'),
          additions: countStreamingLines(content),
          removals: 0,
          isNewFile,
          phase: 'preparing',
        })
      } else if (toolCall.name === EDIT_TOOL_NAME && component.updateDetails) {
        const oldString = typeof args.old_string === 'string' ? args.old_string : ''
        const newString = typeof args.new_string === 'string' ? args.new_string : ''
        component.updateDetails({
          path: typeof args.file_path === 'string' ? args.file_path : '',
          additions: countStreamingLines(newString),
          removals: countStreamingLines(oldString),
          replacements: args.replace_all === true ? 0 : 1,
          phase: 'preparing',
        })
      }

      const now = performance.now()
      const lastRenderAt = this.streamingToolLastRenderAt.get(toolCall.id) ?? 0
      if (forceRender || now - lastRenderAt >= 100) {
        this.streamingToolLastRenderAt.set(toolCall.id, now)
        this.commitToolFrame()
      }
    }
  }

  private commitToolFrame(): void {
    const immediateUi = this.ui as unknown as {
      stopped?: boolean
      renderRequested?: boolean
      renderTimer?: ReturnType<typeof setTimeout>
      lastRenderAt?: number
      doRender?: () => void
    }

    if (!immediateUi.stopped && typeof immediateUi.doRender === 'function') {
      if (immediateUi.renderTimer) {
        clearTimeout(immediateUi.renderTimer)
        immediateUi.renderTimer = undefined
      }
      immediateUi.renderRequested = false
      immediateUi.lastRenderAt = performance.now()
      immediateUi.doRender()
      return
    }

    // Fallback for future pi-tui versions that change their renderer internals.
    this.ui.requestRender()
  }

  private updateCompactionProgress(
    progress: Extract<
      MicrocodeAgentEvent,
      { type: 'compaction_changed' }
    >['progress'],
  ): void {
    if (!this.compactionProgressText) {
      this.compactionProgressText = new Text('', 1, 0)
      this.chatContainer.addChild(this.compactionProgressText)
    }

    const percent = Math.max(0, Math.min(100, progress.progress ?? 0))
    const width = 20
    const filled = Math.round((percent / 100) * width)
    const bar =
      `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`
    const elapsed = progress.elapsedMs === undefined
      ? ''
      : ` ${(progress.elapsedMs / 1000).toFixed(1)}s`
    const units =
      progress.totalUnits !== undefined && progress.processedUnits !== undefined
        ? ` · ${progress.processedUnits}/${progress.totalUnits} units`
        : ''
    const color = progress.phase === 'done' &&
      progress.message.startsWith('Compaction failed')
      ? (text: string) => chalk.hex('#cc6666')(text)
      : (text: string) => theme.fg('accent', text)
    this.compactionProgressText.setText(
      color(`${bar} ${percent}% ${progress.message}${units}${elapsed}`),
    )

    if (progress.phase === 'done' && !this.compacting) {
      this.chatContainer.addChild(new Spacer(1))
      this.compactionProgressText = undefined
    }
    this.ui.requestRender()
  }

  private updateContextUsage(): void {
    this.footer.invalidate()
  }

  private startToolElapsedTimer(): void {
    if (this.toolElapsedTimer) return

    this.toolElapsedTimer = setInterval(() => {
      const now = performance.now()
      let updated = false

      for (const [toolCallId, startedAt] of this.pendingToolStartedAt) {
        const component = this.pendingTools.get(toolCallId)
        if (!component?.updateElapsed) continue
        component.updateElapsed(now - startedAt)
        updated = true
      }

      if (updated) {
        this.ui.requestRender()
      }
    }, 100)
  }

  private stopToolElapsedTimerIfIdle(): void {
    if (this.pendingToolStartedAt.size > 0 || !this.toolElapsedTimer) return
    clearInterval(this.toolElapsedTimer)
    this.toolElapsedTimer = undefined
  }

  private pauseToolElapsedTimer(): void {
    if (this.toolElapsedTimer) {
      clearInterval(this.toolElapsedTimer)
      this.toolElapsedTimer = undefined
    }

    this.pendingToolStartedAt.clear()
    for (const component of this.pendingTools.values()) {
      component.updateElapsed?.(0)
    }
    this.ui.requestRender()
  }

  private resumeToolElapsedTimer(): void {
    const startedAt = performance.now()
    for (const [toolCallId, component] of this.pendingTools) {
      if (!component.updateElapsed) continue
      component.updateElapsed(0)
      this.pendingToolStartedAt.set(toolCallId, startedAt)
    }
    if (this.pendingToolStartedAt.size > 0) {
      this.startToolElapsedTimer()
    }
  }

  private clearPendingToolState(): void {
    this.pendingTools.clear()
    this.pendingToolStartedAt.clear()
    this.streamingToolLastRenderAt.clear()
    if (this.toolElapsedTimer) {
      clearInterval(this.toolElapsedTimer)
      this.toolElapsedTimer = undefined
    }
  }

  private showWorking(label = 'Working…'): void {
    this.agentActivityLabel = label
    this.agentWorking = true
    this.updateWorkingIndicator()
    this.ui.requestRender()
  }

  private hideWorking(): void {
    if (!this.agentWorking) {
      this.activeTurnTimeline?.setActivity(undefined)
      return
    }
    this.agentWorking = false
    this.updateWorkingIndicator()
    this.ui.requestRender()
  }

  stop(): void {
    if (this.activeBashProcess) {
      this.cancelBashCommand()
    }
    if (this.toolElapsedTimer) {
      clearInterval(this.toolElapsedTimer)
      this.toolElapsedTimer = undefined
    }
    if (this.workingTimer) {
      clearInterval(this.workingTimer)
      this.workingTimer = undefined
    }
    if (this.workingText) {
      this.workingContainer.removeChild(this.workingText)
      this.workingText = null
    }
    this.ui.stop()
  }

  private isAgentBusy(): boolean {
    return this.agent.isBusy()
  }

  private exit(): void {
    this.stop()
    if (this.onExit) {
      this.onExit()
    } else {
      process.exit(0)
    }
  }
}
