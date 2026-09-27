import { dialog, ipcMain, shell } from 'electron'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { PermissionMode } from '../../permissions/index.ts'
import type { GuiApiConfigInput, GuiPermissionDecision, GuiPromptInput } from '../shared/types.ts'
import { getMainWindow, getRuntime, listRecentWorkspaces, openWorkspace, shutdownRuntime } from './runtimeHost.ts'

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function registerIpc(): void {
  ipcMain.handle('microcode:start', async (_event, options) => {
    const active = await getRuntime(options)
    return {
      snapshot: active.getSnapshot(),
      timeline: active.getTimeline(),
    }
  })
  ipcMain.handle('microcode:openWorkspace', async (_event, cwd: string) => {
    const active = await openWorkspace(cwd)
    return {
      snapshot: active.getSnapshot(),
      timeline: active.getTimeline(),
    }
  })
  ipcMain.handle('microcode:pickWorkspace', async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: 'Open Project',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const active = await openWorkspace(result.filePaths[0])
    return {
      snapshot: active.getSnapshot(),
      timeline: active.getTimeline(),
    }
  })
  ipcMain.handle('microcode:listWorkspaces', async () => {
    return listRecentWorkspaces()
  })
  ipcMain.handle('microcode:prompt', async (_event, input: GuiPromptInput) => {
    await (await getRuntime()).prompt(input)
  })
  ipcMain.handle('microcode:command', async (_event, command: string) => {
    await (await getRuntime()).command(command)
  })
  ipcMain.handle('microcode:abort', async () => {
    await (await getRuntime()).abort()
  })
  ipcMain.handle('microcode:shutdown', async () => {
    await shutdownRuntime()
  })
  ipcMain.handle('microcode:setModel', async (_event, modelId: string) => {
    await (await getRuntime()).setModel(modelId)
  })
  ipcMain.handle('microcode:setApiConfig', async (_event, input: GuiApiConfigInput) => {
    await (await getRuntime()).setApiConfig(input)
  })
  ipcMain.handle('microcode:setThinkingLevel', async (_event, level: ThinkingLevel) => {
    await (await getRuntime()).setThinkingLevel(level)
  })
  ipcMain.handle('microcode:setPermissionMode', async (_event, mode: PermissionMode) => {
    await (await getRuntime()).setPermissionMode(mode)
  })
  ipcMain.handle('microcode:switchSession', async (_event, sessionId: string) => {
    await (await getRuntime()).switchSession(sessionId)
  })
  ipcMain.handle('microcode:newSession', async () => {
    await (await getRuntime()).newSession()
  })
  ipcMain.handle('microcode:toggleSkill', async (_event, skillName: string) => {
    await (await getRuntime()).toggleSkill(skillName)
  })
  ipcMain.handle('microcode:remindTask', async (_event, listId: string, taskId: string, reminder: boolean) => {
    await (await getRuntime()).remindTask(listId, taskId, reminder)
  })
  ipcMain.handle('microcode:mcpAction', async (_event, action: 'enable' | 'disable' | 'reconnect', serverName: string) => {
    await (await getRuntime()).mcpAction(action, serverName)
  })
  ipcMain.handle('microcode:addMcpConfig', async (_event, rawJson: string) => {
    return (await getRuntime()).addMcpConfig(rawJson)
  })
  ipcMain.handle('microcode:addModelConfig', async (_event, rawJson: string) => {
    return (await getRuntime()).addModelConfig(rawJson)
  })
  ipcMain.handle('microcode:openExternal', async (_event, url: string) => {
    if (!isExternalHttpUrl(url)) return
    await shell.openExternal(url)
  })
  ipcMain.handle('microcode:pickImages', async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: 'Upload images',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      ],
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('microcode:answerPermission', async (_event, requestId: string, decision: GuiPermissionDecision) => {
    await (await getRuntime()).answerPermission(requestId, decision)
  })
  ipcMain.handle('microcode:answerQuestion', async (_event, requestId: string, answers: Record<string, string>, block?: boolean) => {
    await (await getRuntime()).answerQuestion(requestId, answers, block)
  })
  ipcMain.handle('microcode:listSessions', async () => {
    return (await getRuntime()).listSessions()
  })
}
