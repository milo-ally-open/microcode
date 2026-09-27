import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import { formatCompletedStatus, formatRunningStatus, formatToolLabel, getProgressFrame } from '../../tui/toolPresentation.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface VisionDetails {
  source?: string
  mimeType?: string
  sourceType?: string
}

export class VisionToolUI extends Container {
  private args: any
  private executionStarted = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: VisionDetails
  private contentBox: Box

  constructor(_toolCallId: string, args: any) {
    super()
    this.args = args
    this.contentBox = new Box(0, 0)
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

  updateDetails(details: VisionDetails): void {
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

    const source = this.details?.source ?? this.args?.image_source ?? ''
    const sourceType = this.details?.sourceType ?? 'image'
    const header = `${formatToolLabel(icon, 'vision')}${theme.fg('accent', source.slice(-40))}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatRunningStatus(this.elapsedMs, 'processing'))}`))
      return
    }

    if (this.result.isError) {
      const errText = this.result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join(' ') ?? 'unknown error'
      this.contentBox.addChild(new Text(`${header}\n  ${chalk.hex('#cc6666')(errText.slice(0, 200))}`))
    } else {
      const info = `${sourceType} · ${this.details?.mimeType ?? 'image'}`
      this.contentBox.addChild(new Text(`${header}  ${theme.fg('muted', info)} ${theme.dim(`· ${formatCompletedStatus(this.elapsedMs)}`)}`))
    }
  }
}
