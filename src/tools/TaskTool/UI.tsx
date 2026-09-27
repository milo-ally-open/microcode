import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import type { TaskList } from '../../tasks/TaskSystem.ts'
import type { ToolResult, ToolUIComponent } from '../registry.ts'

interface TaskToolDetails {
  action: 'write' | 'claim' | 'mark' | 'mark_batch'
  list: TaskList
}

interface DisplayTask {
  content: string
  completed: boolean
}

export class TaskToolUI extends Container implements ToolUIComponent {
  private args: any
  private result?: ToolResult
  private details?: TaskToolDetails
  private executionStarted = false
  private readonly contentBox: Box

  constructor(_toolCallId: string, args: any) {
    super()
    this.args = args
    this.contentBox = new Box(2, 0)
    this.addChild(this.contentBox)
    this.rebuild()
  }

  setExpanded(_expanded: boolean): void {}

  markExecutionStarted(): void {
    this.executionStarted = true
    this.rebuild()
  }

  updateArgs(args: Record<string, unknown>): void {
    this.args = args
    this.rebuild()
  }

  updateElapsed(_elapsedMs: number): void {}

  updateResult(result: ToolResult, isPartial = false): void {
    this.result = result
    if (!isPartial) this.executionStarted = false
    this.rebuild()
  }

  updateDetails(details: Record<string, unknown>): void {
    this.details = details as unknown as TaskToolDetails
    this.rebuild()
  }

  private rebuild(): void {
    this.contentBox.clear()

    if (this.result?.isError) {
      this.renderError()
      return
    }


    const action = this.details?.action ?? this.args?.action
    const list = this.details?.list

    if ((action === 'mark' || action === 'mark_batch') && !list) {
      const taskId = typeof this.args?.task_id === 'string'
        ? this.args.task_id
        : action === 'mark_batch' && Array.isArray(this.args?.tasks)
          ? `${this.args.tasks.length} tasks`
          : 'task'
      const state = this.executionStarted ? 'Updating' : 'Updated'
      this.contentBox.addChild(
        new Text(
          `${theme.fg('accent', '◆')} ${chalk.bold('Tasks')}  ${theme.dim(`${state} ${taskId}…`)}`,
        ),
      )
      return
    }

    const title = list?.title ?? this.args?.title ?? 'Task list'
    const tasks = list?.tasks ?? this.tasksFromArgs()
    const completedCount = tasks.filter((task) => task.completed).length
    const progress = tasks.length > 0
      ? theme.dim(`${completedCount}/${tasks.length} complete`)
      : theme.dim('No tasks')
    const heading = action === 'claim' ? 'Next tasks' : 'Tasks'
    const lines = [
      `${theme.fg('accent', '◆')} ${chalk.bold(heading)}  ${theme.fg('accent', title)}  ${progress}`,
    ]

    if (action === 'claim') {
      if (tasks.length === 0) {
        lines.push(`  ${theme.fg('success', '✓')} ${theme.dim('All tasks are complete')}`)
      } else {
        for (const task of tasks) {
          lines.push(`  ${theme.fg('accent', '→')} ${theme.fg('text', task.content)}`)
        }
      }
    } else {
      for (const task of tasks) {
        const marker = task.completed
          ? theme.fg('success', '✓')
          : theme.dim('○')
        const content = task.completed
          ? theme.dim(task.content)
          : theme.fg('text', task.content)
        lines.push(`  ${marker} ${content}`)
      }
    }

    this.contentBox.addChild(new Text(lines.join('\n')))
  }

  private renderError(): void {
    this.contentBox.addChild(
      new Text([
        `${theme.fg('error', '!')} ${chalk.bold('Tasks')}  ${theme.fg('error', 'Could not update task list')}`,
        `  ${theme.fg('muted', this.errorSummary())}`,
      ].join('\n')),
    )
  }

  private errorSummary(): string {
    const error = this.result?.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('\n')
      .trim() ?? ''
    if (!error) return 'The task operation failed.'
    if (error.includes('Validation failed for tool')) {
      return 'The task request was incomplete or used an unsupported field.'
    }
    const firstLine = error.split('\n').find((line) => line.trim())?.trim()
    if (!firstLine) return 'The task operation failed.'
    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
  }

  private tasksFromArgs(): DisplayTask[] {
    if (this.args?.action === 'write' && Array.isArray(this.args.tasks)) {
      return this.args.tasks.map((task: unknown) => {
        if (typeof task === 'string') {
          return { content: task, completed: false }
        }
        if (task && typeof task === 'object') {
          const value = task as Record<string, unknown>
          return {
            content: typeof value.content === 'string'
              ? value.content
              : '(task content pending)',
            completed: value.status === 'completed',
          }
        }
        return { content: String(task), completed: false }
      })
    }
    return []
  }
}
