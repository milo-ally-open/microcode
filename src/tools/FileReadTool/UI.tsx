import { Box, Container, Text } from '@earendil-works/pi-tui'
import { theme } from '../../tui/theme.ts'
import { formatCompletedStatus, formatRunningStatus, formatToolLabel, getProgressFrame } from '../../tui/toolPresentation.ts'

const PREVIEW_LINES = 0

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface FileReadDetails {
  path?: string
  totalLines?: number
  returnedLines?: number
  truncated?: boolean
}

export class FileReadToolUI extends Container {
  private args: any
  private executionStarted = false
  private expanded = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: FileReadDetails
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
    return Boolean(this.result && this.getOutputLines().length > PREVIEW_LINES)
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

  updateDetails(details: FileReadDetails): void {
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

    const filePath = this.details?.path || this.args?.file_path || ''
    const shortPath = filePath.split('/').slice(-2).join('/')
    const header = `${formatToolLabel(icon, 'read')}${theme.fg('accent', shortPath)}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatRunningStatus(this.elapsedMs))}`))
      return
    }

    const totalLines = this.details?.totalLines
    const returnedLines = this.details?.returnedLines
    const truncated = this.details?.truncated

    if (totalLines !== undefined && returnedLines !== undefined) {
      const lineInfo = truncated
        ? `${returnedLines}/${totalLines} lines ${theme.dim('(truncated)')}`
        : `${returnedLines} lines`
      const summary = theme.fg('muted', lineInfo)
      const toggle = this.hasToggleButton()
        ? `  ${theme.fg('accent', this.expanded ? '[Collapse preview]' : '[Expand preview]')}`
        : ''
      this.contentBox.addChild(new Text(`${header}  ${summary} ${theme.dim(`· ${formatCompletedStatus(this.elapsedMs)}`)}${toggle}`))
    } else {
      const lineCount = this.getOutputLines().length
      const lineInfo = lineCount === 1 ? '1 line' : `${lineCount} lines`
      const toggle = this.hasToggleButton()
        ? `  ${theme.fg('accent', this.expanded ? '[Collapse preview]' : '[Expand preview]')}`
        : ''
      this.contentBox.addChild(new Text(
        `${header} ${theme.dim(formatCompletedStatus(this.elapsedMs))} ${theme.fg('muted', `· ${lineInfo}`)}${toggle}`,
      ))
    }

    const lines = this.getOutputLines()
    const visibleLines = lines.slice(0, this.expanded ? lines.length : PREVIEW_LINES)
    if (lines.length > visibleLines.length) {
      if (PREVIEW_LINES > 0) visibleLines.push(theme.dim(`… ${lines.length - visibleLines.length} more lines`))
    }
    if (visibleLines.length > 0) {
      this.contentBox.addChild(new Text(visibleLines.join('\n')))
    }
  }

  private getOutputLines(): string[] {
    if (!this.result) return []
    const output = this.result.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('\n')
    const lines = output.split('\n')
    if (output.endsWith('\n')) lines.pop()
    return output ? lines : []
  }
}
