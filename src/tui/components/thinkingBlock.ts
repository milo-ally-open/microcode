import { Container, Text } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

/** Shows a concise reasoning activity status without rendering raw thinking text. */
export class ThinkingBlock extends Container {
  private status: Text
  private complete?: boolean

  constructor() {
    super()
    this.status = new Text('', 1, 0)
    this.addChild(this.status)
    this.update(false)
  }

  update(complete: boolean): void {
    if (complete === this.complete && this.status) return
    this.complete = complete
    const label = complete ? 'Analysis complete' : 'Analyzing…'
    this.status.setText(theme.fg('muted', `• ${label}`))
  }
}
