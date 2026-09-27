import React, { useEffect, useRef } from 'react'
import { MessageItem } from './MessageItem.ts'
import { ToolItem } from './ToolItem.ts'
import { CommandResult } from './CommandResult.ts'
import { PermissionItem } from './PermissionItem.ts'
import { NoticeItem } from './NoticeItem.ts'
import { CompactionItem } from './CompactionItem.ts'
import type { GuiChatItem, GuiRuntimeSnapshot } from '../../../shared/types.ts'

export function Transcript({ timeline, snapshot }: { timeline: GuiChatItem[]; snapshot?: GuiRuntimeSnapshot }) {
  const scrollRef = useRef<HTMLElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(true)

  const scrollToBottom = () => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }

  const handleScroll = () => {
    const node = scrollRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    autoScrollRef.current = distanceFromBottom < 72
  }

  useEffect(() => {
    if (autoScrollRef.current) requestAnimationFrame(scrollToBottom)
  }, [timeline])

  return React.createElement('main', { className: 'transcript', ref: scrollRef, onScroll: handleScroll },
    timeline.length === 0 && React.createElement('div', { className: 'welcome' },
      React.createElement('h1', null, '今天有什么计划？'),
      React.createElement('div', { className: 'prompt-suggestions' },
        React.createElement('button', { onClick: () => void window.microcode.command('/model') }, '切换模型'),
        React.createElement('button', { onClick: () => void window.microcode.command('/mcp') }, '检查 MCP'),
      ),
    ),
    timeline.map((item) => {
      if (item.kind === 'message') return React.createElement(MessageItem, { key: item.id, item })
      if (item.kind === 'tool') return React.createElement(ToolItem, { key: item.id, item })
      if (item.kind === 'command') return React.createElement(CommandResult, { key: item.id, item, snapshot })
      if (item.kind === 'permission') return React.createElement(PermissionItem, { key: item.id, item, snapshot })
      if (item.kind === 'compaction') return React.createElement(CompactionItem, { key: item.id, item })
      return React.createElement(NoticeItem, { key: item.id, item })
    }),
    React.createElement('div', { ref: endRef }),
  )
}
