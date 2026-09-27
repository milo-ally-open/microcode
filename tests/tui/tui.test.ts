import { describe, expect, test } from 'bun:test'
import { Fragment, h, jsx, jsxs } from '../../src/tui/jsxFactory.ts'
import { InlineSelectPrompt } from '../../src/tui/components/inlineSelectPrompt.ts'
import { TurnTimeline } from '../../src/tui/components/turnTimeline.ts'
import { getBashModeBorderColor, getEditorTheme, getMarkdownTheme, theme } from '../../src/tui/theme.ts'
import { countContentLines, formatBytes, formatCompletedStatus, formatRunningStatus, getProgressFrame } from '../../src/tui/toolPresentation.ts'
import { SelectList, Text } from '@earendil-works/pi-tui'
import { MicrocodeEditor } from '../../src/tui/components/microcodeEditor.ts'
import { getEditorTheme } from '../../src/tui/theme.ts'

describe('tui modules', () => {
  test('theme helpers return styled strings and editor/markdown contracts', () => {
    expect(theme.fg('unknown', 'text')).toBe('text')
    expect(theme.bold('text')).toContain('text')
    expect(getMarkdownTheme().code('x')).toContain('x')
    expect(getEditorTheme().selectList.noMatch('none')).toContain('none')
    expect(getBashModeBorderColor()('|')).toContain('|')
  })

  test('tool presentation formats durations, bytes, frames, and line counts', () => {
    expect(getProgressFrame(10)).toBe('●')
    expect(formatRunningStatus(1500, 'reading')).toBe('reading · 1.5s')
    expect(formatCompletedStatus(61_000)).toBe('completed · 1m 1s')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(countContentLines('a\nb\n')).toBe(2)
  })

  test('jsx factory creates intrinsic and functional components', () => {
    const text = h('text', null, 'hello')
    const box = h('box', null, text)
    const custom = h((props: any) => h('text', null, props.label), { label: 'custom' })

    expect(text.render(20, 10).join('\n')).toContain('hello')
    expect(box.render(20, 10).join('\n')).toContain('hello')
    expect(custom.render(20, 10).join('\n')).toContain('custom')
    expect(Fragment({}).render(20, 10)).toEqual([])
    expect(jsx).toBe(h)
    expect(jsxs).toBe(h)
  })

  test('inline select prompt stays in the turn and becomes a result after selection', () => {
    const choices = new SelectList([{ value: 'allow', label: 'Allow' }], 1, {
      selectedPrefix: (text) => text,
      selectedText: (text) => text,
      description: (text) => text,
      scrollInfo: (text) => text,
      noMatch: (text) => text,
    })
    const prompt = new InlineSelectPrompt('Question: What should I do?', choices)

    expect(prompt.render(80).join('\n')).toContain('Question: What should I do?')
    expect(prompt.render(80).join('\n')).toContain('Allow')

    prompt.complete('selected answer')
    expect(prompt.render(80).join('\n')).toContain('selected answer')
    prompt.complete('answer')
    expect(prompt.render(80).join('\n')).toContain('answer')
    expect(prompt.render(80).join('\n')).not.toContain('Allow')
  })

  test('turn timeline renders the same component only once', () => {
    const row = new Text('tool completed')
    const timeline = new TurnTimeline()
    timeline.addEntry(new Text('user input'), 'user')
    timeline.addEntry(row, 'tool')
    timeline.addEntry(row, 'tool')

    expect(timeline.render(80).filter((line) => line.includes('tool completed'))).toHaveLength(1)
  })

  test('skill completion opens immediately after $ and updates while typing', async () => {
    const editor = new MicrocodeEditor({ requestRender() {} } as any, getEditorTheme(), { paddingX: 1 })
    editor.setAutocompleteProvider({
      async getSuggestions(lines, cursorLine, cursorCol) {
        const beforeCursor = (lines[cursorLine] ?? '').slice(0, cursorCol)
        const start = beforeCursor.lastIndexOf('$')
        if (start < 0) return null
        const prefix = beforeCursor.slice(start)
        return {
          items: [
            { value: '$note', label: '$note', description: 'Notes skill' },
            { value: '$notes', label: '$notes', description: 'Expanded notes skill' },
          ],
          prefix,
        }
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        const next = [...lines]
        const before = next[cursorLine] ?? ''
        const start = cursorCol - prefix.length
        next[cursorLine] = `${before.slice(0, start)}${item.value} ${before.slice(cursorCol)}`
        return { lines: next, cursorLine, cursorCol: start + item.value.length + 1 }
      },
    })

    editor.handleInput('$')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(editor.isShowingAutocomplete()).toBe(true)

    editor.handleInput('n')
    editor.handleInput('o')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(editor.getText()).toBe('$no')
    expect(editor.isShowingAutocomplete()).toBe(true)

    editor.handleInput('\t')
    expect(editor.getText()).toBe('$note ')
    expect(editor.isShowingAutocomplete()).toBe(false)
  })
})
