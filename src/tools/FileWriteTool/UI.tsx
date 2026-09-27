import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import {
  renderChangeSummary,
  renderNewFilePreview,
} from '../../utils/diffUtils.ts'
import {
  countContentLines,
  formatBytes,
  formatCompletedStatus,
  formatRunningStatus,
  formatToolLabel,
  getProgressFrame,
} from '../../tui/toolPresentation.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface FileWriteDetails {
  path?: string
  bytesWritten?: number
  additions?: number
  removals?: number
  isNewFile?: boolean
  preview?: string
  phase?: 'preparing' | 'writing' | 'complete'
  warning?: string
  written?: boolean
}

const NEW_FILE_PREVIEW_LINES = 8

export class FileWriteToolUI extends Container {
  private args: any
  private expanded = false
  private executionStarted = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: FileWriteDetails
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

  updateDetails(details: FileWriteDetails): void {
    this.details = details
    this.rebuild()
  }

  private rebuild(): void {
    const icon = this.result && !this.executionStarted
      ? this.result.isError || this.details?.written === false
        ? theme.fg('error', '✗')
        : theme.fg('success', '✓')
      : this.executionStarted
        ? theme.fg('warning', getProgressFrame(this.elapsedMs))
        : theme.dim('○')

    const filePath = this.details?.path || this.args?.file_path || ''
    const shortPath = filePath.split('/').slice(-2).join('/')
    const header = `${formatToolLabel(icon, 'write')}${theme.fg('accent', shortPath)}`

    this.contentBox.clear()

    if (this.details?.written === false && this.details.warning) {
      this.contentBox.addChild(
        new Text(
          `${header} ${theme.fg('warning', 'not written')}\n  ${theme.fg('muted', this.details.warning)}`,
        ),
      )
      return
    }

    if (!this.result) {
      if (this.details?.phase === 'preparing') {
        const additions = this.details.additions ?? 0
        const bytes = this.details.bytesWritten ?? 0
        const summary = this.details.isNewFile
          ? renderChangeSummary(additions, 0)
          : theme.fg('muted', `${additions} generated line${additions === 1 ? '' : 's'}`)
        this.contentBox.addChild(
          new Text(`${header} ${theme.dim('preparing')}\n  ${summary} ${theme.dim(`· ${formatBytes(bytes)}`)}`),
        )
      } else {
        this.contentBox.addChild(new Text(`${header} ${theme.dim(formatRunningStatus(this.elapsedMs))}`))
      }
      return
    }

    if (this.details && !this.details.isNewFile) {
      const additions = this.details.additions ?? 0
      const removals = this.details.removals ?? 0
      const summary = renderChangeSummary(additions, removals)
      const bytes = this.details?.bytesWritten
      const byteInfo = bytes === undefined ? '' : ` · ${formatBytes(bytes)}`
      const lines: string[] = [
        `${header} ${theme.dim(this.executionStarted ? 'writing' : formatCompletedStatus(this.elapsedMs))}`,
        `  ${summary || theme.dim('no changes')}${theme.dim(byteInfo)}`,
      ]
      this.contentBox.addChild(new Text(lines.join('\n')))
    } else if (this.details?.isNewFile) {
      // New file — show syntax preview
      const content = this.details.preview ?? ''
      const lineCount = this.details.additions ?? countContentLines(content)
      const bytes = this.details.bytesWritten ?? Buffer.byteLength(content, 'utf8')
      const summary = renderChangeSummary(lineCount, 0)
      const lines: string[] = [
        `${header} ${theme.dim(this.executionStarted ? 'writing' : formatCompletedStatus(this.elapsedMs))}`,
        `  ${summary} ${theme.dim(`· ${formatBytes(bytes)} · new file`)}`,
      ]

      const previewLines = renderNewFilePreview(content, this.expanded ? 50 : NEW_FILE_PREVIEW_LINES)
      for (const line of previewLines) {
        lines.push(`  ${line}`)
      }

      this.contentBox.addChild(new Text(lines.join('\n')))
    } else {
      // Fallback
      const output = this.getOutputPreview()
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatCompletedStatus(this.elapsedMs))}\n  ${theme.fg('muted', output || 'completed with no output')}`))
    }
  }

  private getOutputPreview(): string {
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.text ?? '').slice(0, 200).replace(/\n/g, ' '))
      .join(' ')
  }
}
