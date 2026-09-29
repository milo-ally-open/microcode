/** Microcode 的横向宽字形；面体 6×4，额外一格右下偏移模拟挤出阴影。 */
const GLYPHS: Record<string, readonly string[]> = {
  M: ['█    █', '██  ██', '█ ██ █', '█    █'],
  I: ['██████', '  ██  ', '  ██  ', '██████'],
  C: [' █████', '██    ', '██    ', ' █████'],
  R: ['█████ ', '██  ██', '█████ ', '██  ██'],
  O: [' ████ ', '██  ██', '██  ██', ' ████ '],
  D: ['█████ ', '██  ██', '██  ██', '█████ '],
  // 上下横都完整、中横明显收短，保持标准大写 E 的轮廓。
  E: ['██████', '██    ', '████  ', '██████'],
}

const COMPACT_GLYPHS: Record<string, readonly string[]> = {
  M: ['█   █', '██ ██', '█ █ █', '█   █'],
  I: ['█████', '  █  ', '  █  ', '█████'],
  C: [' ████', '█    ', '█    ', ' ████'],
  R: ['████ ', '█   █', '████ ', '█  ██'],
  O: [' ███ ', '█   █', '█   █', ' ███ '],
  D: ['████ ', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█████'],
}

function extrudeGlyph(glyph: readonly string[], shadowStyle: 'full' | 'base' = 'full'): string[] {
  return Array.from({ length: 5 }, (_, row) => {
    const cells = Array<string>(7).fill(' ')
    // E 的完整底横负责识别；阴影只落在它下方，避免把横画间的负空间填满。
    const showShadow = row > 0 && (shadowStyle === 'full' || row === glyph.length)
    if (showShadow) {
      for (let column = 0; column < 6; column++) {
        if (glyph[row - 1]![column] === '█') cells[column + 1] = '▓'
      }
    }
    if (row < 4) {
      for (let column = 0; column < 6; column++) {
        if (glyph[row]![column] === '█') cells[column] = '█'
      }
    }
    return cells.join('')
  })
}

const WORD_GLYPHS = [...'MICROCODE'].map((letter) =>
  extrudeGlyph(GLYPHS[letter]!, letter === 'E' ? 'base' : 'full'),
)

export const LOGO_LINES = Array.from({ length: 5 }, (_, row) =>
  WORD_GLYPHS.map((glyph) => glyph[row]!).join(' '),
)

export const COMPACT_LOGO_LINES = Array.from({ length: 4 }, (_, row) =>
  [...'MICROCODE'].map((letter) => COMPACT_GLYPHS[letter]![row]).join(' '),
)
