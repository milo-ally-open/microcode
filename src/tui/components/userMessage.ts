import { Container, Text } from '@earendil-works/pi-tui'
import { theme, getMarkdownTheme } from '../theme.ts'
import type { ImageContent } from '@earendil-works/pi-ai'
import { Markdown } from './markdown.ts'

/**
 * Component that renders a user message as the start of a conversation turn.
 */
export class UserMessage extends Container {
  constructor(text: string, images?: ImageContent[]) {
    super()
    this.addChild(new Text(theme.fg('muted', 'You'), 1, 0))
    this.addChild(
      new Markdown(text, 0, 0, getMarkdownTheme(), {
        color: (content: string) => theme.fg('text', content),
      }),
    )
    if (images && images.length > 0) {
      for (const img of images) {
        this.addChild(new Text(theme.dim(`  [Image: ${img.mimeType}]`), 2, 0))
      }
    }
  }
}
