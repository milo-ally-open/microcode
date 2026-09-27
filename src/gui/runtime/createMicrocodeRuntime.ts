import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import { type Api, type AuthPrompt, type ImageContent, type Model } from '@earendil-works/pi-ai'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createMicrocodeAgentRuntime, type MicrocodeAgent, type MicrocodeAgentEvent } from '../../agent/index.ts'
import { getAllModels, getCustomModelDefs, getModels, resetCustomModelCache, resolveApiKey } from '../../models/index.ts'
import { McpClientManager } from '../../mcp/client.ts'
import { loadMcpConfig, isMcpConfigEmpty } from '../../mcp/config.ts'
import { mergeProjectMcpServers, mergeProjectModels } from '../../config/projectConfigWrite.ts'
import { SessionManager, type SessionListItem } from '../../session/SessionManager.ts'
import { GitWorkTreeSystem } from '../../git/index.ts'
import { createGitWorkTreeTool } from '../../tools/index.ts'
import { TOOL_NAME as WRITE_TOOL_NAME } from '../../tools/FileWriteTool/FileWriteTool.ts'
import { TOOL_NAME as EDIT_TOOL_NAME } from '../../tools/FileEditTool/FileEditTool.ts'
import { TOOL_NAME as TASK_TOOL_NAME } from '../../tools/TaskTool/TaskTool.ts'
import { type PermissionMode } from '../../permissions/index.ts'
import {
  collectImagePathsFromText,
  stripImagePathsFromText,
  tryReadImageFromPath,
  storeImage,
  cleanupImageCache,
} from '../../utils/imageUtils.ts'
import { modelSupportsImages } from '../../models/index.ts'
import {
  formatToolActivity,
  formatToolSummary,
  formatToolStatus,
  type ToolResult,
} from '../../tools/registry.ts'
import type {
  GuiChatItem,
  GuiCommandItem,
  GuiCompactionItem,
  GuiIpcEvent,
  GuiApiConfigInput,
  GuiModelListItem,
  GuiModelTokenUsage,
  GuiMessageBlock,
  GuiPermissionDecision,
  GuiPermissionRequest,
  GuiQuestion,
  GuiQuestionRequest,
  GuiRuntimeSnapshot,
  GuiSessionListItem,
  GuiSkillListItem,
  GuiToolItem,
} from '../shared/types.ts'

interface CreateMicrocodeRuntimeOptions {
  cwd?: string
  resume?: boolean
  resumeSessionId?: string
  modelId?: string
  permissionMode?: PermissionMode
  thinkingLevel?: ThinkingLevel
}

type RuntimeListener = (event: GuiIpcEvent) => void

interface PendingPermission {
  request: GuiPermissionRequest
  resolve: (allowed: boolean) => void
  ruleContent?: string
}

