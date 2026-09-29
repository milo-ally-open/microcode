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

const CONTENT_PREVIEW_LINES = 12

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

  toggleExpanded(): void {
    this.setExpanded(!this.expanded)
  }

  hasToggleButton(): boolean {
    return Boolean(this.args?.content || this.details?.preview)
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
        const lines = [`${header} ${theme.dim('preparing')}`, `  ${summary} ${theme.dim(`· ${formatBytes(bytes)}`)}`]
        this.appendContentPreview(lines, this.details.preview ?? this.args?.content ?? '')
        this.contentBox.addChild(new Text(lines.join('\n')))
      } else {
        const lines = [`${header} ${theme.dim(formatRunningStatus(this.elapsedMs))}`]
        this.appendContentPreview(lines, this.args?.content ?? '')
        this.contentBox.addChild(new Text(lines.join('\n')))
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
      this.appendContentPreview(lines, this.details.preview ?? this.args?.content ?? '')
      this.contentBox.addChild(new Text(lines.join('\n')))
    } else if (this.details?.isNewFile) {
      // New file — show syntax preview
      const content = this.details.preview ?? this.args?.content ?? ''
      const lineCount = this.details.additions ?? countContentLines(content)
      const bytes = this.details.bytesWritten ?? Buffer.byteLength(content, 'utf8')
      const summary = renderChangeSummary(lineCount, 0)
      const lines: string[] = [
        `${header} ${theme.dim(this.executionStarted ? 'writing' : formatCompletedStatus(this.elapsedMs))}`,
        `  ${summary} ${theme.dim(`· ${formatBytes(bytes)} · new file`)}`,
      ]

      this.appendContentPreview(lines, content)
      this.contentBox.addChild(new Text(lines.join('\n')))
    } else {
      // Fallback
      const output = this.getOutputPreview()
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatCompletedStatus(this.elapsedMs))}\n  ${theme.fg('muted', output || 'completed with no output')}`))
    }
  }

  private appendContentPreview(lines: string[], content: string): void {
    if (!content) return
    const lineCount = content.split('\n').length
    const maxLines = this.expanded ? lineCount : CONTENT_PREVIEW_LINES
    const previewLines = renderNewFilePreview(content, maxLines)
    lines.push(`  ${theme.fg('accent', this.expanded ? '[Collapse preview]' : '[Expand preview]')}`)
    lines.push(...previewLines.map((line) => `  ${line}`))
  }

  private getOutputPreview(): string {
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.text ?? '').slice(0, 200).replace(/\n/g, ' '))
      .join(' ')
  }
}
