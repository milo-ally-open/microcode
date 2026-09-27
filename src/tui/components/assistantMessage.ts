import { Container, type MarkdownTheme } from '@earendil-works/pi-tui'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { getMarkdownTheme, theme } from '../theme.ts'
import { ThinkingBlock } from './thinkingBlock.ts'
import { MarkedMarkdown } from './markedMarkdown.ts'

type BlockComponent = { type: 'text'; component: MarkedMarkdown } | { type: 'thinking'; component: ThinkingBlock }

/**
 * Component that renders an assistant message with Markdown formatting and thinking blocks.
 * Supports streaming updates via updateContent().
 */
export class AssistantMessageComponent extends Container {
  private blockComponents: BlockComponent[] = []
  private markdownTheme: MarkdownTheme
  private lastText = ''
  private hasText = false
  private lastBlockSignature = ''

  constructor(markdownTheme: MarkdownTheme = getMarkdownTheme()) {
    super()
    this.markdownTheme = markdownTheme
  }

  updateContent(message: AssistantMessage): void {
    const blocks = message.content
    const textBlocks = blocks.filter((c) => c.type === 'text')
    const text = textBlocks.map((c) => c.text).join('')
    this.hasText = text.trim().length > 0

    // Build a signature that captures block types and whether text blocks have content.
    // This ensures we rebuild when a text block transitions from empty to non-empty
    // (e.g. when thinking finishes and the answer starts streaming).
    const signature = blocks
      .map((b) => b.type === 'text' ? `text:${b.text.length > 0 ? '1' : '0'}` : b.type)
      .join(',')

    if (signature !== this.lastBlockSignature) {
      this.lastBlockSignature = signature
      this.clear()
      this.blockComponents = []
      for (const block of blocks) {
        if (block.type === 'text') {
          const md = new MarkedMarkdown(
            block.text.trim() ? block.text : ' ',
            theme.fg('muted', '• '),
            0,
            this.markdownTheme,
          )
          this.addChild(md)
          this.blockComponents.push({ type: 'text', component: md })
        } else if (block.type === 'thinking') {
          const tb = new ThinkingBlock()
          tb.update(this.hasText)
          this.addChild(tb)
          this.blockComponents.push({ type: 'thinking', component: tb })
        }
      }

      this.lastText = text
      return
    }

    // Signature unchanged — update the last block's content for streaming
    if (text !== this.lastText) {
      const lastTextBlock = [...blocks].reverse().find((block) => block.type === 'text')
      const lastTextComponent = [...this.blockComponents]
        .reverse()
        .find((block) => block.type === 'text')

      if (lastTextBlock?.type === 'text' && lastTextComponent?.type === 'text') {
        lastTextComponent.component.setText(lastTextBlock.text.trim() ? lastTextBlock.text : ' ')
      }

      this.lastText = text
    }

    for (const blockComponent of this.blockComponents) {
      if (blockComponent.type === 'thinking') blockComponent.component.update(this.hasText)
    }
  }

  getText(): string {
    return this.lastText
  }
}
