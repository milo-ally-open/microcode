import * as path from 'path'
import * as os from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import {
  type JsonlSessionMetadata,
  type AgentMessage,
} from '@earendil-works/pi-agent-core'
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core'
import { JsonlSessionRepo, type Session } from '@earendil-works/pi-agent-core/harness/session'
import { NodeFileSystem } from './NodeFileSystem.ts'
import { replaceImageBlocksForPersistence } from './imageSerializer.ts'
import type {
  AgentCompactionRecord,
  AgentSessionPersistence,
} from '../agent/persistence.ts'
import {
  TaskSystem,
  type TaskList,
  type TaskMarkUpdate,
  type TaskReminderUpdate,
} from '../tasks/TaskSystem.ts'
import type { AgentBatch, AgentMeta, AgentTask } from '../swarm/types.ts'

const SESSIONS_DIR = path.join(os.homedir(), '.microcode', 'sessions')
const TITLES_FILE = path.join(SESSIONS_DIR, '.titles.json')
const TASKS_DIR = path.join(SESSIONS_DIR, '.tasks')
const AGENTS_DIR = path.join(SESSIONS_DIR, '.agents')

export interface SessionListItem extends JsonlSessionMetadata {
  title?: string
}

/**
 * Manages session lifecycle: create, persist, resume, list.
 * Wraps pi-agent-core's JsonlSessionRepo and Session.
 */
export class SessionManager implements AgentSessionPersistence {
  private repo: JsonlSessionRepo
  private session: Session | null = null
  private metadata: JsonlSessionMetadata | null = null
  private draftCwd: string | null = null
  private createPromise: Promise<string> | null = null
  private savedMessageCount = 0
  private titleCache: Map<string, string> | null = null
  private readonly taskSystem: TaskSystem
  private readonly agentsRoot: string
  private readonly manifestQueues = new Map<string, Promise<void>>()

  constructor(options: { sessionsRoot?: string; tasksRoot?: string; agentsRoot?: string } = {}) {
    const fs = new NodeFileSystem('/')
    this.repo = new JsonlSessionRepo({
      fileSystem: fs,
      sessionsRoot: options.sessionsRoot ?? SESSIONS_DIR,
    })
    this.taskSystem = new TaskSystem(options.tasksRoot ?? TASKS_DIR)
    this.agentsRoot = options.agentsRoot ?? AGENTS_DIR
  }

  /**
   * Create a new session for the given working directory.
   */
  async create(cwd: string): Promise<string> {
    this.session = await this.repo.create({ cwd }, BACKGROUND_CONTEXT)
    await this.ensureMainBranch(this.session)
    this.metadata = this.session.metadata as JsonlSessionMetadata
    this.draftCwd = null
    this.savedMessageCount = 0
    return this.metadata.id
  }

  /**
   * Start a new in-memory session without writing anything to disk yet.
   */
  beginDraft(cwd: string): void {
    this.session = null
    this.metadata = null
    this.draftCwd = cwd
    this.savedMessageCount = 0
  }

  /**
   * Materialize the current draft session only when durable state is needed.
   */
  async ensureCreated(cwd?: string): Promise<string> {
    if (this.metadata?.id) return this.metadata.id
    const targetCwd = cwd ?? this.draftCwd
    if (!targetCwd) throw new Error('No active session.')
    if (!this.createPromise) {
      this.createPromise = this.create(targetCwd).finally(() => {
        this.createPromise = null
      })
    }
    return this.createPromise
  }

  isDraft(): boolean {
    return !this.metadata && Boolean(this.draftCwd)
  }

  /**
   * Resume an existing session from metadata.
   */
  async open(meta: JsonlSessionMetadata): Promise<AgentMessage[]> {
    this.session = await this.repo.open(meta, BACKGROUND_CONTEXT)
    await this.ensureMainBranch(this.session)
    this.metadata = meta
    this.draftCwd = null
    const messages = await this.readSessionMessages(this.session)
    this.savedMessageCount = messages.length
    return messages
  }

  /**
   * List available sessions, optionally filtered by cwd.
   */
  async list(cwd?: string): Promise<JsonlSessionMetadata[]> {
    return this.repo.list({ cwd }, BACKGROUND_CONTEXT)
  }

  /**
   * Get the most recent session for a given cwd, if any.
   */
  async getLatestSession(cwd: string): Promise<JsonlSessionMetadata | null> {
    const sessions = await this.list(cwd)
    return sessions[0] ?? null
  }

  /**
   * Persist new messages to the session.
   * Only appends messages that haven't been saved yet.
   */
  async saveMessages(messages: readonly AgentMessage[]): Promise<void> {
    if (!this.session) {
      if (messages.length === 0) return
      await this.ensureCreated()
    }
    if (!this.session) return

    // Append only new messages, with image blocks replaced by text references
    for (let i = this.savedMessageCount; i < messages.length; i++) {
      const serialized = replaceImageBlocksForPersistence(messages[i])
      const branch = await this.session.branch('main', BACKGROUND_CONTEXT)
      if (!branch) throw new Error('Session main branch is unavailable.')
      await branch.appendMessage(serialized, BACKGROUND_CONTEXT)
    }
    this.savedMessageCount = messages.length
  }

