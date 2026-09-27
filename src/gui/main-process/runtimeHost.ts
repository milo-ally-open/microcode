import type { BrowserWindow } from 'electron'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { ensureBootstrapMacro } from '../../macro.ts'
import type { PermissionMode } from '../../permissions/index.ts'
import { createMicrocodeRuntime, type MicrocodeRuntime } from '../runtime/createMicrocodeRuntime.ts'
import type { GuiIpcEvent, GuiWorkspaceItem } from '../shared/types.ts'

export interface RuntimeStartOptions {
  cwd?: string
  resume?: boolean
  resumeSessionId?: string
  modelId?: string
  permissionMode?: PermissionMode
  thinkingLevel?: ThinkingLevel
}

let mainWindow: BrowserWindow | undefined
let runtime: MicrocodeRuntime | undefined
let unsubscribeRuntime: (() => void) | undefined

ensureBootstrapMacro()

const WORKSPACES_PATH = join(homedir(), '.microcode', 'gui-workspaces.json')

function readWorkspaceItems(): GuiWorkspaceItem[] {
  try {
    if (!existsSync(WORKSPACES_PATH)) return []
    const parsed = JSON.parse(readFileSync(WORKSPACES_PATH, 'utf8')) as { workspaces?: GuiWorkspaceItem[] }
    if (!Array.isArray(parsed.workspaces)) return []
    return parsed.workspaces
      .filter((item): item is GuiWorkspaceItem =>
        typeof item?.path === 'string' &&
        item.path.length > 0 &&
        typeof item.lastOpenedAt === 'number' &&
        Number.isFinite(item.lastOpenedAt)
      )
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  } catch {
    return []
  }
}

function saveWorkspaceItems(items: GuiWorkspaceItem[]): void {
  mkdirSync(dirname(WORKSPACES_PATH), { recursive: true })
  writeFileSync(WORKSPACES_PATH, JSON.stringify({ workspaces: items.slice(0, 24) }, null, 2), 'utf8')
}

function rememberWorkspace(cwd: string): void {
  const path = resolve(cwd)
  const rest = readWorkspaceItems().filter((item) => item.path !== path)
  saveWorkspaceItems([{ path, lastOpenedAt: Date.now() }, ...rest])
}

function ensureWorkspaceDirectory(cwd: string): string {
  const path = resolve(cwd)
  if (!existsSync(path)) throw new Error(`Workspace does not exist: ${path}`)
  if (!statSync(path).isDirectory()) throw new Error(`Workspace is not a directory: ${path}`)
  return path
}

function getInitialCwd(options?: RuntimeStartOptions): string {
  if (options?.cwd) return ensureWorkspaceDirectory(options.cwd)
  const recent = readWorkspaceItems().find((item) => existsSync(item.path) && statSync(item.path).isDirectory())
  return recent?.path ?? process.cwd()
}

export function attachMainWindow(window: BrowserWindow | undefined): void {
  mainWindow = window
}

export function getMainWindow(): BrowserWindow | undefined {
  return mainWindow
}

export function getExistingRuntime(): MicrocodeRuntime | undefined {
  return runtime
}

export function listRecentWorkspaces(): GuiWorkspaceItem[] {
  return readWorkspaceItems()
}

function broadcast(event: GuiIpcEvent): void {
  mainWindow?.webContents.send('microcode:event', event)
}

export async function getRuntime(options?: RuntimeStartOptions): Promise<MicrocodeRuntime> {
  if (runtime) return runtime
  const cwd = getInitialCwd(options)
  runtime = await createMicrocodeRuntime({
    cwd,
    resume: options?.resume,
    resumeSessionId: options?.resumeSessionId,
    modelId: options?.modelId,
    permissionMode: options?.permissionMode,
    thinkingLevel: options?.thinkingLevel,
  })
  unsubscribeRuntime = runtime.subscribe(broadcast)
  await runtime.start()
  rememberWorkspace(cwd)
  return runtime
}

export async function openWorkspace(cwd: string): Promise<MicrocodeRuntime> {
  const nextCwd = ensureWorkspaceDirectory(cwd)
  if (runtime?.getSnapshot().cwd === nextCwd) {
    rememberWorkspace(nextCwd)
    return runtime
  }
  if (runtime?.getSnapshot().busy) {
    throw new Error('当前回复仍在进行中。请先停止或等待完成后再切换项目。')
  }
  await shutdownRuntime()
  const next = await getRuntime({ cwd: nextCwd, resume: true })
  broadcast({
    type: 'ready',
    snapshot: next.getSnapshot(),
    timeline: next.getTimeline(),
  })
  return next
}

export async function shutdownRuntime(): Promise<void> {
  if (!runtime) return
  unsubscribeRuntime?.()
  unsubscribeRuntime = undefined
  const active = runtime
  runtime = undefined
  await active.shutdown()
}
