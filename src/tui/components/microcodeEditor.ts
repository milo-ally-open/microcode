import { Editor, type EditorOptions, type EditorTheme, type TUI } from '@earendil-works/pi-tui'

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

  constructor(tui: TUI, theme: EditorTheme, options?: EditorOptions) {
    super(tui, theme, options)
  }

  handleInput(data: string): void {
    // Escape — only if autocomplete is NOT active
    if (data === '\x1b') {
      if (!this.isShowingAutocomplete()) {
        this.onEscape?.()
        return
      }
      // Let Editor handle Escape for autocomplete cancellation
    }

    // Ctrl+C
    if (data === '\x03') {
      this.onCtrlC?.()
      return
    }

    // Ctrl+D — only when editor is empty
    if (data === '\x04') {
      if (this.getText().length === 0) {
        this.onCtrlD?.()
        return
      }
      // Fall through to Editor for delete-char-forward when not empty
    }

    // Ctrl+O toggles the current transcript between compact and detailed tool traces.
    if (data === '\x0f') {
      this.onCtrlO?.()
      return
    }

    // Everything else → Editor handles (cursor, history, undo, autocomplete, etc.)
    super.handleInput(data)
  }
}
