export type AgentActivityState =
  | { phase: 'idle' }
  | { phase: 'thinking' }
  | { phase: 'preparing-tool' }
  | { phase: 'running-tool'; toolName: string }
  | { phase: 'running-tools' }
  | { phase: 'responding' }

export type AgentActivityEvent =
  | { type: 'thinking' }
  | { type: 'preparing-tool' }
  | { type: 'tool-started'; toolName: string }
  | { type: 'tool-finished'; pendingTools: number }
  | { type: 'responding'; pendingTools: number }
  | { type: 'work-finished'; pendingTools: number }

/** Maps real Agent lifecycle events to a small provider-neutral activity state machine. */
export function transitionAgentActivity(
  _current: AgentActivityState,
  event: AgentActivityEvent,
): AgentActivityState {
  switch (event.type) {
    case 'thinking':
      return { phase: 'thinking' }
    case 'preparing-tool':
      return { phase: 'preparing-tool' }
    case 'tool-started':
      return { phase: 'running-tool', toolName: event.toolName }
    case 'tool-finished':
    case 'work-finished':
      return event.pendingTools > 0
        ? { phase: 'running-tools' }
        : event.type === 'tool-finished'
          ? { phase: 'thinking' }
          : { phase: 'idle' }
    case 'responding':
      return event.pendingTools > 0 ? { phase: 'running-tools' } : { phase: 'responding' }
  }
}

export function getAgentActivityLabel(state: AgentActivityState): string | undefined {
  switch (state.phase) {
    case 'thinking': return 'Analyzing…'
    case 'preparing-tool': return 'Preparing tool call…'
    case 'running-tool': return `Running ${state.toolName}…`
    case 'running-tools': return 'Running tools…'
    case 'responding': return 'Responding…'
    case 'idle': return undefined
  }
}
