import { describe, expect, test } from 'bun:test'
import { Fragment, h, jsx, jsxs } from '../../src/tui/jsxFactory.ts'
import { InlineSelectPrompt } from '../../src/tui/components/inlineSelectPrompt.ts'
import { AppLayout } from '../../src/tui/components/appLayout.ts'
import { TurnTimeline } from '../../src/tui/components/turnTimeline.ts'
import { getBashModeBorderColor, getEditorTheme, getMarkdownTheme, theme } from '../../src/tui/theme.ts'
import { countContentLines, formatBytes, formatCompletedStatus, formatRunningStatus, getProgressFrame } from '../../src/tui/toolPresentation.ts'
import { Container, SelectList, Text, type Component } from '@earendil-works/pi-tui'
import { App } from '../../src/tui/app.ts'
import { autocompleteMaxVisibleForHeight, MicrocodeEditor } from '../../src/tui/components/microcodeEditor.ts'
import { AssistantMessageComponent } from '../../src/tui/components/assistantMessage.ts'
import { getEditorTheme } from '../../src/tui/theme.ts'
import { createSessionTitle, firstSentence, normalizeSessionTitle } from '../../src/tui/sessionTitle.ts'
import { parseBashInput } from '../../src/tui/bashInput.ts'
import { shouldShowRespondingActivity } from '../../src/tui/agentActivity.ts'
import { COMPACT_LOGO_LINES, LOGO_LINES } from '../../src/tui/logo.ts'
import { WelcomeBanner } from '../../src/tui/components/welcomeBanner.ts'

