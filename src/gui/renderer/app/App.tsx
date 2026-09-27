import React, { useEffect, useState } from 'react'
import {
  GitBranch,
  MessageSquare,
  PanelLeft,
  Search,
  Server,
  Settings,
  Sparkles,
} from 'lucide-react'
import { ActivityButton } from '../components/ActivityButton.ts'
import { ErrorBoundary } from '../components/ErrorBoundary.ts'
import { CommandPalette } from '../features/command-palette/CommandPalette.ts'
import { Composer } from '../features/composer/Composer.ts'
import { Transcript } from '../features/timeline/Transcript.ts'
import { Sidebar } from '../layout/Sidebar.ts'
import { StatusBar } from '../layout/StatusBar.ts'
import { cx } from '../lib/cx.ts'
import type { View } from './viewTypes.ts'
import type { CSSProperties } from 'react'
import type {
  GuiChatItem,
  GuiIpcEvent,
  GuiRuntimeSnapshot,
  GuiWorkspaceItem,
} from '../../shared/types.ts'

const SIDEBAR_WIDTH_KEY = 'microcode.sidebarWidth'
const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 1200

function clampSidebarWidth(width: number) {
  const viewportMax = typeof window === 'undefined' ? MAX_SIDEBAR_WIDTH : Math.max(240, window.innerWidth - 320)
  return Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), Math.min(MAX_SIDEBAR_WIDTH, viewportMax)))
}

function workspaceLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function App() {
  const [view, setView] = useState<View>('chat')
  const [timeline, setTimeline] = useState<GuiChatItem[]>([])
  const [snapshot, setSnapshot] = useState<GuiRuntimeSnapshot>()
  const [recentWorkspaces, setRecentWorkspaces] = useState<GuiWorkspaceItem[]>([])
  const [startupError, setStartupError] = useState<string | undefined>()
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(saved) && saved > 0 ? clampSidebarWidth(saved) : DEFAULT_SIDEBAR_WIDTH
  })

  useEffect(() => {
    const refreshWorkspaces = () => {
      void window.microcode.listWorkspaces().then(setRecentWorkspaces).catch(() => undefined)
    }
    refreshWorkspaces()
    const off = window.microcode.onEvent((event: GuiIpcEvent) => {
      if (event.type === 'timeline') setTimeline(event.timeline)
      if (event.type === 'snapshot') setSnapshot(event.snapshot)
      if (event.type === 'ready') {
        setSnapshot(event.snapshot)
        setTimeline(event.timeline)
        setStartupError(undefined)
        refreshWorkspaces()
      }
    })
    const keyHandler = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.key === '+' || event.key === '=') {
          event.preventDefault()
          window.microcode.adjustZoom(0.5)
          return
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault()
          window.microcode.adjustZoom(-0.5)
          return
        }
        if (event.key === '0') {
          event.preventDefault()
          window.microcode.resetZoom()
        }
      }
    }
    window.addEventListener('keydown', keyHandler)
    return () => {
      off()
      window.removeEventListener('keydown', keyHandler)
    }
  }, [])

  const applyWorkspaceResult = (result: { snapshot: GuiRuntimeSnapshot; timeline: GuiChatItem[] } | null) => {
    if (!result) return
    setSnapshot(result.snapshot)
    setTimeline(result.timeline)
    setStartupError(undefined)
    setView('chat')
    void window.microcode.listWorkspaces().then(setRecentWorkspaces).catch(() => undefined)
  }

  const pickWorkspace = () => {
    setWorkspaceBusy(true)
    void window.microcode.pickWorkspace()
      .then(applyWorkspaceResult)
      .catch((error) => setStartupError(error instanceof Error ? error.message : String(error)))
      .finally(() => setWorkspaceBusy(false))
  }

  const openWorkspace = (path: string) => {
    setWorkspaceBusy(true)
    void window.microcode.openWorkspace(path)
      .then(applyWorkspaceResult)
      .catch((error) => setStartupError(error instanceof Error ? error.message : String(error)))
      .finally(() => setWorkspaceBusy(false))
  }

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (!sidebarResizing) return
    const move = (event: PointerEvent) => setSidebarWidth(clampSidebarWidth(event.clientX))
    const stop = () => setSidebarResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [sidebarResizing])

  const shellStyle = { '--sidebar-width': `${sidebarWidth}px` } as CSSProperties

  return React.createElement('div', {
    className: cx('app-shell', sidebarCollapsed && 'sidebar-collapsed', sidebarResizing && 'sidebar-resizing'),
    style: shellStyle,
  },
    React.createElement('nav', { className: 'activitybar' },
      React.createElement('div', { className: 'activity-top' },
        React.createElement(ActivityButton, { active: view === 'chat', label: 'Chat', icon: React.createElement(MessageSquare, { size: 21 }), onClick: () => setView('chat') }),
        React.createElement(ActivityButton, { active: view === 'sessions', label: 'Sessions', icon: React.createElement(PanelLeft, { size: 21 }), onClick: () => setView('sessions') }),
        React.createElement(ActivityButton, { active: view === 'tasks', label: 'Tasks', icon: React.createElement(GitBranch, { size: 21 }), onClick: () => setView('tasks') }),
        React.createElement(ActivityButton, { active: view === 'mcp', label: 'MCP', icon: React.createElement(Server, { size: 21 }), onClick: () => setView('mcp') }),
        React.createElement(ActivityButton, { active: view === 'skills', label: 'Skills', icon: React.createElement(Sparkles, { size: 21 }), onClick: () => setView('skills') }),
      ),
      React.createElement('div', { className: 'activity-bottom' },
        React.createElement(ActivityButton, { active: false, label: 'Command Palette', icon: React.createElement(Search, { size: 21 }), onClick: () => setPaletteOpen(true) }),
        React.createElement(ActivityButton, { active: view === 'settings', label: 'Settings', icon: React.createElement(Settings, { size: 21 }), onClick: () => setView('settings') }),
      ),
    ),
    React.createElement(Sidebar, {
      view,
      snapshot,
      recentWorkspaces,
      startupError,
      workspaceBusy,
      setView,
      onToggleCollapse: () => setSidebarCollapsed(true),
      onPickWorkspace: pickWorkspace,
      onOpenWorkspace: openWorkspace,
    }),
    !sidebarCollapsed && React.createElement('button', {
      className: 'sidebar-resizer',
      type: 'button',
      title: '拖动调整侧边栏宽度',
      'aria-label': '拖动调整侧边栏宽度',
      'aria-orientation': 'vertical',
      role: 'separator',
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
        setSidebarResizing(true)
      },
    }),
    React.createElement('section', {
      className: cx(
        'workbench',
        timeline.length === 0 && 'empty-state',
      ),
    },
      sidebarCollapsed && React.createElement('button', {
        className: 'sidebar-restore',
        title: '展开侧边栏',
        onClick: () => setSidebarCollapsed(false),
      }, React.createElement(PanelLeft, { size: 18 })),
      React.createElement('header', { className: 'titlebar' },
        React.createElement('div', null,
          React.createElement('strong', null, 'Microcode'),
          React.createElement('span', null, snapshot?.sessionTitle || 'Welcome'),
        ),
        React.createElement('div', { className: 'titlebar-actions' },
          React.createElement('button', { className: 'small-button', onClick: () => setPaletteOpen(true) }, React.createElement(Search, { size: 15 }), 'Commands'),
        ),
      ),
      React.createElement(ErrorBoundary, { resetKey: timeline.at(-1)?.id },
        snapshot
          ? React.createElement(Transcript, { timeline, snapshot })
          : React.createElement('main', { className: 'transcript' },
              React.createElement('div', { className: 'welcome' },
                React.createElement('h1', null, '打开一个项目开始'),
                startupError && React.createElement('p', { className: 'startup-error' }, startupError),
                React.createElement('div', { className: 'prompt-suggestions' },
                  React.createElement('button', { disabled: workspaceBusy, onClick: pickWorkspace }, workspaceBusy ? 'Opening...' : '打开文件夹'),
                  ...recentWorkspaces.slice(0, 3).map((workspace) =>
                    React.createElement('button', {
                      key: workspace.path,
                      title: workspace.path,
                      disabled: workspaceBusy,
                      onClick: () => openWorkspace(workspace.path),
                    }, workspaceLabel(workspace.path)),
                  ),
                ),
              ),
            ),
      ),
      snapshot && React.createElement(Composer, { busy: Boolean(snapshot.busy), snapshot }),
      React.createElement(StatusBar, { snapshot }),
    ),
    React.createElement(CommandPalette, { open: paletteOpen, onClose: () => setPaletteOpen(false) }),
  )
}
