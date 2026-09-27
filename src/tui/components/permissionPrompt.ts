import { Container, SelectList, Text } from '@earendil-works/pi-tui'

/** Modal permission prompt that does not change the chat transcript height. */
export class PermissionPromptOverlay extends Container {
  focused = false

  constructor(
    title: string,
    private readonly choices: SelectList,
  ) {
    super()
    this.addChild(new Text(title, 1, 0))
    this.addChild(choices)
  }

  handleInput(data: string): void {
    this.choices.handleInput(data)
  }
}