describe('tui modules', () => {
  test('startup logo is a compact Unicode pixel wordmark', () => {
    expect(LOGO_LINES).toHaveLength(5)
    expect(LOGO_LINES.some((line) => line.includes('█'))).toBe(true)
    expect(LOGO_LINES.every((line) => line.length === 71)).toBe(true)
    expect(LOGO_LINES.some((line) => line.includes('▓'))).toBe(true)
    // E 必须有完整上、下横和明显较短的中横；阴影不能侵入字形。
    expect(LOGO_LINES[1]!.slice(64, 70)).toBe('██    ')
    expect(LOGO_LINES[2]!.slice(64, 70)).toBe('████  ')
    expect(LOGO_LINES[3]!.slice(64, 70)).toBe('██████')
    expect(LOGO_LINES[4]!.slice(64, 71)).toBe(' ▓▓▓▓▓▓')
    expect(COMPACT_LOGO_LINES[3]!.slice(-5)).toBe('█████')
  })

  test('welcome banner frames the logo and adapts to narrower terminals', () => {
    const banner = new WelcomeBanner()
    const wide = banner.render(80)
    expect(wide[0]).toContain('╭')
    expect(wide.join('\n')).toContain('long-running sessions')
    expect(wide.every((line) => line.replace(/\u001b\[[0-9;]*m/g, '').length === 80)).toBe(true)

    const narrow = banner.render(60)
    expect(narrow.join('\n')).toContain('Agentic coding assistant')
    expect(narrow.every((line) => line.replace(/\u001b\[[0-9;]*m/g, '').length === 60)).toBe(true)

    const compact = banner.render(40)
    expect(compact.every((line) => line.replace(/\u001b\[[0-9;]*m/g, '').length === 40)).toBe(true)
  })

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

  test('session titles stay on one line and are limited by character count', () => {
    expect(firstSentence('Fix the parser. Then add tests.')).toBe('Fix the parser.')
    expect(firstSentence('修复解析器。然后补测试。')).toBe('修复解析器。')
    expect(normalizeSessionTitle('Useful title\nextra line')).toBe('Useful title')
    const longTitle = normalizeSessionTitle('界'.repeat(70))
    expect(Array.from(longTitle)).toHaveLength(60)
    expect(longTitle.endsWith('...')).toBe(true)
  })

  test('session title generation uses the opening sentence and falls back to clipped input', async () => {
    let requestedSeed = ''
    const generated = await createSessionTitle('Fix parser errors. Add tests after.', async (seed) => {
      requestedSeed = seed
      return 'Parser error fix'
    })
    expect(requestedSeed).toBe('Fix parser errors.')
    expect(generated).toBe('Parser error fix')

    const fallback = await createSessionTitle('界'.repeat(70), async () => {
      throw new Error('title provider unavailable')
    })
    expect(Array.from(fallback)).toHaveLength(60)
    expect(fallback.endsWith('...')).toBe(true)
  })

  test('bash input distinguishes normal, excluded, empty, and ordinary prompts', () => {
    expect(parseBashInput('! pwd')).toEqual({ command: 'pwd', excludeFromContext: false })
    expect(parseBashInput('!! git status')).toEqual({ command: 'git status', excludeFromContext: true })
    expect(parseBashInput('!')).toEqual({ command: '', excludeFromContext: false })
    expect(parseBashInput('hello')).toBeNull()
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

  test('startup resume renders restored messages immediately like session switching', () => {
    const messages = [
      { role: 'user', content: 'restored question', timestamp: 1 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: 'restored answer' },
        ],
        stopReason: 'stop',
        timestamp: 2,
      },
    ] as any[]
    const app = Object.create(App.prototype) as any
    let requestedRender = false
    let followedLatest = false
    Object.assign(app, {
      agent: { getMessages: () => messages },
      chatContainer: new Container(),
      toolRows: new Map(),
      pendingTools: new Map(),
      appLayout: { followLatest: () => { followedLatest = true } },
      footer: { invalidate() {} },
      ui: { requestRender: () => { requestedRender = true } },
      activeTurnTimeline: undefined,
      turnFinalized: false,
    })

    app.restoreInitialSessionHistory()

    const rendered = app.chatContainer.render(100).join('\n')
    expect(rendered).toContain('restored question')
    expect(rendered).toContain('restored answer')
    expect(rendered).toContain('Analysis complete')
    expect(rendered).not.toContain('Analyzing…')
    expect(followedLatest).toBe(true)
    expect(requestedRender).toBe(true)
  })

  test('app layout keeps the editor and footer anchored while chat output grows', () => {
    const header: Component = { render: () => ['header'] }
    const chat: Component = { render: () => Array.from({ length: 20 }, (_, index) => `chat ${index}`) }
    const editor: Component = { render: () => ['editor'] }
    const footer: Component = { render: () => ['footer'] }
    const layout = new AppLayout(header, chat, [editor, footer], () => 8)

    const lines = layout.render(80)
    expect(lines).toHaveLength(8)
    expect(lines[0]).toBe('header')
    expect(lines.at(-2)).toBe('editor')
    expect(lines.at(-1)).toBe('footer')
    expect(lines.some((line) => line.includes('chat 19'))).toBe(true)
    expect(lines).not.toContain('chat 0')
  })

  test('chat viewport pages through history and pauses following until returning to latest', () => {
    let chatLines = Array.from({ length: 12 }, (_, index) => `chat ${index}`)
    const header: Component = { render: () => ['header'] }
    const chat: Component = { render: () => chatLines }
    const bottom: Component = { render: () => ['editor', 'footer'] }
    const layout = new AppLayout(header, chat, [bottom], () => 8)

    let lines = layout.render(80)
    expect(lines.some((line) => line.includes('chat 11'))).toBe(true)
    expect(lines.some((line) => line.includes('↕ Scroll: mouse wheel · PgUp/PgDn'))).toBe(true)
    expect(layout.handleScrollInput('\x1b[5~')).toBe(true)
    lines = layout.render(80)
    expect(lines.some((line) => line.includes('Return to bottom'))).toBe(true)
    expect(lines.some((line) => line.includes('chat 4'))).toBe(true)

    chatLines = [...chatLines, 'chat 12', 'chat 13']
    lines = layout.render(80)
    expect(lines.some((line) => line.includes('chat 4'))).toBe(true)
    expect(lines.some((line) => line.includes('chat 13'))).toBe(false)

    expect(layout.handleScrollInput('\x1b[6~')).toBe(true)
    expect(layout.handleScrollInput('\x1b[6~')).toBe(true)
    lines = layout.render(80)
    expect(lines.some((line) => line.includes('chat 13'))).toBe(true)
    expect(lines.some((line) => line.includes('↕ Scroll: mouse wheel · PgUp/PgDn'))).toBe(true)
    expect(layout.handleScrollInput('\x1b[5~', true)).toBe(false)
  })

  test('chat viewport scrolls with the mouse wheel and returns to latest from its button', () => {
    const chatLines = Array.from({ length: 12 }, (_, index) => `chat ${index}`)
    const layout = new AppLayout(
      { render: () => ['header'] },
      { render: () => chatLines },
      [{ render: () => ['editor', 'footer'] }],
      () => 8,
    )
    layout.render(80)

    // Wheel-up/down moves by a few lines, not a full page.
    expect(layout.handleScrollInput('\x1b[<64;40;4M')).toBe(true)
    expect(layout.render(80).some((line) => line.includes('chat 5'))).toBe(true)

    // Clicks outside the return button remain ignored.
    expect(layout.handleScrollInput('\x1b[<0;80;3M')).toBe(false)
    expect(layout.render(80).some((line) => line.includes('chat 5'))).toBe(true)

    // The button is rendered on row 6; clicking it returns to the newest output.
    expect(layout.handleScrollInput('\x1b[<0;10;6M')).toBe(true)
    const latestLines = layout.render(80)
    expect(latestLines.some((line) => line.includes('chat 11'))).toBe(true)
    expect(latestLines.some((line) => line.includes('Return to bottom'))).toBe(false)

    expect(layout.handleScrollInput('\x1b[<64;40;4M')).toBe(true)
    expect(layout.handleScrollInput('\x1b[<65;40;4M')).toBe(true)
    expect(layout.render(80).some((line) => line.includes('chat 11'))).toBe(true)
    expect(layout.handleScrollInput('\x1b[<0;80;6m')).toBe(false)
    expect(layout.handleScrollInput('\x1b[<64;40;4M', true)).toBe(false)
  })

  test('autocomplete uses available terminal height up to the list limit', () => {
    expect(autocompleteMaxVisibleForHeight(24)).toBe(10)
    expect(autocompleteMaxVisibleForHeight(60)).toBe(20)
    expect(autocompleteMaxVisibleForHeight(12)).toBe(3)
  })

  test('assistant thinking status completes when the message ends without answer text', () => {
    const assistant = new AssistantMessageComponent(getMarkdownTheme())
    assistant.updateContent({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'internal reasoning' }],
    } as any)

    expect(assistant.render(80).join('\n')).toContain('Analyzing…')

    assistant.finish()

    const rendered = assistant.render(80).join('\n')
    expect(rendered).toContain('Analysis complete')
    expect(rendered).not.toContain('Analyzing…')
  })

  test('assistant activity switches to responding on visible text, but not during tool work', () => {
    expect(shouldShowRespondingActivity(true, 0, 'Thinking…')).toBe(true)
    expect(shouldShowRespondingActivity(false, 0, 'Thinking…')).toBe(false)
    expect(shouldShowRespondingActivity(true, 1, 'Running tools…')).toBe(false)
    expect(shouldShowRespondingActivity(true, 0, 'Responding…')).toBe(false)
  })

  test('skill completion opens immediately after $ and updates while typing', async () => {
    const editor = new MicrocodeEditor({ requestRender() {}, terminal: { rows: 24 } } as any, getEditorTheme(), { paddingX: 1 })
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
    const rendered = editor.render(80)
    const suggestionIndex = rendered.findIndex((line) => line.includes('$note'))
    const inputIndex = rendered.findIndex((line) => line.includes('$') && !line.includes('$note') && !line.includes('$notes'))
    expect(suggestionIndex).toBeGreaterThanOrEqual(0)
    expect(inputIndex).toBeGreaterThan(suggestionIndex)

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
