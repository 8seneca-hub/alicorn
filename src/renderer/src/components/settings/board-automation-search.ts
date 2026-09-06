import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getBoardAutomationSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.boardAutomation.search.title', 'Board automation'),
    description: translate(
      'auto.components.settings.boardAutomation.search.description',
      'Dispatch a member when a workspace moves into a board column.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.boardAutomation.search.board', 'board'),
      ...translateSearchKeyword(
        'auto.components.settings.boardAutomation.search.automation',
        'automation'
      ),
      ...translateSearchKeyword('auto.components.settings.boardAutomation.search.rule', 'rule'),
      ...translateSearchKeyword(
        'auto.components.settings.boardAutomation.search.dispatch',
        'dispatch'
      )
    ]
  }
])
