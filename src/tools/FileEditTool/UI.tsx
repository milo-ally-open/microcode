import { Box, Container, Text } from '@earendil-works/pi-tui'
import { theme } from '../../tui/theme.ts'
import {
  renderChangeSummary,
} from '../../utils/diffUtils.ts'
import { formatCompletedStatus, formatRunningStatus, formatToolLabel, getProgressFrame } from '../../tui/toolPresentation.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface FileEditDetails {
  path?: string
  replacements?: number
  additions?: number
  removals?: number
  diff?: string[]
  diffTruncated?: boolean
  previewNotice?: string
  phase?: 'preparing' | 'writing' | 'complete'
}

export class FileEditToolUI extends Container {
  private args: any
  private executionStarted = false
  private expanded = false
  private elapsedMs = 0
  private result?: ToolResult
  private details?: FileEditDetails
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
    return Boolean(this.details && (this.details.diff || this.details.previewNotice || this.details.diffTruncated))
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

  updateDetails(details: FileEditDetails): void {
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
    const header = `${formatToolLabel(icon, 'edit')}${theme.fg('accent', shortPath)}`

    this.contentBox.clear()

    if (!this.result) {
      if (this.details?.phase === 'preparing') {
        const additions = this.details.additions ?? 0
        const removals = this.details.removals ?? 0
        const summary = renderChangeSummary(additions, removals)
        this.contentBox.addChild(
          new Text(`${header} ${theme.dim('preparing')}\n  ${summary || theme.dim('calculating changes')}`),
        )
        this.appendDiffPreview()
      } else {
        this.contentBox.addChild(new Text(`${header} ${theme.dim(formatRunningStatus(this.elapsedMs))}`))
      }
      return
    }

    if (this.details) {
      const additions = this.details.additions ?? 0
      const removals = this.details.removals ?? 0
      const summary = renderChangeSummary(additions, removals)
      const replacementCount = this.details?.replacements ?? 0
      const replacementText = `${replacementCount} replacement${replacementCount === 1 ? '' : 's'}`
      const lines: string[] = [
        `${header} ${theme.dim(this.executionStarted ? 'writing' : formatCompletedStatus(this.elapsedMs))}`,
        `  ${summary || theme.dim('no line changes')} ${theme.dim(`· ${replacementText}`)}`,
      ]
      this.contentBox.addChild(new Text(lines.join('\n')))
      this.appendDiffPreview()
    } else {
      const output = this.getOutputPreview()
      this.contentBox.addChild(new Text(`${header} ${theme.dim(formatCompletedStatus(this.elapsedMs))}\n  ${theme.fg('muted', output || 'completed with no output')}`))
    }
  }

  private appendDiffPreview(): void {
    if (!this.details || (!this.details.diff && !this.details.previewNotice && !this.details.diffTruncated)) return

    const allDiffLines = this.details.diff ?? []
    const visibleDiffLines = this.expanded ? allDiffLines : allDiffLines.slice(0, 12)
    this.contentBox.addChild(new Text(theme.fg('accent', this.expanded ? '[Collapse preview]' : '[Expand preview]')))
    const diff = visibleDiffLines.map((line) => {
      if (line.startsWith('+')) return theme.fg('success', line)
      if (line.startsWith('-')) return theme.fg('error', line)
      if (line.startsWith('@@')) return theme.fg('accent', line)
      return theme.fg('muted', line)
    })
    if (this.details.previewNotice) {
      diff.push(theme.dim(this.details.previewNotice))
    } else if (this.details.diffTruncated) {
      diff.push(theme.dim('Diff unavailable for files over 1 MB'))
    } else if (allDiffLines.length > visibleDiffLines.length) {
      diff.push(theme.dim(`… ${allDiffLines.length - visibleDiffLines.length} more diff lines`))
    } else if (diff.length === 0) {
      diff.push(theme.dim('No line changes'))
    }
    this.contentBox.addChild(new Text(diff.join('\n')))
  }

  private getOutputPreview(): string {
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.text ?? '').slice(0, 200).replace(/\n/g, ' '))
      .join(' ')
  }
}
