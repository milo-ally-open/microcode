/** Microcode 的横向宽字形；6×5 实心像素面体，为横画之间保留真实间隙。 */
const GLYPHS: Record<string, readonly string[]> = {
  M: ['█    █', '██  ██', '█ ██ █', '█    █', '█    █'],
  I: ['██████', '  ██  ', '  ██  ', '  ██  ', '██████'],
  C: [' █████', '██    ', '██    ', '██    ', ' █████'],
  R: ['█████ ', '██  ██', '█████ ', '██ ██ ', '██  ██'],
  O: [' ████ ', '██  ██', '██  ██', '██  ██', ' ████ '],
  D: ['█████ ', '██  ██', '██  ██', '██  ██', '█████ '],
  // E 使用五行：上下横之间各留一行，让三条横画在终端字高下仍彼此分离。
  E: ['██████', '██    ', '████  ', '██    ', '██████'],
}

const COMPACT_GLYPHS: Record<string, readonly string[]> = {
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
}

const WORD_GLYPHS = [...'MICROCODE'].map((letter) => GLYPHS[letter]!)

// 先完整绘制所有字形面体。像素字直接保持纯色，避免底影被误读成额外横画。
const WORDMARK_FACE = Array.from({ length: 5 }, (_, row) =>
  WORD_GLYPHS.map((glyph) => glyph[row]!.padEnd(7)).join(' '),
)

export const LOGO_LINES = WORDMARK_FACE

export const COMPACT_LOGO_LINES = Array.from({ length: 5 }, (_, row) =>
  [...'MICROCODE'].map((letter) => COMPACT_GLYPHS[letter]![row]).join(' '),
)
