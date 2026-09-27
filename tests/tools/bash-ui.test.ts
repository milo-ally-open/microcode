import { describe, expect, test } from 'bun:test'
import { BashToolUI } from '../../src/tools/BashTool/UI.tsx'

describe('BashToolUI', () => {
  test('restores malformed historical output fields without throwing', () => {
    const component = new BashToolUI('tool-call', { command: 'echo test' })
    component.updateDetails({ stdout: 12, stderr: null, output: { old: 'shape' }, exitCode: 0 })

    expect(() => component.render(80)).not.toThrow()
  })
})
