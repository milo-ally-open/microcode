/** Microcode 的 5×5 Unicode 方块像素字标，宽度适配常见终端。 */
const GLYPHS: Record<string, readonly string[]> = {
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  R: ['████ ', '█   █', '████ ', '█ █  ', '█  ██'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
}

export const LOGO_LINES = Array.from({ length: 5 }, (_, row) =>
  [...'MICROCODE'].map((letter) => GLYPHS[letter]![row]).join(' '),
)
