/**
 * `Mod+I` summons the assistant from anywhere.
 *
 * Handled in the renderer rather than through main's accelerator bridge because this chord has no
 * meaning outside the window: there is nothing to intercept before focus, and the wire change a
 * main-side accelerator needs buys nothing here.
 *
 * `Mod+I` rather than `Mod+K`: `Mod+K` already clears the active terminal pane, and a global
 * binding on it would fight that whenever a terminal had focus.
 */
import { useEffect } from 'react'
import { isMacUserAgent } from '@/components/terminal-pane/pane-helpers'
import { toggleAlicornAssistant } from './alicorn-assistant-store'

export const ALICORN_ASSISTANT_SHORTCUT_LABEL = isMacUserAgent() ? '⌘I' : 'Ctrl+I'

export function useAlicornAssistantShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Never `e.metaKey` alone: the modifier is Cmd on macOS and Ctrl everywhere else.
      const modifier = isMacUserAgent() ? event.metaKey : event.ctrlKey
      if (!modifier || event.shiftKey || event.altKey) {
        return
      }
      // `event.code`, not `event.key`: a non-US layout reports a different character for this
      // physical key, and the chord should stay where the user's fingers are.
      if (event.code !== 'KeyI') {
        return
      }
      event.preventDefault()
      toggleAlicornAssistant()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])
}
