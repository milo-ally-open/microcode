/** Microcode 的横向宽字形；面体统一为 6×4，阴影单独落在基线下方。 */
const GLYPHS: Record<string, readonly string[]> = {
  M: ['█    █', '██  ██', '█ ██ █', '█    █'],
  I: ['██████', '  ██  ', '  ██  ', '██████'],
  C: [' █████', '██    ', '██    ', ' █████'],
  R: ['█████ ', '██  ██', '█████ ', '██  ██'],
  O: [' ████ ', '██  ██', '██  ██', ' ████ '],
  D: ['█████ ', '██  ██', '██  ██', '█████ '],
  // 标准大写 E：完整上下横、明显较短的中横，避免被读成 F 或 C。
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

const WORD_GLYPHS = [...'MICROCODE'].map((letter) => GLYPHS[letter]!)

// 阴影独立画在所有字形下方，不再逐行覆盖字腔；这让 E 等开口字母保持清楚。
const WORDMARK_FACE = Array.from({ length: 4 }, (_, row) =>
  WORD_GLYPHS.map((glyph) => glyph[row]!.padEnd(7)).join(' '),
)
const WORDMARK_BASE_SHADOW = WORD_GLYPHS.map((glyph) => {
  const cells = Array<string>(7).fill(' ')
  for (let column = 0; column < 6; column++) {
    if (glyph[3]![column] === '█') cells[column + 1] = '▓'
  }
  return cells.join('')
}).join(' ')

export const LOGO_LINES = [...WORDMARK_FACE, WORDMARK_BASE_SHADOW]

export const COMPACT_LOGO_LINES = Array.from({ length: 4 }, (_, row) =>
  [...'MICROCODE'].map((letter) => COMPACT_GLYPHS[letter]![row]).join(' '),
)
