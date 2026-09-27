import { describe, expect, test } from 'bun:test'
import { Fragment, h, jsx, jsxs } from '../../src/tui/jsxFactory.ts'
import { PermissionPromptOverlay } from '../../src/tui/components/permissionPrompt.ts'
import { getBashModeBorderColor, getEditorTheme, getMarkdownTheme, theme } from '../../src/tui/theme.ts'
import { countContentLines, formatBytes, formatCompletedStatus, formatRunningStatus, getProgressFrame } from '../../src/tui/toolPresentation.ts'
import { SelectList } from '@earendil-works/pi-tui'

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

  test('permission prompt renders as a standalone selectable overlay', () => {
    const choices = new SelectList([{ value: 'allow', label: 'Allow' }], 1, {
      selectedPrefix: (text) => text,
      selectedText: (text) => text,
      description: (text) => text,
      scrollInfo: (text) => text,
      noMatch: (text) => text,
    })
    const overlay = new PermissionPromptOverlay('Permission requested: run command?', choices)

    expect(overlay.render(80).join('\n')).toContain('Permission requested: run command?')
    expect(overlay.render(80).join('\n')).toContain('Allow')
  })
})
