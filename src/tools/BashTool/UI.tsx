import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import { formatCompletedStatus, formatRunningStatus, formatToolLabel, getProgressFrame } from '../../tui/toolPresentation.ts'

import type { ToolUIComponent, ToolResult } from '../registry.ts'

interface BashDetails {
  stdout: string
  stderr: string
  output?: string
  exitCode: number | null
}

const COLLAPSED_OUTPUT_LINES = 12
const COMMAND_PREVIEW_LEN = 80

export class BashToolUI extends Container implements ToolUIComponent {
  private args: any
  private expanded = false
  private executionStarted = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: BashDetails
  private contentBox: Box

  constructor(_toolCallId: string, args: any) {
    super()
    this.args = args
    this.contentBox = new Box(0, 0)
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
    this.details = details as unknown as BashDetails
    this.rebuild()
  }

  private rebuild(): void {
    const icon = this.result && !this.executionStarted
      ? this.result.isError
        ? theme.fg('error', '✗')   // ✗
        : theme.fg('success', '✓')  // ✓
      : this.executionStarted
        ? theme.fg('warning', getProgressFrame(this.elapsedMs))
        : theme.dim('○')            // ○

    const cmd = this.args?.command ?? ''
    const shortCmd = cmd.length > COMMAND_PREVIEW_LEN
      ? cmd.slice(0, COMMAND_PREVIEW_LEN) + '...'
      : cmd
    const description = this.args?.description
    const header = description
      ? `${formatToolLabel(icon, 'bash')}${theme.dim(description)}`
      : `${formatToolLabel(icon, 'bash')}${theme.fg('muted', '$')} ${theme.fg('text', shortCmd)}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatRunningStatus(this.elapsedMs))}`))
      return
    }

    const output = this.getOutput()
    const lines = output.split('\n')

    if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
      const exitLine = this.renderExitCode()
      const status = theme.dim(formatCompletedStatus(this.elapsedMs))
      this.contentBox.addChild(new Text(exitLine ? `${header} ${status}\n${exitLine}` : `${header} ${status}`))
      return
    }

    const needsCollapse = lines.length > COLLAPSED_OUTPUT_LINES && !this.expanded
    let displayLines = lines
    if (needsCollapse && this.executionStarted) {
      // Live output should follow the command, not remain stuck on its first lines.
      displayLines = lines.slice(-COLLAPSED_OUTPUT_LINES)
    } else if (needsCollapse) {
      const headCount = Math.ceil(COLLAPSED_OUTPUT_LINES / 2)
      const tailCount = COLLAPSED_OUTPUT_LINES - headCount
      displayLines = [
        ...lines.slice(0, headCount),
        theme.dim(`... ${lines.length - COLLAPSED_OUTPUT_LINES} lines omitted ...`),
        ...lines.slice(-tailCount),
      ]
    }
    const outputText = displayLines.join('\n')

    const exitLine = this.renderExitCode()
    const toggleHint = lines.length > COLLAPSED_OUTPUT_LINES
      ? theme.dim(
          this.expanded
            ? ' [collapse]'
            : this.executionStarted
              ? ` [latest ${COLLAPSED_OUTPUT_LINES}/${lines.length} lines]`
              : ` [expand, ${lines.length} lines]`,
        )
      : ''

    let content = header
    content += ` ${theme.dim(
      this.executionStarted
        ? formatRunningStatus(this.elapsedMs)
        : formatCompletedStatus(this.elapsedMs),
    )}`
    if (toggleHint) content += toggleHint
    content += `\n${outputText}`
    if (exitLine) content += `\n${exitLine}`

    this.contentBox.addChild(new Text(content))
  }

  private renderExitCode(): string {
    if (!this.details || this.executionStarted) return ''
    const { exitCode } = this.details
    if (exitCode === null || exitCode === undefined) return ''
    if (exitCode === 0) {
      return theme.dim(`exit: ${exitCode}`)
    }
    return theme.fg('error', `exit: ${exitCode}`)
  }

  private getOutput(): string {
    if (this.details) {
      const { stdout, stderr, output } = this.details
      return (output ?? stdout + stderr).trimEnd()
    }
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trimEnd()
  }
}
