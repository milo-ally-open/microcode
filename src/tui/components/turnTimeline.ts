import { Container, Text, type Component } from '@earendil-works/pi-tui'
import chalk from 'chalk'

/** Renders one user turn as a connected vertical activity rail. */
export class TurnTimeline extends Container {
  private entries: Component[] = []
  private activity?: Text

  addEntry(component: Component): void {
    if (this.activity) this.entries.pop()
    this.entries.push(component)
    if (this.activity) this.entries.push(this.activity)
  }

  setActivity(label?: string): void {
    if (!label) {
      if (!this.activity) return
      this.entries = this.entries.filter((entry) => entry !== this.activity)
      this.activity = undefined
      return
    }

    if (!this.activity) {
      this.activity = new Text(label, 1, 0)
      this.entries.push(this.activity)
      return
    }

    this.activity.setText(label)
  }

  render(width: number): string[] {
    if (this.entries.length === 0) return []

    const lines: string[] = []
    const railWidth = 3
    const entryWidth = Math.max(1, width - railWidth)

    for (let entryIndex = 0; entryIndex < this.entries.length; entryIndex++) {
      const entry = this.entries[entryIndex]!
      const entryLines = entry.render(entryIndex === 0 ? width : entryWidth)
      if (entryIndex === 0) {
        lines.push(...entryLines)
        continue
      }

      const isLast = entryIndex === this.entries.length - 1
      const branch = isLast ? '└─ ' : '├─ '
      for (let lineIndex = 0; lineIndex < entryLines.length; lineIndex++) {
        const prefix = lineIndex === 0 ? branch : '│  '
        const color = chalk.hex('#5f87ff')
        lines.push(color(prefix) + entryLines[lineIndex]!)
      }
    }

    return lines
  }

  invalidate(): void {
    for (const entry of this.entries) entry.invalidate?.()
  }
}
