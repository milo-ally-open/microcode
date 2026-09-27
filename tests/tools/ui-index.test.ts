import { describe, expect, test } from 'bun:test'
import '../../src/tools/AskUserQuestionTool/index.ts'
import '../../src/tools/BashTool/index.ts'
import '../../src/tools/FileEditTool/index.ts'
import '../../src/tools/FileReadTool/index.ts'
import '../../src/tools/FileWriteTool/index.ts'
import '../../src/tools/GlobTool/index.ts'
import '../../src/tools/GrepTool/index.ts'
import '../../src/tools/TaskTool/index.ts'
import '../../src/tools/ToolSearchTool/index.ts'
import '../../src/tools/VisionTool/index.ts'
import '../../src/tools/WebFetchTool/index.ts'
import '../../src/tools/WebSearchTool/index.ts'
import { AskUserQuestionToolUI } from '../../src/tools/AskUserQuestionTool/UI.tsx'
import { BashToolUI } from '../../src/tools/BashTool/UI.tsx'
import { FileEditToolUI } from '../../src/tools/FileEditTool/UI.tsx'
import { FileReadToolUI } from '../../src/tools/FileReadTool/UI.tsx'
import { FileWriteToolUI } from '../../src/tools/FileWriteTool/UI.tsx'
import { GlobToolUI } from '../../src/tools/GlobTool/UI.tsx'
import { GrepToolUI } from '../../src/tools/GrepTool/UI.tsx'
import { TaskToolUI } from '../../src/tools/TaskTool/UI.tsx'
import { VisionToolUI } from '../../src/tools/VisionTool/UI.tsx'
import { WebFetchToolUI } from '../../src/tools/WebFetchTool/UI.tsx'
import { WebSearchToolUI } from '../../src/tools/WebSearchTool/UI.tsx'
import { formatToolActivity, formatToolDetail, formatToolStatus, formatToolSummary, getToolDefinition } from '../../src/tools/registry.ts'

function renderText(ui: any): string {
  return ui.render(120, 40).join('\n')
}

function complete(content = 'done', isError = false) {
  return { content: [{ type: 'text', text: content }], isError }
}

describe('tool UI and registration modules', () => {
  test('registered tool index modules expose descriptions, formatters, and UI constructors', () => {
    const read = getToolDefinition('read')!
    expect(read.ui).toBe(FileReadToolUI)
    expect(formatToolActivity('read', { file_path: 'src/a.ts' })).toContain('Reading')
    expect(formatToolDetail('read', { file_path: 'src/a.ts' })).toBe('a.ts')
    expect(formatToolStatus('read', { file_path: 'a' }, { returnedLines: 1, totalLines: 2 })).toBe('1/2 lines')
    expect(formatToolSummary('read', {
      content: [{ type: 'text', text: 'x' }],
      isError: false,
      details: { path: 'a', returnedLines: 1, totalLines: 2, truncated: true },
    })).toContain('truncated')

    expect(getToolDefinition('WebSearch')?.formatDescription?.({ query: 'hello' })).toContain('hello')
    expect(getToolDefinition('grep')?.extractMatchContent?.({ pattern: 'abc' })).toBe('abc')
  })

  test('basic tool UIs render pending, running, success, error, details, and expanded states', () => {
    const cases: Array<{ ui: any; details: Record<string, unknown>; args?: Record<string, unknown> }> = [
      { ui: new BashToolUI('1', { command: 'printf hi', description: 'Say hi' }), details: { stdout: 'hi\n', stderr: '', output: Array.from({ length: 14 }, (_, i) => `line ${i}`).join('\n'), exitCode: 1 }, args: { command: 'echo changed' } },
      { ui: new FileReadToolUI('2', { file_path: '/tmp/a.txt' }), details: { path: '/tmp/a.txt', totalLines: 10, returnedLines: 2, truncated: true } },
      { ui: new FileEditToolUI('3', { file_path: '/tmp/a.txt', old_string: 'a', new_string: 'b' }), details: { path: '/tmp/a.txt', replacements: 1, additions: 1, removals: 1 } },
      { ui: new FileWriteToolUI('4', { file_path: '/tmp/a.txt', content: 'abc' }), details: { path: '/tmp/a.txt', bytesWritten: 3, additions: 1, removals: 0, isNewFile: true, preview: 'abc', written: true } },
      { ui: new GlobToolUI('5', { pattern: '**/*.ts' }), details: { numFiles: 2, filenames: ['a.ts', 'b.ts'], truncated: false, durationMs: 5 } },
      { ui: new GrepToolUI('6', { pattern: 'alpha' }), details: { mode: 'content', numFiles: 1, filenames: ['a.ts'], numLines: 1, numMatches: 1, truncated: false } },
      { ui: new VisionToolUI('7', { image_source: 'image.png' }), details: { source: 'image.png', mimeType: 'image/png', sourceType: 'file' } },
      { ui: new WebFetchToolUI('8', { url: 'https://example.com', prompt: 'read' }), details: { url: 'https://example.com', finalUrl: 'https://example.com/final', bytes: 20, code: 200, codeText: 'OK', contentType: 'text/html', truncated: true, durationMs: 10 } },
      { ui: new WebSearchToolUI('9', { query: 'alpha' }), details: { query: 'alpha', results: [{ title: 'A', url: 'https://a.test' }], durationMs: 10 } },
    ]

    for (const { ui, details, args } of cases) {
      expect(renderText(ui).length).toBeGreaterThan(0)
      ui.markExecutionStarted()
      ui.updateElapsed?.(1500)
      if (args && ui.updateArgs) ui.updateArgs(args)
      ui.updateDetails?.(details)
      ui.updateResult(complete('partial'), true)
      expect(renderText(ui).length).toBeGreaterThan(0)
      ui.setExpanded?.(true)
      ui.updateResult(complete('done'), false)
      expect(renderText(ui)).toContain('✓')
      ui.updateResult(complete('failed', true), false)
      expect(renderText(ui)).toContain('✗')
    }
  })

  test('Ask and Task UIs render special structured states', () => {
    const ask = new AskUserQuestionToolUI('ask', {
      questions: [{
        question: 'Pick?',
        header: 'Pick',
        options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
      }],
    })
    ask.updateDetails({
      questions: [{
        question: 'Pick?',
        header: 'Pick',
        options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
      }],
      answers: { 'Pick?': 'A' },
    })
    ask.updateResult(complete('answered'), false)
    expect(renderText(ask)).toContain('A')

    const task = new TaskToolUI('task', { action: 'write', title: 'Plan' })
    task.updateDetails({
      action: 'write',
      list: {
        id: 'list-1',
        title: 'Plan',
        tasks: [
          { id: 'task-1', content: 'Read', completed: false, pending: false },
          { id: 'task-2', content: 'Write', completed: true, pending: false },
          { id: 'task-3', content: 'Run', completed: false, pending: true },
        ],
      },
    })
    task.updateResult(complete('tasks'), false)
    expect(renderText(task)).toContain('Plan')

    const mark = new TaskToolUI('mark', { action: 'mark', task_id: 'task-1' })
    mark.markExecutionStarted()
    expect(renderText(mark)).toContain('Updating')
    mark.updateResult(complete('Validation failed for tool "task":\n- task_id: required', true), false)
    expect(renderText(mark)).toContain('incomplete')

    const claim = new TaskToolUI('claim', { action: 'claim' })
    claim.updateDetails({
      action: 'claim',
      list: { id: 'list-2', title: 'Empty', tasks: [] },
    })
    claim.updateResult(complete('empty'), false)
    expect(renderText(claim)).toContain('All tasks are complete')
  })
})
