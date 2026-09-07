import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { VoiceSettings } from '../../../../shared/speech-types'

/**
 * The speech model to start with, or null when dictation cannot start — toasting the reason.
 * Returns the id rather than a boolean so the caller keeps it narrowed. Both refusals point at the
 * Voice pane, because the fix for each is a setting rather than anything the user can do here.
 */
export function resolveDictationStartModel(voice: VoiceSettings | undefined): string | null {
  if (!voice?.sttModel) {
    toast('No speech model selected. Download one in Settings > Voice.', {
      action: {
        label: translate(
          'auto.components.dictation.DictationController.bb7f599ee7',
          'Open Settings'
        ),
        onClick: () => {
          useAppStore.getState().openSettingsTarget({ pane: 'voice', repoId: null })
          useAppStore.getState().openSettingsPage()
        }
      }
    })
    return null
  }
  if (!voice.enabled) {
    toast('Voice dictation is disabled. Enable it in Settings > Voice.')
    return null
  }
  return voice.sttModel
}
