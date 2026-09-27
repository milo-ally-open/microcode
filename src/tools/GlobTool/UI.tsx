import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import { formatCompletedStatus, formatRunningStatus, getProgressFrame } from '../../tui/toolPresentation.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface GlobDetails {
  numFiles?: number
  filenames?: string[]
  truncated?: boolean
  durationMs?: number
}

export class GlobToolUI extends Container {
  private args: any
  private executionStarted = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: GlobDetails
  private contentBox: Box

  constructor(_toolCallId: string, args: any) {
    super()
    this.args = args
    this.contentBox = new Box(1, 0)
    this.addChild(this.contentBox)
    this.rebuild()
  }

  setExpanded(_expanded: boolean): void {
    this.rebuild()
  }

  markExecutionStarted(): void {
    this.executionStarted = true
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

  updateDetails(details: GlobDetails): void {
    this.details = details
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

    const pattern = this.args?.pattern || '...'
    const shortPattern = pattern.length > 40 ? pattern.slice(0, 40) + '...' : pattern

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${icon} ${chalk.bold('Glob')} ${theme.fg('accent', shortPattern)} ${theme.dim(formatRunningStatus(this.elapsedMs))}`))
      return
    }

    const numFiles = this.details?.numFiles
    const truncated = this.details?.truncated

    if (numFiles !== undefined) {
      const fileInfo = truncated
        ? `${numFiles} files ${theme.dim('(truncated)')}`
        : `${numFiles} files`
      this.contentBox.addChild(new Text(`${icon} ${chalk.bold('Glob')} ${theme.fg('accent', shortPattern)}  ${theme.fg('muted', fileInfo)} ${theme.dim(`· ${formatCompletedStatus(this.elapsedMs)}`)}`))
    } else {
      const output = this.result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => (c.text ?? '').slice(0, 200).replace(/\n/g, ' '))
        .join(' ') ?? ''
      this.contentBox.addChild(new Text(`${icon} ${chalk.bold('Glob')} ${theme.fg('accent', shortPattern)}\n  ${theme.fg('muted', output)}`))
    }
  }
}
