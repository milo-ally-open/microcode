import { Container, Text, type Component } from '@earendil-works/pi-tui'
import chalk from 'chalk'

type EntryKind = 'user' | 'assistant' | 'tool' | 'status'

interface TimelineEntry {
  component: Component
  kind: EntryKind
}

/** Renders one user turn as a connected vertical activity rail. */
export class TurnTimeline extends Container {
  private entries: TimelineEntry[] = []
  private activity?: Text

  addEntry(component: Component, kind: EntryKind = 'status'): void {
    // Streaming tool updates can revisit the same component. A timeline owns a
    // component once; inserting it twice renders duplicate transcript rows.
    if (this.entries.some((entry) => entry.component === component)) return
    if (this.activity) this.entries.pop()
    this.entries.push({ component, kind })
    if (this.activity) this.entries.push({ component: this.activity, kind: 'status' })
  }

  setActivity(label?: string): void {
    if (!label) {
      if (!this.activity) return
      this.entries = this.entries.filter((entry) => entry.component !== this.activity)
      this.activity = undefined
      return
    }

    if (!this.activity) {
      this.activity = new Text(label, 0, 0)
      this.entries.push({ component: this.activity, kind: 'status' })
      return
    }

    this.activity.setText(label)
  }

  getToolToggleActions(): Array<() => void> {
    return this.entries.flatMap(({ component, kind }) => {
      if (kind !== 'tool') return []
      const tool = component as Component & {
        hasToggleButton?: () => boolean
        toggleExpanded?: () => void
      }
      if (!tool.hasToggleButton?.() || !tool.toggleExpanded) return []
      return [() => tool.toggleExpanded?.()]
    })
  }

  render(width: number): string[] {
    if (this.entries.length === 0) return []

    const connected = this.entries.some((entry) => entry.kind === 'tool')
    if (!connected) {
      return this.entries.flatMap(({ component }) => component.render(width))
    }

    const lines: string[] = []
    const railWidth = 3
    const entryWidth = Math.max(1, width - railWidth)

    for (let entryIndex = 0; entryIndex < this.entries.length; entryIndex++) {
      const entry = this.entries[entryIndex]!
      const entryLines = entry.component.render(entryIndex === 0 ? width : entryWidth)
      if (entryIndex === 0) {
        lines.push(...entryLines)
        continue
      }

      const isLast = entryIndex === this.entries.length - 1
      const branch = isLast ? '└─ ' : '├─ '
      for (let lineIndex = 0; lineIndex < entryLines.length; lineIndex++) {
        const prefix = lineIndex === 0 ? branch : '│  '
        lines.push(chalk.white(prefix) + entryLines[lineIndex]!)
      }
    }

    return lines
  }

  invalidate(): void {
    for (const { component } of this.entries) component.invalidate?.()
  }
}
