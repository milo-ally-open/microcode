import React, { useEffect, useState } from 'react'
import type { GuiRuntimeSnapshot } from '../../../shared/types.ts'

export function ApiConfigPanel({ snapshot }: { snapshot: GuiRuntimeSnapshot }) {
  const modelKey = `${snapshot.agent.model.provider}/${snapshot.agent.model.id}`
  const currentModel = snapshot.models.find((model) => `${model.provider}/${model.id}` === modelKey)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(snapshot.agent.model.baseUrl)

  useEffect(() => {
    setApiKey('')
    setBaseUrl(snapshot.agent.model.baseUrl)
  }, [snapshot.agent.model.provider, snapshot.agent.model.id, snapshot.agent.model.baseUrl])

  return React.createElement('div', { className: 'api-glass-panel' },
    React.createElement('div', { className: 'api-panel-head' },
      React.createElement('strong', null, 'API 配置'),
      React.createElement('span', null, currentModel?.authStatus ?? 'not configured'),
    ),
    currentModel?.apiKeyLogin && React.createElement('label', { className: 'glass-field' },
      React.createElement('span', null, currentModel?.apiKeyEnv ?? 'API Key'),
      React.createElement('input', {
        type: 'password',
        value: apiKey,
        placeholder: currentModel?.apiKeyConfigured ? '留空则保持当前 key' : '输入 API key',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setApiKey(event.currentTarget.value),
      }),
    ),
    React.createElement('label', { className: 'glass-field' },
      React.createElement('span', null, 'Base URL'),
      React.createElement('input', {
        value: baseUrl,
        disabled: currentModel?.custom === true,
        placeholder: 'https://...',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(event.currentTarget.value),
      }),
    ),
    currentModel?.custom && React.createElement('div', { className: 'field-hint' }, '自定义模型的 baseUrl 来自 .microcode/config.json'),
    currentModel?.apiKeyLogin && React.createElement('button', {
      className: 'liquid-button primary',
      onClick: () => void window.microcode.setApiConfig({
        modelKey,
        apiKey: apiKey || undefined,
        baseUrl: currentModel?.custom ? undefined : baseUrl,
      }),
    }, '应用配置'),
    React.createElement('div', { className: 'api-auth-actions' },
      React.createElement('button', {
        className: 'liquid-button',
        onClick: () => void window.microcode.command(`/login ${snapshot.agent.model.provider}`),
      }, '登录 provider'),
      currentModel?.apiKeyConfigured && React.createElement('button', {
        className: 'liquid-button',
        onClick: () => void window.microcode.command(`/logout ${snapshot.agent.model.provider}`),
      }, '退出登录'),
    ),
  )
}
