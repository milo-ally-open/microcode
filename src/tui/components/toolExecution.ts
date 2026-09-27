import { Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../theme.ts'
import {
  formatCompletedStatus,
  formatRunningStatus,
  formatToolLabel,
  getProgressFrame,
} from '../toolPresentation.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

/**
 * Component that renders a compact tool activity row without a status panel.
 */
export class ToolExecutionComponent extends Container {
  private toolName: string
  private args: any
  private expanded = false
  private executionStarted = false
  private elapsedMs = 0
  private result?: ToolResult
  private content: Text

  constructor(toolName: string, _toolCallId: string, args: any) {
    super()
    this.toolName = toolName
    this.args = args

    this.content = new Text('')
    this.addChild(this.content)
    this.updateDisplay()
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.updateDisplay()
  }

  markExecutionStarted(): void {
    this.executionStarted = true
    this.updateDisplay()
  }

  updateElapsed(elapsedMs: number): void {
    this.elapsedMs = elapsedMs
    this.updateDisplay()
  }

  updateArgs(args: Record<string, unknown>): void {
    this.args = args
    this.updateDisplay()
  }

  updateResult(result: ToolResult, isPartial = false): void {
    this.result = result
    if (!isPartial) {
      this.executionStarted = false
    }
    this.updateDisplay()
  }

  private updateDisplay(): void {
    const icon = this.result
      ? this.result.isError
        ? chalk.hex('#cc6666')('✗')
        : chalk.hex('#b5bd68')('✓')
      : this.executionStarted
        ? chalk.hex('#ffff00')(getProgressFrame(this.elapsedMs))
        : chalk.hex('#666666')('○')

    const argsStr = this.formatArgs(this.args)
    const header = `${formatToolLabel(icon, this.toolName)}${argsStr ? chalk.hex('#666666')(argsStr) : ''}`

    let content: string
    if (this.result) {
      const output = this.getOutputText()
      if (this.executionStarted) {
        const preview = output ? this.formatOutput(output) : formatRunningStatus(this.elapsedMs)
        content = this.expanded
          ? `${header}\n${chalk.hex('#808080')(preview)}`
          : `${header} ${chalk.hex('#666666')(preview)}`
      } else if (output.trim()) {
        const preview = this.formatOutput(output)
        content = this.expanded
          ? `${header} ${chalk.hex('#666666')(formatCompletedStatus(this.elapsedMs))}\n${chalk.hex('#808080')(preview)}`
          : `${header} ${chalk.hex('#666666')(formatCompletedStatus(this.elapsedMs))} · ${chalk.hex('#808080')(preview)}`
      } else {
        content = `${header} ${chalk.hex('#808080')(`completed with no output · ${formatCompletedStatus(this.elapsedMs)}`)}`
      }
    } else {
      content = `${header} ${chalk.hex('#666666')(formatRunningStatus(this.elapsedMs))}`
    }

    this.content.setText(content)
  }

  private getOutputText(): string {
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
  }

  private formatArgs(args: any): string {
    if (!args) return ''
    if (this.expanded) return JSON.stringify(args, null, 2) ?? ''
    const entries = Object.entries(args)
    if (entries.length === 0) return ''
    const summary = entries
      .map(([key, value]) => {
        const serialized = JSON.stringify(value)
        const val = (serialized ?? String(value)).replace(/\s+/g, ' ')
        return `${key}=${val}`
      })
      .join(', ')
    return summary.length > 112 ? `${summary.slice(0, 109)}…` : summary
  }

  private formatOutput(output: string): string {
    if (this.expanded) return output
    const firstLine = output.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''
    const summary = firstLine.replace(/\s+/g, ' ')
    if (!summary) return ''
    return summary.length > 120 ? `${summary.slice(0, 117)}…` : summary
  }
}
