import { Editor, type EditorOptions, type EditorTheme, type TUI } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { highlightSkillMentions, isSkillAutocompleteContext } from '../skillMentions.ts'
import { highlightWorkspaceFileMentions } from '../workspaceFiles.ts'

/**
 * Editor subclass that adds app-level key handlers for Microcode.
 * Handles Escape, Ctrl+C, Ctrl+D before the base Editor processes them,
 * while letting the Editor handle everything else (cursor, history, undo, autocomplete).
 */
export class MicrocodeEditor extends Editor {
  public onEscape?: () => void
  public onCtrlC?: () => void
  public onCtrlD?: () => void
  public onCtrlO?: () => void
  public onPasteImage?: () => void

  constructor(tui: TUI, theme: EditorTheme, options?: EditorOptions) {
    super(tui, theme, options)
  }

  render(width: number): string[] {
    const lines = super.render(width)
    if (this.isShowingAutocomplete()) return lines
    return lines.map((line) => highlightWorkspaceFileMentions(
      highlightSkillMentions(line, (mention) => chalk.hex('#ff79c6').bold(mention)),
      (mention) => chalk.hex('#00d7ff').bold(mention),
    ))
  }

  handleInput(data: string): void {
    // Ctrl+V and Shift+Insert are common terminal clipboard paste shortcuts.
    // Image-only clipboard data has no text sequence for the Editor to paste.
    if (data === '\x16' || data === '\x1b[2~' || data === '\x1b[2;2~') {
      this.onPasteImage?.()
      return
    }
    if (this.handleAppShortcuts(data)) return

    const mayExtendSkillMention = data === '$' || /^[a-z0-9-]$/i.test(data) || data === '\x7f' || data === '\b'
    super.handleInput(data)
    if (!mayExtendSkillMention || this.isShowingAutocomplete()) return

    const currentLine = this.getText().split('\n').at(-1) ?? ''
    if (!isSkillAutocompleteContext(currentLine)) return

    // pi-tui auto-triggers @ and # mentions but does not currently include $.
    // Its regular trigger keeps the native SelectList and keyboard behavior.
    const trigger = (this as unknown as { tryTriggerAutocomplete?: () => void }).tryTriggerAutocomplete
    trigger?.call(this)
    return
  }

  private handleAppShortcuts(data: string): boolean {
    // Escape — only if autocomplete is NOT active
    if (data === '\x1b') {
      if (!this.isShowingAutocomplete()) {
        this.onEscape?.()
        return true
      }
      // Let Editor handle Escape for autocomplete cancellation
    }

    // Ctrl+C
    if (data === '\x03') {
      this.onCtrlC?.()
      return true
    }

    // Ctrl+D — only when editor is empty
    if (data === '\x04') {
      if (this.getText().length === 0) {
        this.onCtrlD?.()
        return true
      }
      // Fall through to Editor for delete-char-forward when not empty
    }

    // Ctrl+O toggles the current transcript between compact and detailed tool traces.
    if (data === '\x0f') {
      this.onCtrlO?.()
      return true
    }
    return false
  }
}
