import React from 'react'
import { GitBranch } from 'lucide-react'
import { MetricRow, OutputBlock, ToolFrame } from './helpers.ts'
import type { ToolRendererProps } from './types.ts'

export function WorktreeToolRenderer({ item, expanded, onToggleExpanded }: ToolRendererProps) {
  return React.createElement(ToolFrame, {
    item,
    icon: React.createElement(GitBranch, { size: 16 }),
    title: 'worktree',
    subtitle: [item.args.action, item.args.id].filter((value) => typeof value === 'string').join(' · '),
    expanded,
    onToggleExpanded,
  },
    React.createElement(MetricRow, {
      parts: [
        typeof item.details?.id === 'string' ? `id ${item.details.id}` : undefined,
        typeof item.details?.branch === 'string' ? item.details.branch : undefined,
      ],
    }),
    React.createElement(OutputBlock, { item, expanded, onToggleExpanded }),
  )
}