  async recordCompaction(record: AgentCompactionRecord): Promise<void> {
    if (!this.session) return
    const entries = await this.session.findEntries({ order: 'asc' }, BACKGROUND_CONTEXT)
    const messageEntries = entries.filter((entry) => entry.type === 'message')
    if (messageEntries.length === 0) {
      throw new Error('No persisted messages available for compaction.')
    }
    const keptCount = Math.min(record.keptMessageCount, messageEntries.length)
    const branch = await this.session.branch('main', BACKGROUND_CONTEXT)
    if (!branch) throw new Error('Session main branch is unavailable.')
    await branch.appendMessage({
      role: 'user',
      content: `[Earlier conversation summarized (${record.tokensBefore} tokens before compaction)]:\n${record.summary}`,
      timestamp: Date.now(),
    }, BACKGROUND_CONTEXT)
    this.savedMessageCount = record.compactedMessageCount
  }

  /**
   * Load all messages from the session.
   */
  async loadMessages(): Promise<AgentMessage[]> {
    if (!this.session) return []
    return this.readSessionMessages(this.session)
  }

  /**
   * Get the current session metadata.
   */
  getMetadata(): JsonlSessionMetadata | null {
    return this.metadata
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string | null {
    return this.metadata?.id ?? null
  }

  async createTaskList(title: string, tasks: readonly string[]): Promise<TaskList> {
    const sessionId = await this.ensureCreated()
    return this.taskSystem.createList(sessionId, title, tasks)
  }

  async listTaskLists(): Promise<TaskList[]> {
    const sessionId = this.getSessionId()
    if (!sessionId) return []
    return this.taskSystem.listTaskLists(sessionId)
  }

  async getTaskReminder(): Promise<string | undefined> {
    const sessionId = this.getSessionId()
    if (!sessionId) return undefined
    return this.taskSystem.getReminder(sessionId)
  }

  async claimTaskList(listId: string): Promise<TaskList> {
    return this.taskSystem.claimTaskList(await this.ensureCreated(), listId)
  }

  async remindTask(listId: string, taskId: string, reminder = true): Promise<TaskList> {
    return this.taskSystem.remindTask(await this.ensureCreated(), listId, taskId, reminder)
  }

  async remindTasks(
    listId: string,
    tasks: readonly TaskReminderUpdate[],
  ): Promise<TaskList> {
    return this.taskSystem.remindTasks(await this.ensureCreated(), listId, tasks)
  }

  async markTask(
    listId: string | undefined,
    taskId: string,
    completed: boolean,
    pending?: boolean,
  ): Promise<TaskList> {
    return this.taskSystem.markTask(
      await this.ensureCreated(),
      listId,
      taskId,
      completed,
      pending,
    )
  }

  async markTasks(input: {
    list_id?: string
    tasks: readonly TaskMarkUpdate[]
  }): Promise<TaskList> {
    return this.taskSystem.markTasks(await this.ensureCreated(), input)
  }

  private requireSessionId(): string {
    const sessionId = this.getSessionId()
    if (!sessionId) throw new Error('No active session.')
    return sessionId
  }

  async saveAgentManifest(
    tasks: readonly AgentTask[],
    batches: readonly AgentBatch[] = [],
    agentMetas: readonly AgentMeta[] = [],
  ): Promise<void> {
    if (!this.getSessionId() && tasks.length === 0 && batches.length === 0 && agentMetas.length === 0) {
      return
    }
    await this.ensureCreated()
    return this.withManifestLock(() => this.writeManifestUnsafe(tasks, batches, agentMetas))
  }

  private async writeManifestUnsafe(
    tasks: readonly AgentTask[],
    batches: readonly AgentBatch[],
    agentMetas: readonly AgentMeta[],
  ): Promise<void> {
    const dir = this.getAgentSessionDir()
    await mkdir(dir, { recursive: true })
    await this.atomicWrite(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ version: 3, tasks, batches, agentMetas }, null, 2),
    )
  }

  private withManifestLock<T>(operation: () => Promise<T>): Promise<T> {
    const key = this.requireSessionId()
    const previous = this.manifestQueues.get(key) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.manifestQueues.set(key, tail as Promise<void>)
    return result.finally(() => {
      if (this.manifestQueues.get(key) === (tail as Promise<void>)) {
        this.manifestQueues.delete(key)
      }
    })
  }

  async loadAgentManifest(): Promise<{ tasks: AgentTask[]; batches?: AgentBatch[]; agentMetas?: AgentMeta[] }> {
    if (!this.getSessionId()) return { tasks: [] }
    const file = path.join(this.getAgentSessionDir(), 'manifest.json')
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as {
        version?: number
        tasks?: AgentTask[]
        batches?: AgentBatch[]
        agentMetas?: AgentMeta[]
      }
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        batches: Array.isArray(parsed.batches) ? parsed.batches : undefined,
        agentMetas: Array.isArray(parsed.agentMetas) ? parsed.agentMetas : undefined,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { tasks: [] }
      throw error
    }
  }

  async loadAgentBatches(): Promise<AgentBatch[]> {
    if (!this.getSessionId()) return []
    const file = path.join(this.getAgentSessionDir(), 'manifest.json')
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as {
        batches?: AgentBatch[]
      }
      return Array.isArray(parsed.batches) ? parsed.batches : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async saveAgentTranscript(
    agentId: string,
    messages: readonly AgentMessage[],
  ): Promise<void> {
    await this.ensureCreated()
    if (!/^[a-zA-Z0-9._-]+$/.test(agentId)) {
      throw new Error('Invalid agent ID.')
    }
    const dir = path.join(this.getAgentSessionDir(), 'agents')
    await mkdir(dir, { recursive: true })
    const serialized = messages
      .map((message) => JSON.stringify(replaceImageBlocksForPersistence(message)))
      .join('\n')
    await this.atomicWrite(
      path.join(dir, `${agentId}.jsonl`),
      serialized ? `${serialized}\n` : '',
    )
  }

  async loadAgentTranscript(agentId: string): Promise<AgentMessage[]> {
    if (!this.getSessionId()) return []
    if (!/^[a-zA-Z0-9._-]+$/.test(agentId)) {
      throw new Error('Invalid agent ID.')
    }
    try {
      const raw = await readFile(
        path.join(this.getAgentSessionDir(), 'agents', `${agentId}.jsonl`),
        'utf8',
      )
      return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private getAgentSessionDir(): string {
    return path.join(this.agentsRoot, this.requireSessionId())
  }

  private async atomicWrite(file: string, content: string): Promise<void> {
    const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(temp, content, 'utf8')
    await rename(temp, file)
  }

  /**
   * Delete a session.
   */
  async delete(meta: JsonlSessionMetadata): Promise<void> {
    await this.repo.delete(meta, BACKGROUND_CONTEXT)
  }

  /**
   * Load the titles map from disk into cache.
   */
  private loadTitles(): void {
    if (this.titleCache) return
    try {
      if (existsSync(TITLES_FILE)) {
        const raw = readFileSync(TITLES_FILE, 'utf-8')
        const data = JSON.parse(raw)
        this.titleCache = new Map(Object.entries(data))
      } else {
        this.titleCache = new Map()
      }
    } catch {
      this.titleCache = new Map()
    }
  }

  /**
   * Save the titles cache back to disk.
   */
  private saveTitles(): void {
    try {
      const dir = path.dirname(TITLES_FILE)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const data = Object.fromEntries(this.titleCache ?? new Map())
      writeFileSync(TITLES_FILE, JSON.stringify(data, null, 2))
    } catch {}
  }

  /**
   * Set the title for a session.
   */
  setTitle(sessionId: string, title: string): void {
    this.loadTitles()
    this.titleCache!.set(sessionId, title)
    this.saveTitles()
  }

  /**
   * Get the title for a session.
   */
  getTitle(sessionId: string): string | undefined {
    this.loadTitles()
    return this.titleCache?.get(sessionId)
  }

  /**
   * List sessions enriched with titles.
   */
  async listWithTitles(cwd?: string): Promise<SessionListItem[]> {
    const sessions = await this.repo.list({ cwd }, BACKGROUND_CONTEXT)
    this.loadTitles()
    return sessions.map((s) => ({
      ...s,
      title: this.titleCache?.get(s.id),
    }))
  }

  /**
   * Switch to a different session, returning its messages.
   * The caller is responsible for persisting the current runtime first.
   */
  async switchToSession(meta: JsonlSessionMetadata): Promise<AgentMessage[]> {
    this.session = await this.repo.open(meta, BACKGROUND_CONTEXT)
    await this.ensureMainBranch(this.session)
    this.metadata = meta
    this.draftCwd = null
    const messages = await this.readSessionMessages(this.session)
    this.savedMessageCount = messages.length
    return messages
  }

  private async readSessionMessages(session: Session): Promise<AgentMessage[]> {
    const entries = await session.findEntries({ order: 'asc' }, BACKGROUND_CONTEXT)
    return entries.flatMap((entry) => {
      if (entry.type === 'message') return [entry.message]
      if (entry.type === 'compaction' || entry.type === 'branch_summary') {
        return [{ role: 'user' as const, content: `[Conversation summary]:\n${entry.summary}`, timestamp: entry.timestamp }]
      }
      return []
    })
  }

  private async ensureMainBranch(session: Session): Promise<void> {
    if (await session.branch('main', BACKGROUND_CONTEXT)) return
    await session.createBranch('main', null, BACKGROUND_CONTEXT)
  }

  async close(): Promise<void> {
    await this.repo.close(BACKGROUND_CONTEXT)
  }
}
