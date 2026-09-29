/** Microcode 的 5×7 Unicode 方块字形；额外一格右下偏移模拟像素挤出阴影。 */
const GLYPHS: Record<string, readonly string[]> = {
  M: ['█   █', '██ ██', '█ █ █', '█ █ █', '█   █', '█   █', '█   █'],
  I: ['█████', '█████', '  █  ', '  █  ', '  █  ', '█████', '█████'],
  C: [' ████', ' ████', '█    ', '█    ', '█    ', ' ████', ' ████'],
  R: ['████ ', '████ ', '█   █', '████ ', '████ ', '█ █  ', '█  ██'],
  O: [' ███ ', ' ███ ', '█   █', '█   █', '█   █', ' ███ ', ' ███ '],
  D: ['████ ', '████ ', '█   █', '█   █', '█   █', '████ ', '████ '],
  E: ['█████', '█████', '█    ', '████ ', '████ ', '█    ', '█████'],
}

function extrudeGlyph(glyph: readonly string[]): string[] {
  return Array.from({ length: 8 }, (_, row) => {
    const cells = Array<string>(6).fill(' ')
    if (row > 0) {
      for (let column = 0; column < 5; column++) {
        if (glyph[row - 1]![column] === '█') cells[column + 1] = '▓'
      }
    }
    if (row < 7) {
      for (let column = 0; column < 5; column++) {
        if (glyph[row]![column] === '█') cells[column] = '█'
      }
    }
    return cells.join('')
  })
}

const WORD_GLYPHS = [...'MICROCODE'].map((letter) => extrudeGlyph(GLYPHS[letter]!))

export const LOGO_LINES = Array.from({ length: 8 }, (_, row) =>
  WORD_GLYPHS.map((glyph) => glyph[row]!).join(' '),
)

export const COMPACT_LOGO_LINES = Array.from({ length: 7 }, (_, row) =>
  [...'MICROCODE'].map((letter) => GLYPHS[letter]![row]).join(' '),
)
