import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

export function getAgentTabChatSearchEntry(): SettingsSearchEntry {
  return {
    title: translate(
      'auto.components.settings.agent.tab.chat.search.entry.eff60c9b6f',
      'Agent tab chat'
    ),
    description: translate(
      'auto.components.settings.agent.tab.chat.search.entry.bb35321ee6',
      'How supported agent tabs open: the chat surface, or the terminal.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.native',
        'native'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.chat',
        'chat'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.claude',
        'claude'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.codex',
        'codex'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.openclaude',
        'openclaude'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.grok',
        'grok'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.omp',
        'omp'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.terminal',
        'terminal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.agent',
        'agent'
      )
    ]
  }
}
