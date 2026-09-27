import React from 'react'
import type { GuiRuntimeSnapshot } from '../../shared/types.ts'

export function StatusBar({ snapshot }: { snapshot?: GuiRuntimeSnapshot }) {
  if (!snapshot) return React.createElement('footer', { className: 'statusbar' }, 'Starting Microcode...')
  return React.createElement('footer', { className: 'statusbar' },
    React.createElement('span', null, snapshot.cwd),
    React.createElement('span', null, snapshot.agent.model.id),
    React.createElement('span', null, snapshot.agent.thinkingLevel),
    React.createElement('span', null, snapshot.agent.permission.mode),
    React.createElement('span', null, `${snapshot.agent.tokens.context.percentUsed}% context`),
  )
}
