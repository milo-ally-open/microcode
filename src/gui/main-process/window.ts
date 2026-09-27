import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { attachMainWindow } from './runtimeHost.ts'

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function createMainWindow(electronDir: string): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0f1117',
    title: 'Microcode',
    icon: join(electronDir, '../renderer/assets/microcode.png'),
    webPreferences: {
      preload: join(electronDir, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  attachMainWindow(mainWindow)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isExternalHttpUrl(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  // Do not mirror renderer console output to stdout: packaged Windows launchers
  // may close the inherited pipe, and console.log would raise an uncaught EPIPE.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[renderer:load-failed] ${code} ${description} ${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:gone] ${details.reason}`)
  })

  await mainWindow.loadFile(join(electronDir, '../renderer/index.html'))
  mainWindow.on('closed', () => {
    attachMainWindow(undefined)
  })
}
