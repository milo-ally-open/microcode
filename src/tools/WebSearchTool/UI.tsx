import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import { formatCompletedStatus, formatRunningStatus, getProgressFrame } from '../../tui/toolPresentation.ts'
import type { ToolResult, ToolUIComponent } from '../registry.ts'

interface WebSearchDetails {
  query?: string
  results?: Array<{ title: string; url: string; snippet?: string }>
  durationMs?: number
}

const QUERY_PREVIEW_LEN = 72

function shorten(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}...` : value
}

export class WebSearchToolUI extends Container implements ToolUIComponent {
  private args: Record<string, unknown>
  private expanded = false
  private executionStarted = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: WebSearchDetails
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
    this.details = details as WebSearchDetails
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

    const query = typeof this.args.query === 'string'
      ? this.args.query
      : this.details?.query ?? ''
    const queryPreview = shorten(query || '...', QUERY_PREVIEW_LEN)
    const header = `${icon} ${chalk.bold('WebSearch')} ${theme.fg('accent', queryPreview)}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatRunningStatus(this.elapsedMs, 'searching'))}`))
      return
    }

    if (this.result.isError) {
      this.contentBox.addChild(new Text(`${header}\n  ${theme.fg('error', this.getOutputPreview())}`))
      return
    }

    const resultCount = this.details?.results?.length
    const resultInfo = resultCount === undefined
      ? 'completed'
      : `${resultCount} result${resultCount === 1 ? '' : 's'}`
    const status = formatCompletedStatus(this.elapsedMs)
    this.contentBox.addChild(new Text(`${header}  ${theme.fg('muted', resultInfo)} ${theme.dim(`· ${status}`)}`))
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
