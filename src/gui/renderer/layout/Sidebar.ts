import React, { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, FolderOpen, GitBranch, KeyRound, MessageSquare, PanelLeft, Plus, Server, Settings, Sparkles } from 'lucide-react'
import { GlassSelect } from '../components/GlassSelect.ts'
import { BrandLogo } from '../components/BrandLogo.ts'
import { ApiConfigPanel } from '../features/settings/ApiConfigPanel.ts'
import { cx } from '../lib/cx.ts'
import type { GuiRuntimeSnapshot, GuiWorkspaceItem } from '../../shared/types.ts'
import type { View } from '../app/viewTypes.ts'

function workspaceLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function formatTokens(value: number): string {
  return value.toLocaleString('en-US')
}

function formatPrice(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.0001) return `$${value.toFixed(6)}`
  return `$${value.toFixed(4)}`
}

function SettingsSection({
  id,
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  meta?: string
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return React.createElement('section', { className: cx('settings-section', open && 'open') },
    React.createElement('button', {
      className: 'settings-section-trigger',
      type: 'button',
      'aria-expanded': open,
      'aria-controls': `settings-section-${id}`,
      onClick: () => setOpen((value) => !value),
    },
      open ? React.createElement(ChevronDown, { size: 15 }) : React.createElement(ChevronRight, { size: 15 }),
      React.createElement('span', null, title),
      meta && React.createElement('small', null, meta),
    ),
    open && React.createElement('div', { className: 'settings-section-body', id: `settings-section-${id}` }, children),
  )
}

function TokenUsagePanel({ snapshot }: { snapshot: GuiRuntimeSnapshot }) {
  const current = snapshot.agent.tokens.currentModel
  const session = snapshot.agent.tokens.session
  const context = snapshot.agent.tokens.context
  return React.createElement('div', { className: 'settings-token-panel' },
    React.createElement('div', { className: 'settings-token-current' },
      React.createElement('strong', null, current.modelId),
      React.createElement('span', null, `${current.provider} · ${current.api}`),
    ),
    React.createElement('div', { className: 'settings-token-bar' },
      React.createElement('span', { style: { width: `${Math.min(100, Math.max(0, context.percentUsed))}%` } }),
    ),
    React.createElement('div', { className: 'settings-token-grid' },
      React.createElement('span', null, 'Current model'),
      React.createElement('strong', null, `${formatTokens(current.totalTokens)} tok · ${formatTokens(current.requests)} req`),
      React.createElement('span', null, 'Input / output'),
      React.createElement('strong', null, `${formatTokens(current.inputTokens)} / ${formatTokens(current.outputTokens)}`),
      React.createElement('span', null, 'Cache'),
      React.createElement('strong', null, formatTokens(current.cacheReadTokens + current.cacheWriteTokens)),
      React.createElement('span', null, 'Cost'),
      React.createElement('strong', null, formatPrice(current.totalCost)),
      React.createElement('span', null, 'Session total'),
      React.createElement('strong', null, `${formatTokens(session.totalTokens)} tok · ${formatTokens(session.requests)} req`),
      React.createElement('span', null, 'Context'),
      React.createElement('strong', null, `${context.percentUsed}% · ${formatTokens(context.usedTokens)}/${formatTokens(context.contextWindow)}`),
    ),
  )
}

export function Sidebar({
  view,
  snapshot,
  recentWorkspaces,
  startupError,
  workspaceBusy,
  setView,
  onToggleCollapse,
  onPickWorkspace,
  onOpenWorkspace,
}: {
  view: View
  snapshot?: GuiRuntimeSnapshot
  recentWorkspaces?: GuiWorkspaceItem[]
  startupError?: string
  workspaceBusy?: boolean
  setView: (view: View) => void
  onToggleCollapse: () => void
  onPickWorkspace?: () => void
  onOpenWorkspace?: (path: string) => void
}) {
  const [expandedTaskLists, setExpandedTaskLists] = useState<Record<string, boolean>>({})
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [modelConfigText, setModelConfigText] = useState('')
  const [configBusy, setConfigBusy] = useState<'mcp' | 'model' | null>(null)
  const [configError, setConfigError] = useState<string | undefined>()
  const [configSuccess, setConfigSuccess] = useState<string | undefined>()
  const [modelSearch, setModelSearch] = useState('')
  const recentWorkspaceList = recentWorkspaces ?? []

  const projectSwitcher = snapshot
    ? React.createElement('button', {
        className: 'project-switcher',
        type: 'button',
        disabled: workspaceBusy,
        title: snapshot.cwd,
        onClick: onPickWorkspace,
      },
        React.createElement(FolderOpen, { size: 15 }),
        React.createElement('span', null,
          React.createElement('strong', null, workspaceLabel(snapshot.cwd)),
          React.createElement('small', null, snapshot.cwd),
        ),
      )
    : React.createElement('button', {
        className: 'project-switcher empty',
        type: 'button',
        disabled: workspaceBusy,
        onClick: onPickWorkspace,
      },
        React.createElement(FolderOpen, { size: 15 }),
        React.createElement('span', null,
          React.createElement('strong', null, workspaceBusy ? 'Opening...' : 'Open Project'),
          React.createElement('small', null, 'Choose a folder'),
        ),
      )

  if (!snapshot) {
    return React.createElement('aside', { className: 'sidebar' },
      React.createElement('div', { className: 'sidebar-brand' },
        React.createElement(BrandLogo),
      ),
      projectSwitcher,
      React.createElement('div', { className: 'sidebar-section' },
        startupError
          ? React.createElement('div', { className: 'config-error' }, startupError)
          : React.createElement('div', { className: 'muted' }, 'Choose a project to begin.'),
      ),
      recentWorkspaceList.length > 0 && React.createElement('div', { className: 'sidebar-section' },
        React.createElement('div', { className: 'sidebar-label' }, 'Recent Projects'),
        recentWorkspaceList.slice(0, 10).map((workspace) =>
          React.createElement('button', {
            className: 'session-row',
            key: workspace.path,
            title: workspace.path,
            disabled: workspaceBusy,
            onClick: () => onOpenWorkspace?.(workspace.path),
          },
            React.createElement('strong', null, workspaceLabel(workspace.path)),
            React.createElement('span', null, workspace.path),
          ),
        ),
      ),
    )
  }

  const nav = React.createElement('div', { className: 'chatgpt-nav' },
    React.createElement('button', {
      className: cx('nav-row', view === 'chat' && 'active'),
      onClick: () => {
        setView('chat')
        void window.microcode.newSession()
      },
    }, React.createElement(MessageSquare, { size: 18 }), '新聊天'),
    React.createElement('button', { className: cx('nav-row', view === 'sessions' && 'active'), onClick: () => setView('sessions') }, React.createElement(PanelLeft, { size: 18 }), '会话历史'),
    React.createElement('button', { className: cx('nav-row', view === 'tasks' && 'active'), onClick: () => setView('tasks') }, React.createElement(GitBranch, { size: 18 }), '任务'),
    React.createElement('button', { className: cx('nav-row', view === 'mcp' && 'active'), onClick: () => setView('mcp') }, React.createElement(Server, { size: 18 }), 'MCP'),
    React.createElement('button', { className: cx('nav-row', view === 'skills' && 'active'), onClick: () => setView('skills') }, React.createElement(Sparkles, { size: 18 }), '技能'),
    React.createElement('button', { className: cx('nav-row', view === 'settings' && 'active'), onClick: () => setView('settings') }, React.createElement(Settings, { size: 18 }), '模型与设置'),
  )

  const recent = React.createElement('div', { className: 'recent-section' },
    React.createElement('div', { className: 'recent-title' }, '最近'),
    snapshot.sessions.slice(0, 28).map((session) =>
      React.createElement('button', {
        className: cx('recent-row', session.id === snapshot.sessionId && 'active'),
        key: session.id,
        onClick: () => void window.microcode.switchSession(session.id),
      }, session.title || '新会话'),
    ),
  )

  const shell = (content?: React.ReactNode) => React.createElement('aside', { className: 'sidebar' },
    React.createElement('div', { className: 'sidebar-brand' },
      React.createElement(BrandLogo),
      React.createElement('button', { title: '折叠侧边栏', onClick: onToggleCollapse }, React.createElement(PanelLeft, { size: 18 })),
    ),
    projectSwitcher,
    nav,
    content && React.createElement('div', { className: 'sidebar-panel' }, content),
    !content && recent,
  )

  if (view === 'mcp') {
    const submitMcpConfig = () => {
      setConfigError(undefined)
      setConfigSuccess(undefined)
      setConfigBusy('mcp')
      void window.microcode.addMcpConfig(mcpConfigText).then((result) => {
        setMcpConfigText('')
        setConfigSuccess(`Added ${result.names.join(', ')} to ${result.path}`)
      }).catch((error) => {
        setConfigError(error instanceof Error ? error.message : String(error))
      }).finally(() => setConfigBusy(null))
    }
    return shell(React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'panel-title' }, 'MCP Servers'),
      React.createElement('div', { className: 'config-paste-panel' },
        React.createElement('div', { className: 'sidebar-label' }, 'Add MCP config'),
        React.createElement('textarea', {
          placeholder: '{\n  "mcpServers": {\n    "my-server": {\n      "command": "node",\n      "args": ["server.js"]\n    }\n  }\n}',
          value: mcpConfigText,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setMcpConfigText(event.currentTarget.value),
        }),
        configError && React.createElement('div', { className: 'config-error' }, configError),
        configSuccess && React.createElement('div', { className: 'config-success' }, configSuccess),
        React.createElement('button', {
          className: 'wide-action',
          disabled: configBusy !== null || !mcpConfigText.trim(),
          onClick: submitMcpConfig,
        }, React.createElement(Plus, { size: 14 }), configBusy === 'mcp' ? 'Adding...' : 'Add MCP config'),
      ),
      snapshot.mcpServers.length === 0
        ? React.createElement('div', { className: 'empty' }, 'No MCP servers connected.')
        : snapshot.mcpServers.map((server) =>
            React.createElement('div', { className: 'side-row', key: server.name },
              React.createElement('span', { className: cx('status-dot', server.status) }),
              React.createElement('div', { className: 'side-row-main' },
                React.createElement('strong', null, server.name),
                React.createElement('span', null, `${server.status} · ${server.tools.length} tools · ${server.resources.length} resources`),
                React.createElement('div', { className: 'inline-actions' },
                  server.status === 'disabled'
                    ? React.createElement('button', { onClick: () => void window.microcode.mcpAction('enable', server.name) }, 'Enable')
                    : React.createElement('button', { onClick: () => void window.microcode.mcpAction('disable', server.name) }, 'Disable'),
                  React.createElement('button', { onClick: () => void window.microcode.mcpAction('reconnect', server.name) }, 'Reconnect'),
                ),
              ),
            ),
          ),
    ))
  }

  if (view === 'tasks') {
    return shell(React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'panel-title' }, '当前会话任务'),
      snapshot.tasks.length === 0
        ? React.createElement('div', { className: 'empty' }, '当前 session 还没有任务。')
        : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'accordion-list' },
            snapshot.tasks.map((list, index) => {
              const expanded = expandedTaskLists[list.id] ?? index === 0
              const stats = list.stats ?? {
                total: list.tasks.length,
                completed: list.tasks.filter((task) => task.completed).length,
                inProgress: list.tasks.filter((task) => !task.completed && task.pending).length,
                remaining: list.tasks.filter((task) => !task.completed && !task.pending).length,
              }
              return React.createElement('section', { className: cx('accordion-item', expanded && 'expanded'), key: list.id },
                React.createElement('button', {
                  className: 'accordion-trigger',
                  type: 'button',
                  'aria-expanded': expanded,
                  onClick: () => setExpandedTaskLists((current) => ({ ...current, [list.id]: !expanded })),
                },
                  expanded ? React.createElement(ChevronDown, { size: 15 }) : React.createElement(ChevronRight, { size: 15 }),
                  React.createElement(FileText, { size: 15 }),
                  React.createElement('span', { className: 'accordion-title' }, list.title),
                  React.createElement('small', null, `${stats.completed}/${stats.total}`),
                ),
                expanded && React.createElement('div', { className: 'accordion-body detail-card task-detail-card' },
                  React.createElement('div', { className: 'task-stats-grid' },
                    React.createElement('span', null, `total ${stats.total}`),
                    React.createElement('span', null, `done ${stats.completed}`),
                    React.createElement('span', null, `doing ${stats.inProgress}`),
                    React.createElement('span', null, `left ${stats.remaining}`),
                  ),
                  list.tasks.map((item) =>
                    React.createElement('article', { className: cx('task-detail-row', item.completed && 'completed', item.pending && 'pending'), key: item.id },
                      React.createElement('div', { className: 'task-detail-top' },
                        React.createElement('span', { className: cx('task-state-pill', item.completed ? 'done' : item.pending ? 'pending' : 'todo') },
                          item.completed ? 'done' : item.pending ? 'pending' : 'todo',
                        ),
                        React.createElement('label', { className: 'task-reminder-toggle' },
                          React.createElement('input', {
                            type: 'checkbox',
                            checked: item.reminder === true,
                            disabled: item.completed,
                            onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                              void window.microcode.remindTask(list.id, item.id, event.currentTarget.checked),
                          }),
                          'priority',
                        ),
                      ),
                      React.createElement('strong', null, item.content),
                      React.createElement('small', null, `updated ${new Date(item.updatedAt).toLocaleString()}`),
                    ),
                  ),
                ),
              )
            }),
          ),
        ),
    ))
  }

  if (view === 'skills') {
    return shell(React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'panel-title' }, '技能'),
      snapshot.skills.length === 0
        ? React.createElement('div', { className: 'empty' }, 'No skills found.')
        : React.createElement('div', { className: 'skill-list' },
          snapshot.skills.map((skill) =>
            React.createElement('article', { className: cx('skill-row', skill.loaded && 'loaded', skill.disabled && 'disabled'), key: skill.name },
              React.createElement('div', { className: 'skill-row-head' },
                React.createElement('strong', null, skill.name),
                React.createElement('button', {
                  disabled: skill.disabled,
                  onClick: () => void window.microcode.toggleSkill(skill.name),
                }, skill.disabled ? '不可用' : skill.loaded ? '禁用' : '开启'),
              ),
              React.createElement('p', null, skill.description),
              React.createElement('small', null, skill.filePath),
            ),
          ),
        ),
    ))
  }

  if (view === 'settings') {
    const envEntries = Object.entries(snapshot.config.modelEnv)
    const configuredEnvCount = envEntries.filter(([, present]) => present).length
    const currentModelUsage = snapshot.agent.tokens.currentModel
    const submitModelConfig = () => {
      setConfigError(undefined)
      setConfigSuccess(undefined)
      setConfigBusy('model')
      void window.microcode.addModelConfig(modelConfigText).then((result) => {
        setModelConfigText('')
        setConfigSuccess(`Added ${result.names.join(', ')} to ${result.path}`)
      }).catch((error) => {
        setConfigError(error instanceof Error ? error.message : String(error))
      }).finally(() => setConfigBusy(null))
    }
    return shell(React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'panel-title' }, '模型与设置'),
      React.createElement(SettingsSection, {
        id: 'runtime',
        title: '运行设置',
        meta: snapshot.agent.model.name,
        defaultOpen: true,
      },
        React.createElement('div', { className: 'setting-block' },
          React.createElement('label', null, 'Model'),
          React.createElement('input', {
            className: 'model-search-input',
            type: 'search',
            value: modelSearch,
            placeholder: 'Search provider or model',
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => setModelSearch(event.currentTarget.value),
          }),
          React.createElement(GlassSelect, {
            value: `${snapshot.agent.model.provider}/${snapshot.agent.model.id}`,
            ariaLabel: 'Model',
            onChange: (nextValue) => void window.microcode.setModel(nextValue),
            options: snapshot.models
              .filter((model) => !modelSearch.trim() || `${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(modelSearch.trim().toLowerCase()))
              .sort((left, right) => left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name))
              .map((model) => ({
              value: `${model.provider}/${model.id}`,
              label: model.name,
              meta: `${model.provider} · ${model.api}${model.apiKeyConfigured ? '' : ' · no key'}`,
              missing: !model.apiKeyConfigured,
            })),
          }),
        ),
        React.createElement('div', { className: 'setting-block' },
          React.createElement('label', null, 'Permission'),
          React.createElement(GlassSelect, {
            value: snapshot.agent.permission.mode,
            ariaLabel: 'Permission',
            onChange: (nextValue) => void window.microcode.setPermissionMode(nextValue as any),
            options: ['interactive', 'auto-approve', 'plan'].map((mode) => ({
              value: mode,
              label: mode,
            })),
          }),
        ),
        React.createElement('div', { className: 'setting-block' },
          React.createElement('label', null, 'Thinking'),
          React.createElement(GlassSelect, {
            value: snapshot.agent.thinkingLevel,
            ariaLabel: 'Thinking',
            onChange: (nextValue) => void window.microcode.setThinkingLevel(nextValue as any),
            options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => ({
              value: level,
              label: level,
            })),
          }),
        ),
      ),
      React.createElement(SettingsSection, {
        id: 'token-usage',
        title: 'Token 用量',
        meta: `${formatTokens(currentModelUsage.totalTokens)} tok`,
        defaultOpen: true,
      },
        React.createElement(TokenUsagePanel, { snapshot }),
      ),
      React.createElement(SettingsSection, {
        id: 'api-config',
        title: 'API 配置',
        meta: `${configuredEnvCount}/${envEntries.length} set`,
        defaultOpen: true,
      },
        React.createElement(ApiConfigPanel, { snapshot }),
      ),
      React.createElement(SettingsSection, {
        id: 'custom-model',
        title: '自定义模型',
        meta: 'JSON',
      },
        React.createElement('div', { className: 'config-paste-panel' },
          React.createElement('textarea', {
            placeholder: '{\n  "models": [{\n    "id": "my-model",\n    "name": "My Model",\n    "api": "openai-completions",\n    "baseUrl": "https://api.example.com/v1",\n    "contextWindow": 128000,\n    "maxTokens": 4096\n  }]\n}',
            value: modelConfigText,
            onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setModelConfigText(event.currentTarget.value),
          }),
          configError && React.createElement('div', { className: 'config-error' }, configError),
          configSuccess && React.createElement('div', { className: 'config-success' }, configSuccess),
          React.createElement('button', {
            className: 'wide-action',
            disabled: configBusy !== null || !modelConfigText.trim(),
            onClick: submitModelConfig,
          }, React.createElement(Plus, { size: 14 }), configBusy === 'model' ? 'Adding...' : 'Add model'),
        ),
      ),
      React.createElement(SettingsSection, {
        id: 'config-status',
        title: '配置状态',
        meta: `${configuredEnvCount}/${envEntries.length}`,
      },
        React.createElement('div', { className: 'config-path' }, snapshot.config.userConfigPath),
        React.createElement('div', { className: 'config-path' }, snapshot.config.projectConfigPath),
        envEntries.map(([key, present]) =>
          React.createElement('div', { className: 'kv', key },
            React.createElement('span', null, key),
            React.createElement('strong', { className: present ? 'ok' : 'missing' }, present ? 'set' : 'missing'),
          ),
        ),
      ),
      React.createElement(SettingsSection, {
        id: 'available-models',
        title: '可用模型',
        meta: String(snapshot.models.length),
      },
        snapshot.models.map((model) =>
          React.createElement('button', {
            key: `${model.provider}/${model.id}`,
            className: cx('model-row', model.current && 'active'),
            onClick: () => void window.microcode.setModel(`${model.provider}/${model.id}`),
          },
            React.createElement('span', { className: 'model-title' }, model.name),
            React.createElement('span', null, `${model.provider} · ${model.api}`),
            React.createElement('span', null, `${model.reasoning ? 'reasoning' : 'standard'}${model.vision ? ' · vision' : ''}`),
            React.createElement('span', { className: model.apiKeyConfigured ? 'ok' : 'missing' },
              React.createElement(KeyRound, { size: 12 }),
              model.apiKeyEnv,
            ),
          ),
        ),
      ),
    ))
  }

  if (view === 'sessions') {
    return shell(React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'panel-title' }, '会话历史'),
      React.createElement('button', { className: 'wide-action', onClick: () => void window.microcode.newSession() }, 'New Session'),
      snapshot.sessions.length === 0
        ? React.createElement('div', { className: 'empty' }, 'No saved sessions found.')
        : snapshot.sessions.map((session) =>
            React.createElement('button', {
              className: cx('session-row', session.id === snapshot.sessionId && 'active'),
              key: session.id,
              onClick: () => void window.microcode.switchSession(session.id),
            },
              React.createElement('strong', null, session.title || '新会话'),
              React.createElement('span', null, `${session.id.slice(0, 8)} · ${session.createdAt ? new Date(session.createdAt).toLocaleString() : ''}`),
              React.createElement('span', null, session.cwd),
            ),
          ),
    ))
  }

  return shell()
}
