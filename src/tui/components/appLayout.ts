import { matchesKey, type Component, visibleWidth } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

const RETURN_TO_BOTTOM_LABEL = 'Return to bottom'
const EXPAND_PREVIEW_LABEL = '[Expand preview]'
const COLLAPSE_PREVIEW_LABEL = '[Collapse preview]'

/** Keeps the prompt/footer fixed while the conversation uses the remaining rows. */
export class AppLayout implements Component {
  private scrollTop: number | undefined
  private lastViewportHeight = 1
  private lastMaxTop = 0
  private returnButtonRow = 0
  private returnButtonStartColumn = 0
  private returnButtonEndColumn = 0
  private toolToggleButtons: Array<{ row: number; startColumn: number; endColumn: number; index: number }> = []

  constructor(
    private readonly header: Component,
    private readonly chat: Component,
    private readonly bottom: Component[],
    private readonly getHeight: () => number,
    private readonly getToolToggleActions: () => Array<() => void> = () => [],
  ) {}

  /** Scroll continuously by rendered chat rows; positive values move toward newer content. */
  scrollBy(delta: number): boolean {
    if (this.lastMaxTop <= 0 || delta === 0) return false
    const currentTop = this.scrollTop ?? this.lastMaxTop
    const nextTop = Math.max(0, Math.min(this.lastMaxTop, currentTop + Math.trunc(delta)))
    if (nextTop === currentTop) return false
    this.scrollTop = nextTop >= this.lastMaxTop ? undefined : nextTop
    return true
  }

  handleInput(data: string, autocompleteVisible = false): boolean {
    if (autocompleteVisible) return false
    if (matchesKey(data, 'pageUp')) return this.scrollBy(-this.lastViewportHeight)
    if (matchesKey(data, 'pageDown')) return this.scrollBy(this.lastViewportHeight)

    const mouse = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/)
    if (!mouse) return false
    const button = Number(mouse[1])
    const column = Number(mouse[2])
    const row = Number(mouse[3])

    if (button === 0 && mouse[4] === 'M') {
      const toggle = this.toolToggleButtons.find((item) =>
        item.row === row && column >= item.startColumn && column <= item.endColumn,
      )
      if (toggle) {
        this.getToolToggleActions()[toggle.index]?.()
        return true
      }

      if (
        this.scrollTop !== undefined && row === this.returnButtonRow &&
        column >= this.returnButtonStartColumn && column <= this.returnButtonEndColumn
      ) {
        this.followLatest()
        return true
      }
    }

    if ((button & 64) !== 0) return this.scrollBy((button & 1) === 0 ? -3 : 3)
    return false
  }

  followLatest(): void {
    this.scrollTop = undefined
  }

  render(width: number): string[] {
    const headerLines = this.header.render(width)
    const chatLines = this.chat.render(width)
    const bottomLines = this.bottom.flatMap((component) => component.render(width))
    const height = Math.max(1, Math.floor(this.getHeight()))
    const chatHeight = Math.max(0, height - headerLines.length - bottomLines.length)
    const showScrollHint = chatHeight > 1 && (chatLines.length > chatHeight || this.scrollTop !== undefined)
    const showReturnButton = showScrollHint && this.scrollTop !== undefined
    this.lastViewportHeight = Math.max(1, chatHeight - (showScrollHint ? 1 : 0))
    const maxTop = Math.max(0, chatLines.length - this.lastViewportHeight)
    this.lastMaxTop = maxTop
    const top = this.scrollTop === undefined ? maxTop : Math.min(this.scrollTop, maxTop)
    if (maxTop === 0) this.scrollTop = undefined
    const visibleChat = chatLines.slice(top, top + this.lastViewportHeight)
    this.toolToggleButtons = []
    let buttonIndex = 0
    for (let chatIndex = 0; chatIndex < chatLines.length; chatIndex++) {
      const line = chatLines[chatIndex] ?? ''
      const label = line.includes(EXPAND_PREVIEW_LABEL)
        ? EXPAND_PREVIEW_LABEL
        : line.includes(COLLAPSE_PREVIEW_LABEL)
          ? COLLAPSE_PREVIEW_LABEL
          : undefined
      if (!label) continue
      if (chatIndex >= top && chatIndex < top + visibleChat.length) {
        const start = line.indexOf(label)
        const startColumn = visibleWidth(line.slice(0, start)) + 1
        this.toolToggleButtons.push({
          row: headerLines.length + chatIndex - top + 1,
          startColumn,
          endColumn: startColumn + visibleWidth(label) - 1,
          index: buttonIndex,
        })
      }
      buttonIndex++
    }
    const controlLine = showReturnButton
      ? theme.fg('accent', `  [ ${RETURN_TO_BOTTOM_LABEL} ]`)
      : showScrollHint
        ? theme.dim('↕ Scroll: mouse wheel · PgUp/PgDn')
        : undefined
    const controlLines = controlLine === undefined ? [] : [controlLine]
    this.returnButtonRow = showReturnButton ? headerLines.length + visibleChat.length + 1 : 0
    this.returnButtonStartColumn = 3
    this.returnButtonEndColumn = 2 + visibleWidth(`[ ${RETURN_TO_BOTTOM_LABEL} ]`)
    const spacerHeight = Math.max(0, height - headerLines.length - controlLines.length - visibleChat.length - bottomLines.length)

    // 对话只占输入区上方的可用行；超出时裁掉顶部旧内容，避免把输入区挤出视口。
    return [
      ...headerLines,
      ...visibleChat,
      ...controlLines,
      ...Array.from({ length: spacerHeight }, () => ''),
      ...bottomLines,
    ]
  }
}
