import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { GuiApi, GuiApiConfigInput, GuiIpcEvent, GuiPermissionDecision, GuiPromptInput } from '../shared/types.ts'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { PermissionMode } from '../../permissions/index.ts'

let zoomLevel = 0

function setZoomLevel(next: number): number {
  zoomLevel = Math.max(-4, Math.min(6, Number(next.toFixed(2))))
  webFrame.setZoomLevel(zoomLevel)
  return zoomLevel
}

const api: GuiApi = {
  start: (options) => ipcRenderer.invoke('microcode:start', options),
  openWorkspace: (cwd: string) => ipcRenderer.invoke('microcode:openWorkspace', cwd),
  pickWorkspace: () => ipcRenderer.invoke('microcode:pickWorkspace'),
  listWorkspaces: () => ipcRenderer.invoke('microcode:listWorkspaces'),
  prompt: (input: GuiPromptInput) => ipcRenderer.invoke('microcode:prompt', input),
  command: (command: string) => ipcRenderer.invoke('microcode:command', command),
  abort: () => ipcRenderer.invoke('microcode:abort'),
  shutdown: () => ipcRenderer.invoke('microcode:shutdown'),
  setModel: (modelId: string) => ipcRenderer.invoke('microcode:setModel', modelId),
  setApiConfig: (input: GuiApiConfigInput) => ipcRenderer.invoke('microcode:setApiConfig', input),
  setThinkingLevel: (level: ThinkingLevel) => ipcRenderer.invoke('microcode:setThinkingLevel', level),
  setPermissionMode: (mode: PermissionMode) => ipcRenderer.invoke('microcode:setPermissionMode', mode),
  switchSession: (sessionId: string) => ipcRenderer.invoke('microcode:switchSession', sessionId),
  newSession: () => ipcRenderer.invoke('microcode:newSession'),
  toggleSkill: (skillName: string) => ipcRenderer.invoke('microcode:toggleSkill', skillName),
  remindTask: (listId: string, taskId: string, reminder: boolean) =>
    ipcRenderer.invoke('microcode:remindTask', listId, taskId, reminder),
  mcpAction: (action: 'enable' | 'disable' | 'reconnect', serverName: string) =>
    ipcRenderer.invoke('microcode:mcpAction', action, serverName),
  addMcpConfig: (rawJson: string) => ipcRenderer.invoke('microcode:addMcpConfig', rawJson),
  addModelConfig: (rawJson: string) => ipcRenderer.invoke('microcode:addModelConfig', rawJson),
  openExternal: (url: string) => ipcRenderer.invoke('microcode:openExternal', url),
  pickImages: () => ipcRenderer.invoke('microcode:pickImages'),
  answerPermission: (requestId: string, decision: GuiPermissionDecision) =>
    ipcRenderer.invoke('microcode:answerPermission', requestId, decision),
  answerQuestion: (requestId: string, answers: Record<string, string>, block?: boolean) =>
    ipcRenderer.invoke('microcode:answerQuestion', requestId, answers, block),
  listSessions: () => ipcRenderer.invoke('microcode:listSessions'),
  adjustZoom: (delta: number) => setZoomLevel(zoomLevel + delta),
  resetZoom: () => setZoomLevel(0),
  getZoom: () => zoomLevel,
  onEvent: (listener: (event: GuiIpcEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: GuiIpcEvent) => listener(payload)
    ipcRenderer.on('microcode:event', wrapped)
    return () => ipcRenderer.off('microcode:event', wrapped)
  },
}

contextBridge.exposeInMainWorld('microcode', api)