interface PendingQuestion {
  request: GuiQuestionRequest
  resolve: (result: { answers?: Record<string, string>; block?: boolean }) => void
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const GUI_API_CONFIG_PATH = join(homedir(), '.microcode', 'gui-api.json')
const GUI_API_ENV_KEYS = [
  'API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'BASE_URL',
  'OPENAI_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'GEMINI_BASE_URL',
] as const
const GUI_SECRET_ENV_KEYS = ['API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] as const
const GUI_BASE_URL_ENV_KEYS = ['BASE_URL', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'GEMINI_BASE_URL'] as const

function loadGuiApiEnv(): Record<string, string> {
  try {
    if (!existsSync(GUI_API_CONFIG_PATH)) return {}
    const parsed = JSON.parse(readFileSync(GUI_API_CONFIG_PATH, 'utf8')) as { env?: Record<string, string> }
    for (const key of GUI_API_ENV_KEYS) {
      const value = parsed.env?.[key]
      if (typeof value === 'string' && value) process.env[key] = value
    }
    return parsed.env ?? {}
  } catch { return {} }
}

function saveGuiApiEnv(): void {
  const env: Record<string, string> = {}
  for (const key of GUI_BASE_URL_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!
  }
  mkdirSync(join(homedir(), '.microcode'), { recursive: true })
  writeFileSync(GUI_API_CONFIG_PATH, JSON.stringify({ env }, null, 2), 'utf8')
}

function getTextFromToolResult(result?: ToolResult): string {
  if (!result?.content) return ''
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
}

function formatToolStatusSafe(
  toolName: string,
  input: Record<string, unknown>,
  details?: Record<string, unknown>,
): string | undefined {
  try {
    return formatToolStatus(toolName, input, details)
  } catch {
    return undefined
  }
}

function formatToolSummarySafe(
  toolName: string,
  result: ToolResult,
  input: Record<string, unknown>,
): string | undefined {
  try {
    return formatToolSummary(toolName, result, input)
  } catch {
    return undefined
  }
}

export function sanitizeAssistantDisplayText(text: string): string {
  let cleaned = text.replace(/<agent-results\b[^>]*>[\s\S]*?<\/agent-results>/gi, '').trim()
  if (!cleaned) cleaned = text.trim()

  if (/^task-[^\s]+\s+agent-[^\s]+\s+(completed|blocked|failed|cancelled|interrupted)\b/i.test(cleaned)) {
    const horizontalRule = cleaned.match(/\n\s*-{3,}\s*\n/)
    if (horizontalRule?.index !== undefined) {
      cleaned = cleaned.slice(horizontalRule.index + horizontalRule[0].length).trim()
    } else {
      const heading = cleaned.match(/\n\s{0,3}#{1,6}\s+\S/)
      if (heading?.index !== undefined) {
        cleaned = cleaned.slice(heading.index).trim()
      }
    }
  }

  return cleaned
}

function extractMessageBlocks(message: AgentMessage): GuiMessageBlock[] {
  const content = (message as any).content
  const sanitizeText = (value: string) =>
    message.role === 'assistant' ? sanitizeAssistantDisplayText(value) : value
  if (typeof content === 'string') {
    const text = sanitizeText(content)
    return text ? [{ type: 'text', text }] : []
  }
  if (!Array.isArray(content)) {
    return []
  }
  const blocks: GuiMessageBlock[] = []
  for (const block of content) {
    if (block?.type === 'text') {
      const text = sanitizeText(String(block.text ?? ''))
      if (text) blocks.push({ type: 'text', text })
    } else if (block?.type === 'thinking') {
      blocks.push({ type: 'thinking', thinking: String(block.thinking ?? '') })
    } else if (block?.type === 'image' || block?.type === 'image_url') {
      blocks.push({ type: 'image', label: block.fileName ?? block.name ?? 'image' })
    }
  }
  return blocks
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function extractToolCalls(message: AgentMessage): Array<{
  id: string
  name: string
  args: Record<string, unknown>
}> {
  if (message.role !== 'assistant') return []
  const content = (message as any).content
  if (!Array.isArray(content)) return []
  const calls = []
  for (const block of content) {
    if (block?.type !== 'toolCall') continue
    const id = typeof block.id === 'string' ? block.id : ''
    const name = typeof block.name === 'string' ? block.name : ''
    if (!id || !name) continue
    calls.push({
      id,
      name,
      args: asRecord(block.arguments),
    })
  }
  return calls
}

export function extractStreamingToolCalls(
  message: AgentMessage,
  fallbackPrefix = 'streaming-tool',
): Array<{
  id: string
  actualId?: string
  fallbackId: string
  name: string
  args: Record<string, unknown>
}> {
  if (message.role !== 'assistant') return []
  const content = (message as any).content
  if (!Array.isArray(content)) return []
  const calls = []
  for (let index = 0; index < content.length; index++) {
    const block = content[index]
    if (block?.type !== 'toolCall') continue
    const actualId = typeof block.id === 'string' && block.id ? block.id : undefined
    const fallbackId = `${fallbackPrefix}-${index}`
    const name = typeof block.name === 'string' && block.name ? block.name : 'tool'
    calls.push({
      id: actualId ?? fallbackId,
      actualId,
      fallbackId,
      name,
      args: getToolCallArgs(block),
    })
  }
  return calls
}

function getToolCallArgs(block: Record<string, unknown>): Record<string, unknown> {
  const args = asRecord(block.arguments)
  if (Object.keys(args).length > 0) return args

  const partial = typeof block.partialArgs === 'string'
    ? block.partialArgs
    : typeof block.partialJson === 'string'
      ? block.partialJson
      : undefined
  if (!partial) return {}

  try {
    return asRecord(JSON.parse(partial))
  } catch {
    return {}
  }
}

function createRestoredToolItem(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  startedAt?: number,
): GuiToolItem {
  return {
    id: makeId('tool'),
    kind: 'tool',
    toolCallId,
    toolName,
    args,
    status: 'pending',
    statusText: formatToolStatusSafe(toolName, args),
    startedAt,
  }
}

function countStreamingLines(content: string): number {
  if (!content) return 0
  let lines = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++
  }
  return content.endsWith('\n') ? lines - 1 : lines
}

export function getStreamingToolDetails(
  toolName: string,
  args: Record<string, unknown>,
  cwd = process.cwd(),
): Record<string, unknown> | undefined {
  if (toolName === WRITE_TOOL_NAME) {
    const filePath = typeof args.file_path === 'string' ? args.file_path : ''
    const content = typeof args.content === 'string' ? args.content : ''
    const resolvedPath = filePath
      ? (isAbsolute(filePath) ? filePath : resolve(cwd, filePath))
      : ''
    return {
      path: resolvedPath || filePath,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
      additions: countStreamingLines(content),
      removals: 0,
      isNewFile: resolvedPath ? !existsSync(resolvedPath) : false,
      preview: content.slice(0, 4000),
      phase: 'preparing',
    }
  }

  if (toolName === EDIT_TOOL_NAME) {
    const oldString = typeof args.old_string === 'string' ? args.old_string : ''
    const newString = typeof args.new_string === 'string' ? args.new_string : ''
    return {
      path: typeof args.file_path === 'string' ? args.file_path : '',
      additions: countStreamingLines(newString),
      removals: countStreamingLines(oldString),
      replacements: args.replace_all === true ? 0 : 1,
      phase: 'preparing',
    }
  }

  return undefined
}

export function restoreGuiTimelineFromMessages(messages: readonly AgentMessage[]): GuiChatItem[] {
  const timeline: GuiChatItem[] = []
  const pendingTools = new Map<string, GuiToolItem>()

  for (const message of messages) {
    if ((message as any).display === false) continue

    if (message.role === 'user' || message.role === 'assistant') {
      timeline.push({
        id: makeId(message.role),
        kind: 'message',
        role: message.role,
        blocks: extractMessageBlocks(message),
        createdAt: (message as any).timestamp ?? Date.now(),
      })

      for (const toolCall of extractToolCalls(message)) {
        const item = createRestoredToolItem(
          toolCall.id,
          toolCall.name,
          toolCall.args,
          (message as any).timestamp,
        )
        pendingTools.set(toolCall.id, item)
        timeline.push(item)
      }
      continue
    }

    if (message.role === 'toolResult') {
      const toolCallId = String((message as any).toolCallId ?? '')
      if (!toolCallId) continue
      const toolName = String((message as any).toolName ?? 'tool')
      let item = pendingTools.get(toolCallId)
      if (!item) {
        item = createRestoredToolItem(toolCallId, toolName, {}, (message as any).timestamp)
        timeline.push(item)
      }

      const result = {
        content: Array.isArray((message as any).content) ? (message as any).content : [],
        details: asRecord((message as any).details),
        isError: Boolean((message as any).isError),
      }
      const finishedAt = (message as any).timestamp ?? Date.now()
      Object.assign(item, {
        toolName,
        status: result.isError ? 'error' : 'complete',
        finishedAt,
        output: getTextFromToolResult(result),
        statusText: formatToolStatusSafe(toolName, item.args, result.details),
        summary: formatToolSummarySafe(toolName, result, item.args),
        details: result.details,
        isError: result.isError,
      } satisfies Partial<GuiToolItem>)
      if (item.startedAt && item.finishedAt) item.elapsedMs = item.finishedAt - item.startedAt
      pendingTools.delete(toolCallId)
    }
  }

  return timeline
}

export function upsertGuiCompactionItem(
  timeline: GuiChatItem[],
  activeId: string | undefined,
  progress: Extract<MicrocodeAgentEvent, { type: 'compaction_changed' }>['progress'],
  options: { now?: number; makeId?: () => string } = {},
): string | undefined {
  const now = options.now ?? Date.now()
  let id = activeId
  let item = id
    ? timeline.find((entry): entry is GuiCompactionItem => entry.id === id && entry.kind === 'compaction')
    : undefined

  if (!item) {
    id = options.makeId?.() ?? makeId('compaction')
    item = {
      id,
      kind: 'compaction',
      phase: progress.phase,
      message: progress.message,
      progress: Math.max(0, Math.min(100, progress.progress ?? 0)),
      tokensBefore: progress.tokensBefore,
      tokensAfter: progress.tokensAfter,
      elapsedMs: progress.elapsedMs,
      processedUnits: progress.processedUnits,
      totalUnits: progress.totalUnits,
      createdAt: now,
      updatedAt: now,
    }
    timeline.push(item)
  } else {
    item.phase = progress.phase
    item.message = progress.message
    item.progress = Math.max(0, Math.min(100, progress.progress ?? item.progress))
    item.tokensBefore = progress.tokensBefore
    item.tokensAfter = progress.tokensAfter
    item.elapsedMs = progress.elapsedMs
    item.processedUnits = progress.processedUnits
    item.totalUnits = progress.totalUnits
    item.updatedAt = now
  }

  return progress.phase === 'done' ? undefined : id
}

function parseQuestions(input: Record<string, unknown>): GuiQuestion[] {
  const questions = Array.isArray(input.questions) ? input.questions : []
  return questions.map((raw) => {
    const q = raw as Record<string, unknown>
    const options = Array.isArray(q.options) ? q.options : []
    return {
      question: String(q.question ?? ''),
      header: String(q.header ?? 'Question'),
      multiSelect: Boolean(q.multiSelect),
      options: options.map((option) => {
        const opt = option as Record<string, unknown>
        return {
          label: String(opt.label ?? ''),
          description: String(opt.description ?? ''),
        }
      }),
    }
  }).filter((q) => q.question && q.options.length > 0)
}

function normalizeSession(meta: SessionListItem): GuiSessionListItem {
  return {
    id: meta.id,
    cwd: meta.cwd,
    createdAt: (meta as any).createdAt,
    updatedAt: (meta as any).updatedAt,
    title: meta.title,
  }
}

const LIVE_FILE_TOOL_MIN_MS = 350
const LIVE_FILE_TOOL_NAMES = new Set(['write', 'edit'])

export class MicrocodeRuntime {
  readonly agent: MicrocodeAgent
  readonly sessionManager: SessionManager
  readonly mcpClient: McpClientManager
  private readonly cwd: string
  private readonly timeline: GuiChatItem[] = []
  private readonly listeners = new Set<RuntimeListener>()
  private streamingMessageId?: string
  private pendingAssistantMessageId?: string
  private pendingTools = new Map<string, GuiToolItem>()
  private lastToolUpdateAt = new Map<string, number>()
  private activeCompactionItemId?: string
  private completionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private streamingToolAliases = new Map<string, string>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private mcpServers = [] as ReturnType<McpClientManager['getServerStates']>
  private sessions: GuiSessionListItem[] = []
  private tasks: Awaited<ReturnType<SessionManager['listTaskLists']>> = []
  private authStatus = new Map<string, string>()
  private titleGenerated = false
  private started = false
  private disposed = false

  private constructor(options: {
    cwd: string
    agent: MicrocodeAgent
    sessionManager: SessionManager
    mcpClient: McpClientManager
  }) {
    this.cwd = options.cwd
    this.agent = options.agent
    this.sessionManager = options.sessionManager
    this.mcpClient = options.mcpClient
  }

  static async create(options: CreateMicrocodeRuntimeOptions = {}): Promise<MicrocodeRuntime> {
    const originalEnv = Object.fromEntries(GUI_API_ENV_KEYS.map((key) => [key, process.env[key]]))
    const persistedEnv = loadGuiApiEnv()
    const persistedSecrets = GUI_SECRET_ENV_KEYS.filter((key) => persistedEnv[key])
    for (const key of persistedSecrets) {
      const providerId = key === 'API_KEY'
        ? getAllModels().find((model) => model.id === (process.env.MODEL ?? 'deepseek-v4-pro'))?.provider ?? 'openai'
        : ({ OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic', GEMINI_API_KEY: 'google' } as Record<string, string>)[key]
      await getModels().login(providerId, 'api_key', {
        prompt: async () => persistedEnv[key]!,
        notify: () => undefined,
      })
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
    if (persistedSecrets.length > 0) saveGuiApiEnv()
    const cwd = options.cwd ?? process.cwd()
    const sessionManager = new SessionManager()
    let restoredMessages: AgentMessage[] | null = null

    if (options.resume) {
      let targetSession = null
      if (options.resumeSessionId) {
        const sessions = await sessionManager.list()
        targetSession = sessions.find((session) => session.id.startsWith(options.resumeSessionId ?? '')) ?? null
        if (!targetSession) throw new Error(`Session not found: ${options.resumeSessionId}`)
      } else {
        targetSession = await sessionManager.getLatestSession(cwd)
      }
      if (targetSession) {
        restoredMessages = await sessionManager.open(targetSession)
      } else {
        sessionManager.beginDraft(cwd)
      }
    } else {
      sessionManager.beginDraft(cwd)
    }

    const mcpClient = new McpClientManager()
    const agent = createMicrocodeAgentRuntime({
      cwd,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel,
      permission: { mode: options.permissionMode },
      persistence: sessionManager,
      identity: {
        id: `assistant-${sessionManager.getSessionId() ?? 'session'}`,
        name: 'Microcode',
        role: 'assistant',
      },
    })
    if (restoredMessages?.length) {
      agent.replaceMessages(restoredMessages, 'rebuild')
    }

    agent.addTools([createGitWorkTreeTool(() => GitWorkTreeSystem.open(cwd))])

    const runtime = new MicrocodeRuntime({ cwd, agent, sessionManager, mcpClient })
    runtime.installHandlers()
    runtime.restoreTimelineFromMessages(agent.getMessages())
    await runtime.refreshDerivedState()
    return runtime
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const mcpConfigs = await loadMcpConfig(this.cwd)
    if (!isMcpConfigEmpty(mcpConfigs)) {
      void this.mcpClient.connectAll(mcpConfigs).then(() => {
        this.mcpServers = this.mcpClient.getServerStates()
        this.agent.updateMcpServers(this.mcpServers)
        this.emitSnapshot()
      }).catch((error) => {
        this.addNotice('error', `MCP startup failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): GuiRuntimeSnapshot {
    const sessionId = this.sessionManager.getSessionId()
    return {
      agent: this.agent.getSnapshot(),
      cwd: this.cwd,
      sessionId,
      sessionTitle: sessionId ? this.sessionManager.getTitle(sessionId) : undefined,
      mcpServers: this.mcpServers,
      tasks: this.tasks,
      busy: this.agent.isBusy(),
      activePermission: [...this.pendingPermissions.values()].at(0)?.request,
      activeQuestion: [...this.pendingQuestions.values()].at(0)?.request,
      sessions: this.sessions,
      models: this.getModelList(),
      skills: this.getSkillList(),
      config: this.getConfigSummary(),
      tokenUsageByModel: this.getTokenUsageByModel(),
    }
  }

  getTimeline(): GuiChatItem[] {
    return [...this.timeline]
  }

  async listSessions(): Promise<GuiSessionListItem[]> {
    const sessions = await this.sessionManager.listWithTitles(this.cwd)
    return sessions.map((session) => normalizeSession({
      ...session,
      title: this.sessionManager.getTitle(session.id),
    }))
  }

  async switchSession(sessionId: string): Promise<void> {
    const sessions = await this.sessionManager.listWithTitles(this.cwd)
    const selected = sessions.find((session) => session.id === sessionId || session.id.startsWith(sessionId))
    if (!selected) throw new Error(`Session not found: ${sessionId}`)
    if (selected.id === this.sessionManager.getSessionId()) {
      this.addNotice('info', 'Already in this session.')
      return
    }
    if (this.agent.isBusy()) {
      this.addNotice('warning', '当前回复仍在进行中。请先停止或等待完成后再切换会话。')
      return
    }
    await this.agent.persistMessages()
    const messages = await this.sessionManager.switchToSession(selected)
    this.agent.replaceMessages(messages, 'rebuild')
    this.timeline.length = 0
    this.pendingTools.clear()
    this.streamingToolAliases.clear()
    this.clearToolTimers()
    this.streamingMessageId = undefined
    this.pendingAssistantMessageId = undefined
    this.titleGenerated = Boolean(selected.title)
    this.restoreTimelineFromMessages(messages)
    await this.refreshDerivedState()
    this.addNotice('success', `Loaded session: ${selected.title ?? selected.id.slice(0, 8)}`)
    this.emitTimeline()
  }

  async newSession(): Promise<void> {
    if (this.agent.isBusy()) {
      this.addNotice('warning', '当前回复仍在进行中。请先停止或等待完成后再新建会话。')
      return
    }
    await this.agent.persistMessages()
    this.sessionManager.beginDraft(this.cwd)
    this.agent.clearMessages()
    this.timeline.length = 0
    this.pendingTools.clear()
    this.streamingToolAliases.clear()
    this.clearToolTimers()
    this.streamingMessageId = undefined
    this.pendingAssistantMessageId = undefined
    this.titleGenerated = false
    await this.refreshDerivedState()
    this.addNotice('success', 'New session ready.')
    this.emitTimeline()
  }

  async prompt(input: { text: string; imagePaths?: string[] }): Promise<void> {
    const text = input.text
    const paths = input.imagePaths?.length ? input.imagePaths : collectImagePathsFromText(text)
    const cleanText = stripImagePathsFromText(text)
    const images: ImageContent[] = []

    if (!cleanText.trim() && paths.length === 0) return
    if (cleanText.trim()) {
      await this.sessionManager.ensureCreated(this.cwd)
    }

    if (paths.length > 0) {
      if (!modelSupportsImages(this.agent.getCurrentModel())) {
        this.addNotice('warning', 'Current model does not support image input. Switch to a vision-capable model.')
      } else {
        for (const filePath of paths) {
          const image = tryReadImageFromPath(filePath)
          if (!image) continue
          await this.sessionManager.ensureCreated(this.cwd)
          const sessionId = this.sessionManager.getSessionId() ?? 'unknown'
          const { fileName } = storeImage(image.data, image.mimeType, sessionId)
          images.push({ type: 'image', data: image.data, mimeType: image.mimeType } as ImageContent)
          this.addNotice('info', `Attached image: ${fileName}`)
        }
      }
    }

    if (!cleanText.trim() && images.length === 0) return
    this.timeline.push({
      id: makeId('user'),
      kind: 'message',
      role: 'user',
      blocks: [
        ...(cleanText ? [{ type: 'text' as const, text: cleanText }] : []),
        ...images.map((_, index) => ({ type: 'image' as const, label: `image ${index + 1}` })),
      ],
      createdAt: Date.now(),
    })
    void this.ensureSessionTitle(cleanText)
    const thinkingId = makeId('assistant')
    this.pendingAssistantMessageId = thinkingId
    this.streamingMessageId = thinkingId
    this.timeline.push({
      id: thinkingId,
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: '正在思考...' }],
      streaming: true,
      createdAt: Date.now(),
    })
    this.emitTimeline()
    try {
      await this.agent.prompt(cleanText, images)
    } catch (error) {
      this.finishPendingAssistantError(error instanceof Error ? error.message : String(error))
      this.addNotice('error', error instanceof Error ? error.message : String(error))
    } finally {
      this.emitSnapshot()
    }
  }

  async command(command: string): Promise<void> {
    const [name = '', ...rest] = command.trim().split(/\s+/)
    const args = rest.join(' ')
    switch (name.toLowerCase()) {
      case '/clear':
        this.agent.clearMessages()
        this.timeline.length = 0
        this.pendingTools.clear()
        this.clearToolTimers()
        this.addNotice('success', 'Conversation cleared.')
        break
      case '/compact':
        try {
          await this.agent.compact({ instructions: args || undefined })
        } catch (error) {
          this.addNotice('error', error instanceof Error ? error.message : String(error))
        }
        break
      case '/status':
        this.addCommandResult('/status', 'Runtime status')
        break
      case '/login':
        if (args) {
          try { await this.loginProvider(args) }
          catch (error) { this.addNotice('error', error instanceof Error ? error.message : String(error)) }
        }
        else this.addNotice('info', 'Usage: /login <provider> [api_key|oauth]')
        break
      case '/logout':
        if (args) {
          try { await this.logoutProvider(args) }
          catch (error) { this.addNotice('error', error instanceof Error ? error.message : String(error)) }
        }
        else this.addNotice('info', 'Usage: /logout <provider>')
        break
      case '/auth':
        try { await this.showAuthStatus() }
        catch (error) { this.addNotice('error', error instanceof Error ? error.message : String(error)) }
        break
      case '/model':
        if (args) await this.setModel(args)
        else this.addCommandResult('/model', 'Models')
        break
      case '/thinking':
        if (args) await this.setThinkingLevel(args as ThinkingLevel)
        else this.addCommandResult('/thinking', 'Thinking level')
        break
      case '/permission':
        if (args) await this.setPermissionMode(args as PermissionMode)
        else this.addCommandResult('/permission', 'Permission mode')
        break
      case '/mcp':
        this.addCommandResult('/mcp', 'MCP servers')
        break
      case '/tasks':
        this.addCommandResult('/tasks', 'Tasks')
        break
      case '/session':
        this.addCommandResult('/session', 'Session')
        break
      case '/skills':
        this.addCommandResult('/skills', 'Skills')
        break
      case '/new':
        await this.newSession()
        break
      case '/help':
        this.addCommandResult('/help', 'Slash commands')
        break
      case '/exit':
        await this.shutdown()
        break
      default: {
        const skillName = name.startsWith('/') ? name.slice(1) : ''
        const skill = this.agent.getSkills().find((s: any) => s.name === skillName && !s.disableModelInvocation)
        if (skill) {
          this.agent.loadSkill(skillName)
          this.addNotice('success', `Loaded skill: ${skillName}`)
        } else {
          this.addNotice('error', `Unknown command: ${name}`)
        }
      }
    }
    this.emitSnapshot()
  }

  async abort(): Promise<void> {
    this.agent.abort()
    this.emitSnapshot()
  }

  async setModel(modelId: string): Promise<void> {
    const slash = modelId.indexOf('/')
    const provider = slash > 0 ? modelId.slice(0, slash) : undefined
    const qualifiedModelId = provider ? modelId.slice(slash + 1) : modelId
    const [id, api] = qualifiedModelId.includes('|')
      ? qualifiedModelId.split('|') as [string, Api]
      : [qualifiedModelId, undefined as Api | undefined]
    const snapshot = this.agent.switchModel(id, api, provider)
    void snapshot
    this.emitSnapshot()
  }

  async setApiConfig(input: GuiApiConfigInput): Promise<void> {
    const slash = input.modelKey.indexOf('/')
    const providerId = slash > 0 ? input.modelKey.slice(0, slash) : undefined
    const rest = providerId ? input.modelKey.slice(slash + 1) : input.modelKey
    const [id, api] = rest.includes('|')
      ? rest.split('|') as [string, Api]
      : [rest, undefined as Api | undefined]
    const model = getAllModels().find((candidate) =>
      candidate.id === id && (!providerId || candidate.provider === providerId) && (!api || candidate.api === api)
    )
    if (!model) throw new Error(`Model not found: ${input.modelKey}`)
    if (input.apiKey?.trim() && !getModels().getProvider(String(model.provider))?.auth.apiKey?.login) {
      throw new Error(`Provider ${model.provider} uses OAuth. Sign in with /login ${model.provider}.`)
    }

    const apiKeyEnv = this.getPrimaryApiKeyEnv(model)
    if (input.apiKey?.trim()) {
      await getModels().login(String(model.provider), 'api_key', {
        prompt: async () => input.apiKey!.trim(),
        notify: () => undefined,
      })
      delete process.env[apiKeyEnv]
    }

    const baseUrlEnv = this.getBaseUrlEnv(model)
    if (baseUrlEnv && input.baseUrl !== undefined) {
      if (input.baseUrl.trim()) process.env[baseUrlEnv] = input.baseUrl.trim()
      else delete process.env[baseUrlEnv]
    }

    const snapshot = this.agent.switchModel(id, api, providerId)
    void snapshot
    saveGuiApiEnv()
    await this.refreshDerivedState()
    this.emitSnapshot()
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    this.agent.setThinkingLevel(level)
    this.emitSnapshot()
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.agent.setPermissionMode(mode)
    this.emitSnapshot()
  }

  async answerPermission(requestId: string, decision: GuiPermissionDecision): Promise<void> {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return
    this.pendingPermissions.delete(requestId)
    this.clearToolPermissionWait(requestId)
    const allowed = decision === 'allow' || decision === 'allow-session'
    if (decision === 'allow-session') {
      this.agent.addSessionPermission(pending.request.toolName, pending.ruleContent)
    }
    this.updatePermissionItem(requestId, allowed ? 'allowed' : 'denied')
    pending.resolve(allowed)
    if (!allowed) this.agent.abort()
    this.emitSnapshot()
  }

  async answerQuestion(requestId: string, answers: Record<string, string>, block = false): Promise<void> {
    const pending = this.pendingQuestions.get(requestId)
    if (!pending) return
    this.pendingQuestions.delete(requestId)
    this.updatePermissionItem(requestId, block ? 'denied' : 'allowed')
    pending.resolve(block ? { block: true } : { answers })
    this.emitSnapshot()
  }

  async toggleSkill(skillName: string): Promise<void> {
    if (this.agent.isSkillLoaded(skillName)) {
      this.agent.unloadSkill(skillName)
    } else {
      this.agent.loadSkill(skillName)
    }
    this.emitSnapshot()
  }

  async remindTask(listId: string, taskId: string, reminder: boolean): Promise<void> {
    await this.sessionManager.remindTask(listId, taskId, reminder)
    await this.refreshDerivedState()
    this.emitSnapshot()
  }

  async mcpAction(action: 'enable' | 'disable' | 'reconnect', serverName: string): Promise<void> {
    if (action === 'enable') {
      if (!this.mcpClient.setServerEnabled(serverName, true)) {
        throw new Error(`MCP server "${serverName}" not found or already connected.`)
      }
    } else if (action === 'disable') {
      if (!this.mcpClient.setServerEnabled(serverName, false)) {
        throw new Error(`MCP server "${serverName}" not found.`)
      }
    } else {
      const ok = await this.mcpClient.reconnectServer(serverName)
      if (!ok) throw new Error(`Failed to reconnect MCP server: ${serverName}`)
    }
    this.mcpServers = this.mcpClient.getServerStates()
    this.agent.updateMcpServers(this.mcpServers)
    this.emitSnapshot()
  }

  async addMcpConfig(rawJson: string) {
    const result = await mergeProjectMcpServers(this.cwd, rawJson)
    await this.reloadMcpServers()
    this.emitSnapshot()
    return result
  }

  async addModelConfig(rawJson: string) {
    const result = await mergeProjectModels(this.cwd, rawJson)
    resetCustomModelCache()
    await this.refreshDerivedState()
    this.emitSnapshot()
    return result
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearToolTimers()
    try {
      await this.agent.persistMessages()
    } catch {}
    await this.sessionManager.close()
      await this.mcpClient.disconnectAll()
    cleanupImageCache(this.sessionManager.getSessionId() ?? '')
  }

  private async refreshDerivedState(): Promise<void> {
    this.sessions = await this.listSessions()
    this.mcpServers = this.mcpClient.getServerStates()
    try {
      this.tasks = await this.sessionManager.listTaskLists()
    } catch {
      this.tasks = []
    }
    const providers = getModels().getProviders()
    const statuses = await Promise.all(providers.map(async (provider) => {
      try {
        const auth = await getModels().checkAuth(provider.id)
        return [provider.id, auth ? `${auth.type}${auth.source ? ` · ${auth.source}` : ''}` : 'not configured'] as const
      } catch (error) {
        return [provider.id, `error · ${error instanceof Error ? error.message : String(error)}`] as const
      }
    }))
    this.authStatus = new Map(statuses)
  }

  private async loginProvider(input: string): Promise<void> {
    const [providerId, requestedType] = input.trim().split(/\s+/, 2)
    const provider = getModels().getProvider(providerId)
    if (!provider) throw new Error(`Unknown provider "${providerId}". Use /auth to list providers.`)
    const supportsOAuth = Boolean(provider.auth.oauth)
    const type = requestedType === 'oauth' ? 'oauth' : requestedType === 'api_key' ? 'api_key' : supportsOAuth ? 'oauth' : 'api_key'
    if (type === 'oauth' && !supportsOAuth) throw new Error(`Provider ${providerId} does not support OAuth login.`)
    const electron = await import('electron')
    const window = electron.BrowserWindow.getAllWindows()[0]
    await getModels().login(providerId, type, {
      prompt: async (prompt: AuthPrompt) => {
        if (providerId === 'openai-codex' && prompt.type === 'manual_code') {
          this.addNotice('info', 'Waiting for the OpenAI browser callback. Microcode will continue automatically. If the browser cannot return, cancel and choose device code login.')
          return await new Promise<string>((_resolve, reject) => {
            const onAbort = () => reject(new Error('Authentication prompt cancelled.'))
            if (prompt.signal?.aborted) return onAbort()
            prompt.signal?.addEventListener('abort', onAbort, { once: true })
          })
        }
        const options = prompt.type === 'select'
          ? `\n${prompt.options.map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''} [${option.id}]`).join('\n')}\nEnter the option id or number.`
          : ''
        const placeholder = 'placeholder' in prompt ? prompt.placeholder ?? '' : ''
        const value = await window?.webContents.executeJavaScript(
          `window.prompt(${JSON.stringify(`${prompt.message}${options}`)}, ${JSON.stringify(placeholder)})`,
        )
        if (typeof value !== 'string' || !value.trim()) throw new Error('Authentication cancelled.')
        if (prompt.type === 'select') {
          const selected = prompt.options.find((option) => option.id === value.trim())
            ?? prompt.options[Number(value.trim()) - 1]
          if (!selected) throw new Error('Invalid selection.')
          return selected.id
        }
        return value.trim()
      },
      notify: (event) => {
        if (event.type === 'auth_url') {
          if (window) void electron.shell.openExternal(event.url)
          this.addNotice('info', event.instructions ? `${event.instructions} ${event.url}` : `Opening ${event.url}`)
        } else if (event.type === 'device_code') {
          const message = `Code: ${event.userCode}\nOpen: ${event.verificationUri}`
          if (window) void window.webContents.executeJavaScript(`window.alert(${JSON.stringify(message)})`)
          this.addNotice('info', message)
        } else if (event.type === 'info' || event.type === 'progress') {
          this.addNotice('info', event.message)
        }
      },
    })
    await this.refreshDerivedState()
    this.emitSnapshot()
    this.addNotice('success', providerId === 'openai-codex'
      ? 'Signed in to OpenAI Codex. Select a Codex model to start chatting.'
      : `Signed in to ${provider.name}.`)
  }

  private async logoutProvider(input: string): Promise<void> {
    const providerId = input.trim()
    const provider = getModels().getProvider(providerId)
    if (!provider) throw new Error(`Unknown provider "${providerId}".`)
    await getModels().logout(providerId)
    await this.refreshDerivedState()
    this.emitSnapshot()
    this.addNotice('success', `Signed out of ${provider.name}.`)
  }

  private async showAuthStatus(): Promise<void> {
    await this.refreshDerivedState()
    const lines = getModels().getProviders().map((provider) => `${provider.id}: ${this.authStatus.get(provider.id) ?? 'not configured'}`)
    this.addNotice('info', lines.join('\n'))
  }

  private async reloadMcpServers(): Promise<void> {
    await this.mcpClient.disconnectAll()
    const mcpConfigs = await loadMcpConfig(this.cwd)
    if (!isMcpConfigEmpty(mcpConfigs)) {
      await this.mcpClient.connectAll(mcpConfigs)
    }
    this.mcpServers = this.mcpClient.getServerStates()
    this.agent.configureMcpTools(this.mcpClient)
    this.agent.updateMcpServers(this.mcpServers)
  }

  private getModelList(): GuiModelListItem[] {
    const current = this.agent.getCurrentModel()
    const customIds = new Set(getCustomModelDefs().map((model) => model.id))
    return getAllModels().map((model) => {
      const apiKeyEnv = this.getApiKeyEnv(model)
      return {
        id: model.id,
        name: model.name ?? model.id,
        api: model.api,
        provider: model.provider,
        baseUrl: model.baseUrl,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning === true,
        vision: model.input.includes('image'),
        custom: customIds.has(model.id) || model.provider === 'custom',
        current: model.id === current.id && model.api === current.api && model.provider === current.provider,
        apiKeyEnv,
        apiKeyConfigured: this.authStatus.has(model.provider)
          ? this.authStatus.get(model.provider) !== 'not configured' && !this.authStatus.get(model.provider)?.startsWith('error')
          : Boolean(resolveApiKey(model)),
        authStatus: this.authStatus.get(model.provider) ?? (resolveApiKey(model) ? 'api_key · environment' : 'not configured'),
        apiKeyLogin: Boolean(getModels().getProvider(String(model.provider))?.auth.apiKey?.login),
        oauthLogin: Boolean(getModels().getProvider(String(model.provider))?.auth.oauth),
      }
    })
  }

  private getTokenUsageByModel(): GuiModelTokenUsage[] {
    const merged = new Map<string, GuiModelTokenUsage>()
    const stats = this.agent.getTokenStats()
    for (const [key, usage] of Object.entries(stats.byModel)) {
      merged.set(key, { ...usage })
    }
    return [...merged.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }

  private getApiKeyEnv(model: Model<Api>): string {
    const provider = getModels().getProvider(String(model.provider))
    if (provider?.auth.oauth && !provider.auth.apiKey?.login) return `OAuth (/login ${provider.id})`
    const customEnv = (model as any).apiKeyEnv as string | undefined
    if (customEnv) return customEnv
    if (model.api === 'openai-completions') return 'OPENAI_API_KEY or API_KEY'
    if (model.api === 'anthropic-messages') return 'ANTHROPIC_API_KEY or API_KEY'
    if (model.api === 'google-generative-ai') return 'GEMINI_API_KEY or API_KEY'
    return 'API_KEY'
  }

  private getPrimaryApiKeyEnv(model: Model<Api>): string {
    const customEnv = (model as any).apiKeyEnv as string | undefined
    if (customEnv) return customEnv
    if (model.api === 'openai-completions') return 'OPENAI_API_KEY'
    if (model.api === 'anthropic-messages') return 'ANTHROPIC_API_KEY'
    if (model.api === 'google-generative-ai') return 'GEMINI_API_KEY'
    return 'API_KEY'
  }

  private getBaseUrlEnv(model: Model<Api>): string | undefined {
    if (model.provider === 'custom') return undefined
    if (model.api === 'openai-completions') return 'OPENAI_BASE_URL'
    if (model.api === 'anthropic-messages') return 'ANTHROPIC_BASE_URL'
    if (model.api === 'google-generative-ai') return 'GEMINI_BASE_URL'
    return 'BASE_URL'
  }

  private getSkillList(): GuiSkillListItem[] {
    return this.agent.getSkillSnapshot().available.map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      loaded: this.agent.isSkillLoaded(skill.name),
      disabled: skill.disableModelInvocation === true,
    }))
  }

  private getConfigSummary() {
    return {
      userConfigPath: join(homedir(), '.microcode', 'config.json'),
      projectConfigPath: join(this.cwd, '.microcode', 'config.json'),
      modelEnv: {
        API_KEY: Boolean(process.env.API_KEY),
        OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
        ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
        GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
        BASE_URL: Boolean(process.env.BASE_URL),
        OPENAI_BASE_URL: Boolean(process.env.OPENAI_BASE_URL),
        ANTHROPIC_BASE_URL: Boolean(process.env.ANTHROPIC_BASE_URL),
        GEMINI_BASE_URL: Boolean(process.env.GEMINI_BASE_URL),
        MODEL: Boolean(process.env.MODEL),
      },
    }
  }

  private async ensureSessionTitle(text: string): Promise<void> {
    if (this.titleGenerated) return
    const sessionId = this.sessionManager.getSessionId()
    if (!sessionId || this.sessionManager.getTitle(sessionId)) {
      this.titleGenerated = true
      return
    }
    const cleanText = text.trim().replace(/\s+/g, ' ')
    if (!cleanText) return

    this.titleGenerated = true
    const fallbackTitle = cleanText.length > 60 ? `${cleanText.slice(0, 57)}...` : cleanText
    let title = fallbackTitle

    try {
      const model = this.agent.getCurrentModel()
      const result = await getModels().completeSimple(model, {
        systemPrompt: 'Generate a short, concise title (5 words max) for a conversation. Reply with ONLY the title, no quotes, no explanation.',
        messages: [{ role: 'user', content: [{ type: 'text', text: `Generate a title for a conversation that starts with: "${cleanText.slice(0, 200)}"` }] }],
      } as any, { maxTokens: 30, temperature: 0.3 })

      const titleContent = result.content.find((c: any) => c.type === 'text') as any
      if (titleContent?.text) {
        title = titleContent.text.trim().replace(/^["']|["']$/g, '')
      }
    } catch {
      // Fall back to the user's first message.
    }

    this.sessionManager.setTitle(sessionId, title.length > 60 ? `${title.slice(0, 57)}...` : title)
    await this.refreshDerivedState()
    this.emitSnapshot()
  }

  private installHandlers(): void {
    this.agent.setPermissionRequestHandler((toolName, input, description) =>
      this.requestPermission('tool', toolName, input, description),
    )
    this.agent.setAskUserQuestionHandler((toolName, input) =>
      this.requestQuestion(toolName, input),
    )
    this.agent.subscribe((event) => this.handleAgentEvent(event))
  }

  private handleAgentEvent(event: MicrocodeAgentEvent): void {
    switch (event.type) {
      case 'message_start':
        if (event.message.role === 'assistant') {
          const id = this.pendingAssistantMessageId ?? makeId('assistant')
          this.streamingMessageId = id
          const existing = this.timeline.find((entry) => entry.id === id)
          if (existing?.kind === 'message') {
            existing.blocks = extractMessageBlocks(event.message)
            existing.streaming = true
          } else {
            this.timeline.push({
              id,
              kind: 'message',
              role: 'assistant',
              blocks: extractMessageBlocks(event.message),
              streaming: true,
              createdAt: Date.now(),
            })
          }
          this.updateStreamingToolCalls(event.message)
          this.emitTimeline()
        }
        break
      case 'message_update':
        if (event.message.role === 'assistant') {
          this.updateStreamingMessage(event.message)
          this.updateStreamingToolCalls(event.message)
          this.emitTimeline()
        }
        break
      case 'message_end':
        if (event.message.role === 'assistant') {
          this.updateStreamingMessage(event.message, false)
          this.updateStreamingToolCalls(event.message)
          this.streamingMessageId = undefined
          this.pendingAssistantMessageId = undefined
          this.emitTimeline()
        }
        break
      case 'turn_end':
        if (event.message.role === 'assistant' && event.message.stopReason === 'aborted') {
          this.addNotice('warning', 'Interrupted.')
        } else if (event.message.role === 'assistant' && event.message.stopReason === 'error') {
          this.addNotice('error', event.message.errorMessage || 'Unknown model error')
        }
        void this.agent.persistMessages()
        break
      case 'tool_execution_start':
        this.upsertTool(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args ?? {},
          status: 'running',
          statusText: formatToolStatusSafe(event.toolName, event.args ?? {}),
          startedAt: Date.now(),
        })
        break
      case 'tool_execution_update':
        this.lastToolUpdateAt.set(event.toolCallId, Date.now())
        this.updateTool(event.toolCallId, {
          status: 'running',
          statusText: formatToolStatusSafe(event.toolName, event.args ?? {}, event.partialResult.details),
          output: getTextFromToolResult({ ...event.partialResult, isError: false }),
          details: event.partialResult.details,
        })
        break
      case 'tool_execution_end':
        const toolInput = this.pendingTools.get(event.toolCallId)?.args ?? {}
        this.completeTool(event.toolCallId, event.toolName, {
          status: event.isError ? 'error' : 'complete',
          finishedAt: Date.now(),
          output: getTextFromToolResult({ ...event.result, isError: event.isError }),
          statusText: formatToolStatusSafe(event.toolName, toolInput, event.result.details),
          summary: formatToolSummarySafe(event.toolName, { ...event.result, isError: event.isError }, toolInput),
          details: event.result.details,
          isError: event.isError,
        })
        if (event.toolName === TASK_TOOL_NAME && !event.isError) {
          this.applyTaskToolResult(event.result.details)
          void this.refreshDerivedState().then(() => this.emitSnapshot())
        }
        break
      case 'compaction_changed':
        this.upsertCompaction(event.progress)
        break
      case 'state_changed':
      case 'token_usage':
      case 'permission_requested':
      case 'permission_resolved':
      case 'model_changed':
      case 'tool_started':
      case 'tool_finished':
      case 'agent_start':
      case 'agent_end':
        this.emitSnapshot()
        break
    }
  }

  private restoreTimelineFromMessages(messages: readonly AgentMessage[]): void {
    this.timeline.push(...restoreGuiTimelineFromMessages(messages))
  }

  private updateStreamingMessage(message: AgentMessage, streaming = true): void {
    const id = this.streamingMessageId
    if (!id) return
    const blocks = extractMessageBlocks(message)
    const existing = this.timeline.find((entry) => entry.id === id)
    if (!existing || existing.kind !== 'message') {
      if (blocks.length === 0) return
      this.timeline.push({
        id,
        kind: 'message',
        role: 'assistant',
        blocks,
        streaming,
        stopReason: (message as any).stopReason,
        errorMessage: (message as any).errorMessage,
        createdAt: Date.now(),
      })
      return
    }
    existing.blocks = blocks
    existing.streaming = streaming
    existing.stopReason = (message as any).stopReason
    existing.errorMessage = (message as any).errorMessage
    if (!streaming && blocks.length === 0 && !existing.errorMessage) {
      this.removeAssistantLoadingPlaceholder(id)
    }
  }

  private removeAssistantLoadingPlaceholder(id = this.streamingMessageId ?? this.pendingAssistantMessageId): void {
    if (!id) return
    const index = this.timeline.findIndex((entry) => entry.id === id)
    const item = this.timeline[index]
    if (!item || item.kind !== 'message' || item.role !== 'assistant') return
    const isPlaceholder =
      item.blocks.length === 0 ||
      (
        item.blocks.length === 1 &&
        item.blocks[0]?.type === 'text' &&
        item.blocks[0].text === '正在思考...'
      )
    if (isPlaceholder) this.timeline.splice(index, 1)
  }

  private updateStreamingToolCalls(message: AgentMessage): void {
    const fallbackPrefix = this.streamingMessageId ?? this.pendingAssistantMessageId ?? 'assistant'
    for (const toolCall of extractStreamingToolCalls(message, fallbackPrefix)) {
      if (toolCall.actualId && toolCall.actualId !== toolCall.fallbackId) {
        this.streamingToolAliases.set(toolCall.fallbackId, toolCall.actualId)
      }

      let item = this.pendingTools.get(toolCall.id)
      const fallbackItem = toolCall.actualId ? this.pendingTools.get(toolCall.fallbackId) : undefined
      if (!item && fallbackItem) {
        item = fallbackItem
        this.pendingTools.delete(toolCall.fallbackId)
        this.pendingTools.set(toolCall.id, item)
        item.toolCallId = toolCall.id
      }

      if (!item) {
        item = {
          id: makeId('tool'),
          kind: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.args,
          status: 'pending',
          statusText: formatToolStatusSafe(toolCall.name, toolCall.args),
          startedAt: Date.now(),
        }
        this.pendingTools.set(toolCall.id, item)
        this.timeline.push(item)
      } else {
        item.toolName = toolCall.name
        item.args = toolCall.args
        item.statusText = formatToolStatusSafe(toolCall.name, toolCall.args, item.details)
      }
      this.removeAssistantLoadingPlaceholder()

      const streamingDetails = getStreamingToolDetails(toolCall.name, toolCall.args, this.cwd)
      const currentPhase = typeof item.details?.phase === 'string' ? item.details.phase : undefined
      if (streamingDetails && (item.status === 'pending' || currentPhase === 'preparing' || currentPhase === undefined)) {
        item.details = {
          ...item.details,
          ...streamingDetails,
        }
        item.statusText = formatToolStatusSafe(toolCall.name, toolCall.args, item.details)
      }
    }
  }

  private finishPendingAssistantError(message: string): void {
    const id = this.pendingAssistantMessageId
    if (!id) return
    const item = this.timeline.find((entry) => entry.id === id)
    if (item?.kind === 'message') {
      item.streaming = false
      item.errorMessage = message
      item.blocks = item.blocks.length > 0 ? item.blocks : [{ type: 'text', text: '请求失败。' }]
    }
    this.pendingAssistantMessageId = undefined
    if (this.streamingMessageId === id) this.streamingMessageId = undefined
    this.emitTimeline()
  }

  private upsertTool(toolCallId: string, patch: Omit<Partial<GuiToolItem>, 'kind' | 'id'> & { toolCallId: string; toolName: string; args: Record<string, unknown> }): void {
    let item = this.pendingTools.get(toolCallId)
    if (!item) {
      const alias = [...this.streamingToolAliases.entries()]
        .find(([, actualId]) => actualId === toolCallId)?.[0]
      if (alias) {
        item = this.pendingTools.get(alias)
        if (item) {
          this.pendingTools.delete(alias)
          this.pendingTools.set(toolCallId, item)
          item.toolCallId = toolCallId
        }
      }
    }
    if (!item) {
      const streamingMatch = [...this.pendingTools.entries()].find(([, candidate]) =>
        candidate.status === 'pending' &&
        (candidate.toolName === patch.toolName || candidate.toolName === 'tool')
      )
      if (streamingMatch) {
        const [streamingId, candidate] = streamingMatch
        this.pendingTools.delete(streamingId)
        this.streamingToolAliases.set(streamingId, toolCallId)
        item = candidate
        item.toolCallId = toolCallId
        this.pendingTools.set(toolCallId, item)
      }
    }
    if (!item) {
      item = {
        id: makeId('tool'),
        kind: 'tool',
        toolCallId,
        toolName: patch.toolName,
        args: patch.args,
        status: 'pending',
      }
      this.pendingTools.set(toolCallId, item)
      this.removeAssistantLoadingPlaceholder()
      this.timeline.push(item)
    }
    Object.assign(item, patch)
    if (item.startedAt && item.finishedAt) item.elapsedMs = item.finishedAt - item.startedAt
    this.emitTimeline()
  }

  private updateTool(toolCallId: string, patch: Partial<GuiToolItem>): void {
    const item = this.pendingTools.get(toolCallId)
    if (!item) return
    Object.assign(item, patch)
    if (item.startedAt && item.finishedAt) item.elapsedMs = item.finishedAt - item.startedAt
    if (item.status === 'complete' || item.status === 'error') {
      this.pendingTools.delete(toolCallId)
    }
    this.emitTimeline()
  }

  private completeTool(toolCallId: string, toolName: string, patch: Partial<GuiToolItem>): void {
    const existingTimer = this.completionTimers.get(toolCallId)
    if (existingTimer) clearTimeout(existingTimer)
    this.completionTimers.delete(toolCallId)

    const lastUpdateAt = this.lastToolUpdateAt.get(toolCallId)
    const elapsed = lastUpdateAt === undefined ? Number.POSITIVE_INFINITY : Date.now() - lastUpdateAt
    const remaining = LIVE_FILE_TOOL_NAMES.has(toolName)
      ? Math.max(0, LIVE_FILE_TOOL_MIN_MS - elapsed)
      : 0

    if (remaining <= 0) {
      this.updateTool(toolCallId, patch)
      this.lastToolUpdateAt.delete(toolCallId)
      return
    }

    const timer = setTimeout(() => {
      this.completionTimers.delete(toolCallId)
      this.updateTool(toolCallId, patch)
      this.lastToolUpdateAt.delete(toolCallId)
    }, remaining)
    this.completionTimers.set(toolCallId, timer)
  }

  private clearToolTimers(): void {
    for (const timer of this.completionTimers.values()) clearTimeout(timer)
    this.completionTimers.clear()
    this.lastToolUpdateAt.clear()
  }

  private applyTaskToolResult(details: unknown): void {
    const list = (details as { list?: unknown } | undefined)?.list
    if (!list || typeof list !== 'object') return
    const taskList = list as Awaited<ReturnType<SessionManager['listTaskLists']>>[number]
    if (typeof taskList.id !== 'string' || !Array.isArray(taskList.tasks)) return
    const index = this.tasks.findIndex((candidate) => candidate.id === taskList.id)
    if (index === -1) {
      this.tasks = [taskList, ...this.tasks]
    } else {
      this.tasks = [
        ...this.tasks.slice(0, index),
        taskList,
        ...this.tasks.slice(index + 1),
      ]
    }
    this.emitSnapshot()
  }

  private requestPermission(
    kind: 'tool',
    toolName: string,
    input: Record<string, unknown>,
    description: string,
  ): Promise<boolean> {
    const request: GuiPermissionRequest = {
      id: makeId('permission'),
      kind,
      toolName,
      input,
      description,
    }
    this.timeline.push({
      id: makeId('permission-item'),
      kind: 'permission',
      requestId: request.id,
      requestKind: kind,
      toolName,
      input,
      description,
      status: 'pending',
      createdAt: Date.now(),
    })
    this.markToolWaitingForPermission(toolName, request.id)
    this.emitTimeline()
    this.emitSnapshot()
    return new Promise((resolve) => {
      this.pendingPermissions.set(request.id, {
        request,
        resolve,
        ruleContent: this.extractRuleContent(toolName, input),
      })
      this.emitSnapshot()
    })
  }

  private requestQuestion(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ answers?: Record<string, string>; block?: boolean }> {
    const request: GuiQuestionRequest = {
      id: makeId('question'),
      toolName,
      input,
      questions: parseQuestions(input),
    }
    this.timeline.push({
      id: makeId('question-item'),
      kind: 'permission',
      requestId: request.id,
      requestKind: 'question',
      toolName,
      input,
      description: request.questions.map((q) => q.question).join(' '),
      status: 'pending',
      createdAt: Date.now(),
    })
    this.emitTimeline()
    return new Promise((resolve) => {
      this.pendingQuestions.set(request.id, { request, resolve })
      this.emitSnapshot()
    })
  }

  private updatePermissionItem(requestId: string, status: 'allowed' | 'denied'): void {
    const item = this.timeline.find((entry) => entry.kind === 'permission' && entry.requestId === requestId)
    if (item?.kind === 'permission') item.status = status
    this.emitTimeline()
  }

  private markToolWaitingForPermission(toolName: string, requestId: string): void {
    for (let index = this.timeline.length - 1; index >= 0; index--) {
      const item = this.timeline[index]
      if (item.kind !== 'tool') continue
      if (item.toolName !== toolName || item.status !== 'running') continue
      item.waitingForPermission = true
      item.permissionRequestId = requestId
      item.statusText = 'Waiting for permission'
      break
    }
  }

  private clearToolPermissionWait(requestId: string): void {
    for (const item of this.timeline) {
      if (item.kind !== 'tool' || item.permissionRequestId !== requestId) continue
      item.waitingForPermission = false
      item.permissionRequestId = undefined
      if (item.status === 'running' && item.statusText === 'Waiting for permission') {
        item.statusText = 'Running...'
      }
    }
  }

  private extractRuleContent(toolName: string, input: Record<string, unknown>): string | undefined {
    try {
      return formatToolActivity(toolName, input) || formatToolStatus(toolName, input)
    } catch {
      return undefined
    }
  }

  private formatStatus(): string {
    const snapshot = this.agent.getSnapshot()
    const customs = new Set(getCustomModelDefs().map((model) => model.id))
    const custom = customs.has(snapshot.model.id) ? ' custom' : ''
    return [
      `Model: ${snapshot.model.id}${custom}`,
      `Thinking: ${snapshot.thinkingLevel}`,
      `Permission: ${snapshot.permission.mode}`,
      `Messages: ${snapshot.messageCount}`,
      `Context: ${snapshot.tokens.context.usedTokens}/${snapshot.tokens.context.contextWindow}`,
    ].join(' · ')
  }

  private addNotice(level: 'info' | 'warning' | 'error' | 'success', text: string): void {
    const item = {
      id: makeId('notice'),
      kind: 'notice' as const,
      level,
      text,
      createdAt: Date.now(),
    }
    this.timeline.push(item)
    this.emit({ type: 'notice', item })
    this.emitTimeline()
  }

  private upsertCompaction(progress: Extract<MicrocodeAgentEvent, { type: 'compaction_changed' }>['progress']): void {
    this.activeCompactionItemId = upsertGuiCompactionItem(this.timeline, this.activeCompactionItemId, progress)
    this.emitTimeline()
  }

  private addCommandResult(command: string, title: string): void {
    const item: GuiCommandItem = {
      id: makeId('command'),
      kind: 'command',
      command,
      title,
      createdAt: Date.now(),
    }
    this.timeline.push(item)
    this.emitTimeline()
  }

  private emitTimeline(): void {
    this.emit({ type: 'timeline', timeline: this.getTimeline() })
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.emit({ type: 'snapshot', snapshot: this.getSnapshot() })
  }

  private emit(event: GuiIpcEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}

export async function createMicrocodeRuntime(
  options: CreateMicrocodeRuntimeOptions = {},
): Promise<MicrocodeRuntime> {
  return MicrocodeRuntime.create(options)
}
