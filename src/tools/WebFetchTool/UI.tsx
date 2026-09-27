import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import { formatCompletedStatus, formatRunningStatus, getProgressFrame } from '../../tui/toolPresentation.ts'
import type { ToolResult, ToolUIComponent } from '../registry.ts'

interface WebFetchDetails {
  url?: string
  finalUrl?: string
  bytes?: number
  code?: number
  codeText?: string
  contentType?: string
  truncated?: boolean
  durationMs?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    const path = `${url.pathname}${url.search}`.replace(/\/$/, '')
    const preview = `${url.hostname}${path}`
    return preview.length > 72 ? `...${preview.slice(-69)}` : preview
  } catch {
    return value.length > 72 ? `...${value.slice(-69)}` : value
  }
}

export class WebFetchToolUI extends Container implements ToolUIComponent {
  private args: Record<string, unknown>
  private expanded = false
  private executionStarted = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: WebFetchDetails
  private contentBox: Box

  constructor(_toolCallId: string, args: Record<string, unknown>) {
    super()
    this.args = args
    this.contentBox = new Box(1, 0)
    this.addChild(this.contentBox)
    this.rebuild()
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.rebuild()
  }

  markExecutionStarted(): void {
    this.executionStarted = true
    this.rebuild()
  }

  updateArgs(args: Record<string, unknown>): void {
    this.args = args
    this.rebuild()
  }

  updateElapsed(elapsedMs: number): void {
    this.elapsedMs = elapsedMs
    this.rebuild()
  }

  updateResult(result: ToolResult, isPartial = false): void {
    this.result = result
    if (!isPartial) {
      this.executionStarted = false
    }
    this.rebuild()
  }

  updateDetails(details: Record<string, unknown>): void {
    this.details = details as WebFetchDetails
    this.rebuild()
  }

  private rebuild(): void {
    const icon = this.result && !this.executionStarted
      ? this.result.isError
        ? theme.fg('error', '✗')
        : theme.fg('success', '✓')
      : this.executionStarted
        ? theme.fg('warning', getProgressFrame(this.elapsedMs))
        : theme.dim('○')

    const url = typeof this.args.url === 'string'
      ? this.args.url
      : this.details?.url ?? ''
    const header = `${icon} ${chalk.bold('WebFetch')} ${theme.fg('accent', displayUrl(url || '...'))}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatRunningStatus(this.elapsedMs, 'fetching'))}`))
      return
    }

    if (this.result.isError) {
      this.contentBox.addChild(new Text(`${header}\n  ${theme.fg('error', this.getOutputPreview())}`))
      return
    }

    const parts: string[] = []
    if (this.details?.code) parts.push(String(this.details.code))
    if (this.details?.bytes !== undefined) parts.push(formatBytes(this.details.bytes))
    if (this.details?.truncated) parts.push(theme.dim('truncated'))
    if (parts.length === 0) parts.push('completed')

    this.contentBox.addChild(
      new Text(`${header}  ${theme.fg('muted', parts.join(', '))} ${theme.dim(`· ${formatCompletedStatus(this.elapsedMs)}`)}`),
    )
  }

  private getOutputPreview(): string {
    return this.result?.content
      ?.filter((content) => content.type === 'text')
      .map((content) => content.text ?? '')
      .join(' ')
      .slice(0, this.expanded ? 1000 : 200)
      .replace(/\n/g, ' ') || 'unknown error'
  }
}
