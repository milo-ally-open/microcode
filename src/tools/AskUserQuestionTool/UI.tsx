import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import { formatToolLabel } from '../../tui/toolPresentation.ts'

import type { ToolUIComponent, ToolResult } from '../registry.ts'

interface AskUserQuestionDetails {
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect?: boolean
  }>
  answers: Record<string, string>
}

export class AskUserQuestionToolUI extends Container implements ToolUIComponent {
  private args: any
  private executionStarted = false
  private result?: ToolResult
  private details?: AskUserQuestionDetails
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

  updateResult(result: ToolResult, isPartial = false): void {
    this.result = result
    if (!isPartial) {
      this.executionStarted = false
    }
    this.rebuild()
  }

  updateDetails(details: Record<string, unknown>): void {
    this.details = details as unknown as AskUserQuestionDetails
    this.rebuild()
  }

  private rebuild(): void {
    const icon =
      this.result && !this.executionStarted
        ? this.result.isError
          ? theme.fg('error', '✗')
          : theme.fg('success', '✓')
        : theme.dim('○')

    this.contentBox.clear()

    const questions = this.details?.questions ?? this.args?.questions ?? []
    const answers = this.details?.answers ?? {}

    if (questions.length === 0) {
      this.contentBox.addChild(
        new Text(`${formatToolLabel(icon, 'Ask')}${theme.dim('(no questions)')}`),
      )
      return
    }

    const count = `${questions.length} question${questions.length > 1 ? 's' : ''}`
    const header = `${formatToolLabel(icon, 'Ask')}${theme.dim(count)}`
    const lines: string[] = [header]

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const answer = answers[q.question]
      const tag = theme.fg('accent', q.header)
      const qText = theme.fg('text', q.question)
      const answerText = answer
        ? theme.fg('success', answer)
        : theme.dim('(no answer)')
      lines.push(`  ${tag} ${qText}`)
      lines.push(`    → ${answerText}`)
    }

    this.contentBox.addChild(new Text(lines.join('\n')))
  }
}
