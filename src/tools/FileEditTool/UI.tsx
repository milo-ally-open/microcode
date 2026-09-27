import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
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
  phase?: 'preparing' | 'writing' | 'complete'
}

export class FileEditToolUI extends Container {
  private args: any
  private executionStarted = false
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

  setExpanded(_expanded: boolean): void {
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
    } else {
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
