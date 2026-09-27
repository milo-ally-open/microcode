import React from 'react'
import { FileText, KeyRound, Sparkles, Terminal } from 'lucide-react'
import { COMMANDS, COMMAND_DESCRIPTIONS } from '../../commands/catalog.ts'
import { cx } from '../../lib/cx.ts'
import type { GuiCommandItem, GuiRuntimeSnapshot } from '../../../shared/types.ts'

function MetricTile({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return React.createElement('div', { className: cx('command-metric', accent && 'accent') },
    React.createElement('span', null, label),
    React.createElement('strong', null, value),
  )
}

function formatTokens(value: number): string {
  return value.toLocaleString('en-US')
}

function formatPrice(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.0001) return `$${value.toFixed(6)}`
  return `$${value.toFixed(4)}`
}

export function CommandResult({ item, snapshot }: { item: GuiCommandItem; snapshot?: GuiRuntimeSnapshot }) {
  const renderBody = () => {
    if (!snapshot) return React.createElement('div', { className: 'empty' }, 'Runtime snapshot is loading.')

    if (item.command === '/status') {
      const context = snapshot.agent.tokens.context
      const session = snapshot.agent.tokens.session
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'command-metrics-grid' },
          React.createElement(MetricTile, { label: 'Model', value: snapshot.agent.model.id, accent: true }),
          React.createElement(MetricTile, { label: 'Thinking', value: snapshot.agent.thinkingLevel }),
          React.createElement(MetricTile, { label: 'Permission', value: snapshot.agent.permission.mode }),
          React.createElement(MetricTile, { label: 'Context', value: `${snapshot.agent.tokens.context.percentUsed}%` }),
          React.createElement(MetricTile, { label: 'Messages', value: snapshot.agent.messageCount }),
          React.createElement(MetricTile, { label: 'Session tokens', value: formatTokens(session.totalTokens) }),
          React.createElement(MetricTile, { label: 'Workers', value: `${snapshot.runningWorkers}/${snapshot.maxWorkers}` }),
        ),
        React.createElement('div', { className: 'command-token-panel' },
          React.createElement('div', { className: 'command-token-head' },
            React.createElement('strong', null, 'Context window'),
            React.createElement('span', null, `${context.percentUsed}% used`),
          ),
          React.createElement('div', { className: 'command-token-bar' },
            React.createElement('span', { style: { width: `${Math.min(100, Math.max(0, context.percentUsed))}%` } }),
          ),
          React.createElement('div', { className: 'command-token-grid' },
            React.createElement('span', null, 'Used'),
            React.createElement('strong', null, `${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}`),
            React.createElement('span', null, 'Remaining'),
            React.createElement('strong', null, `${formatTokens(context.remainingTokens)} (${context.percentRemaining}%)`),
            React.createElement('span', null, 'Breakdown'),
            React.createElement('strong', null, `system ${formatTokens(context.systemPromptTokens)} + messages ${formatTokens(context.messageTokens)}`),
          ),
        ),
        React.createElement('div', { className: 'command-token-panel' },
          React.createElement('div', { className: 'command-token-head' },
            React.createElement('strong', null, 'Usage by model'),
            React.createElement('span', null, `${snapshot.tokenUsageByModel.length} models`),
          ),
          snapshot.tokenUsageByModel.length === 0
            ? React.createElement('div', { className: 'command-empty-state' }, 'No model token usage recorded yet.')
            : React.createElement('div', { className: 'command-model-usage-list' },
                snapshot.tokenUsageByModel.map((usage) =>
                  React.createElement('div', { className: 'command-model-usage-row', key: usage.key },
                    React.createElement('div', null,
                      React.createElement('strong', null, usage.modelId),
                      React.createElement('span', null, `${usage.provider} · ${usage.api}`),
                    ),
                    React.createElement('div', null,
                      React.createElement('strong', null, `${formatTokens(usage.requests)} req · ${formatTokens(usage.totalTokens)} tok`),
                      React.createElement('span', null,
                        `in ${formatTokens(usage.inputTokens)} · out ${formatTokens(usage.outputTokens)} · cache ${formatTokens(usage.cacheReadTokens + usage.cacheWriteTokens)} · ${formatPrice(usage.totalCost)}`,
                      ),
                    ),
                  ),
                ),
              ),
        ),
        React.createElement('div', { className: 'command-path-row' },
          React.createElement('span', null, 'cwd'),
          React.createElement('code', null, snapshot.cwd),
        ),
      )
    }

    if (item.command === '/model') {
      const current = snapshot.models.find((model) => model.current) ?? snapshot.models[0]
      return React.createElement(React.Fragment, null,
        current && React.createElement('div', { className: 'command-current-model' },
          React.createElement('div', null,
            React.createElement('span', null, 'Current model'),
            React.createElement('strong', null, current.name),
          ),
          React.createElement('div', { className: 'command-chip-row' },
            React.createElement('span', { className: 'command-chip' }, current.provider),
            React.createElement('span', { className: 'command-chip' }, current.api),
            current.reasoning && React.createElement('span', { className: 'command-chip ok' }, 'reasoning'),
            current.vision && React.createElement('span', { className: 'command-chip ok' }, 'vision'),
            React.createElement('span', { className: cx('command-chip', current.apiKeyConfigured ? 'ok' : 'bad') },
              current.authStatus,
            ),
          ),
        ),
        React.createElement('div', { className: 'command-model-grid' },
          snapshot.models.map((model) =>
            React.createElement('button', {
              key: `${model.provider}/${model.id}`,
              className: cx('command-model-card', model.current && 'current'),
              onClick: () => void window.microcode.setModel(`${model.provider}/${model.id}`),
            },
              React.createElement('strong', null, model.name),
              React.createElement('span', null, `${model.provider} · ${model.api}`),
              React.createElement('small', { className: model.apiKeyConfigured ? 'ok' : 'bad' },
                model.authStatus,
              ),
            ),
          ),
        ),
      )
    }

    if (item.command === '/mcp') {
      return snapshot.mcpServers.length === 0
        ? React.createElement('div', { className: 'command-empty-state' }, 'No MCP servers connected.')
        : React.createElement('div', { className: 'command-server-grid' },
            snapshot.mcpServers.map((server) =>
              React.createElement('div', { className: cx('command-server-card', server.status), key: server.name },
                React.createElement('div', { className: 'command-card-head' },
                  React.createElement('span', { className: cx('status-dot', server.status) }),
                  React.createElement('strong', null, server.name),
                  React.createElement('span', null, server.status),
                ),
                React.createElement('div', { className: 'command-chip-row' },
                  React.createElement('span', { className: 'command-chip' }, `${server.tools.length} tools`),
                  React.createElement('span', { className: 'command-chip' }, `${server.resources.length} resources`),
                ),
              ),
            ),
          )
    }

    if (item.command === '/agents') {
      return React.createElement('div', { className: 'command-agent-list' },
        snapshot.agents.length === 0
          ? React.createElement('div', { className: 'command-empty-state' }, 'No delegated agents yet.')
          : snapshot.agents.map((agent) =>
              React.createElement('div', { className: cx('command-agent-row', agent.task.status), key: agent.task.id },
                React.createElement('span', { className: cx('status-dot', agent.task.status) }),
                React.createElement('div', null,
                  React.createElement('strong', null, agent.task.description || agent.identity.name || agent.identity.id),
                  React.createElement('span', null, agent.activity || agent.task.status),
                ),
                React.createElement('small', null, `${agent.task.usage.toolCalls} tools`),
              ),
            ),
      )
    }

    if (item.command === '/tasks') {
      return snapshot.tasks.length === 0
        ? React.createElement('div', { className: 'command-empty-state' }, 'No task lists in this session.')
        : React.createElement('div', { className: 'command-task-list' },
            snapshot.tasks.map((list) =>
              React.createElement('div', { className: 'command-task-group', key: list.id },
                React.createElement('div', { className: 'command-card-head' },
                  React.createElement(FileText, { size: 15 }),
                  React.createElement('strong', null, list.title),
                  React.createElement('span', null, `${list.tasks.filter((task) => task.completed).length}/${list.tasks.length}`),
                ),
                list.tasks.slice(0, 5).map((task) =>
                  React.createElement('div', { className: cx('command-task-row', task.completed && 'done'), key: task.id },
                    React.createElement('span', null, task.completed ? 'done' : task.reminder ? 'pinned' : 'todo'),
                    React.createElement('strong', null, task.content),
                  ),
                ),
              ),
            ),
          )
    }

    if (item.command === '/session') {
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'command-current-model' },
          React.createElement('div', null,
            React.createElement('span', null, 'Active session'),
            React.createElement('strong', null, snapshot.sessionTitle || snapshot.sessionId?.slice(0, 8) || 'none'),
          ),
          React.createElement('code', null, snapshot.sessionId ?? 'no-session'),
        ),
        React.createElement('div', { className: 'command-session-list' },
          snapshot.sessions.slice(0, 6).map((session) =>
            React.createElement('button', {
              className: cx('command-session-row', session.id === snapshot.sessionId && 'current'),
              key: session.id,
              onClick: () => void window.microcode.switchSession(session.id),
            },
              React.createElement('strong', null, session.title || session.id.slice(0, 8)),
              React.createElement('span', null, session.cwd),
            ),
          ),
        ),
      )
    }

    if (item.command === '/skills') {
      return React.createElement('div', { className: 'command-skill-grid' },
        snapshot.skills.length === 0
          ? React.createElement('div', { className: 'command-empty-state' }, 'No skills discovered.')
          : snapshot.skills.map((skill) =>
              React.createElement('button', {
                className: cx('command-skill-card', skill.loaded && 'loaded', skill.disabled && 'disabled'),
                key: skill.name,
                disabled: skill.disabled,
                onClick: () => void window.microcode.toggleSkill(skill.name),
              },
                React.createElement('strong', null, skill.name),
                React.createElement('span', null, skill.description || skill.filePath),
                React.createElement('small', null, skill.disabled ? 'disabled' : skill.loaded ? 'loaded' : 'available'),
              ),
            ),
      )
    }

    if (item.command === '/thinking') {
      return React.createElement('div', { className: 'command-mode-grid' },
        ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((level) =>
          React.createElement('button', {
            className: cx('command-mode-card', snapshot.agent.thinkingLevel === level && 'current'),
            key: level,
            onClick: () => void window.microcode.setThinkingLevel(level as any),
          },
            React.createElement(Sparkles, { size: 15 }),
            React.createElement('strong', null, level),
          ),
        ),
      )
    }

    if (item.command === '/permission') {
      return React.createElement('div', { className: 'command-mode-grid' },
        ['interactive', 'auto-approve', 'plan'].map((mode) =>
          React.createElement('button', {
            className: cx('command-mode-card', snapshot.agent.permission.mode === mode && 'current'),
            key: mode,
            onClick: () => void window.microcode.setPermissionMode(mode as any),
          },
            React.createElement(KeyRound, { size: 15 }),
            React.createElement('strong', null, mode),
          ),
        ),
      )
    }

    return React.createElement('div', { className: 'command-help-grid' },
      COMMANDS.map((command) =>
        React.createElement('button', {
          className: 'command-help-row',
          key: command,
          onClick: () => {
            if (command === '/help') return
            void window.microcode.command(command)
          },
        },
          React.createElement('code', null, command),
          React.createElement('span', null, COMMAND_DESCRIPTIONS[command] ?? 'Run command'),
        ),
      ),
    )
  }

  return React.createElement('article', { className: cx('command-result', item.command.slice(1) || 'command') },
    React.createElement('div', { className: 'command-result-head' },
      React.createElement(Terminal, { size: 16 }),
      React.createElement('div', null,
        React.createElement('strong', null, item.title),
        React.createElement('span', null, item.command),
      ),
    ),
    renderBody(),
  )
}
