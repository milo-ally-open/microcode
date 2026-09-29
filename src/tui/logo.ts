/** Microcode 的横向宽字形；6×4 实心像素面体，不叠加会混淆笔画的逐字底影。 */
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

// 先完整绘制所有字形面体。像素字直接保持纯色，避免底影被误读成额外横画。
const WORDMARK_FACE = Array.from({ length: 4 }, (_, row) =>
  WORD_GLYPHS.map((glyph) => glyph[row]!.padEnd(7)).join(' '),
)

export const LOGO_LINES = WORDMARK_FACE

export const COMPACT_LOGO_LINES = Array.from({ length: 4 }, (_, row) =>
  [...'MICROCODE'].map((letter) => COMPACT_GLYPHS[letter]![row]).join(' '),
)
