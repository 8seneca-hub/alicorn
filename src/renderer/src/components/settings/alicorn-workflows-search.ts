import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getAlicornWorkflowsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.alicornWorkflows.search.title', 'Workflows'),
    description: translate(
      'auto.components.settings.alicornWorkflows.search.description',
      'Stages, who runs them, and the edges between them — including findings going back to the author.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.alicornWorkflows.search.workflow',
        'workflow'
      ),
      ...translateSearchKeyword('auto.components.settings.alicornWorkflows.search.stage', 'stage'),
      ...translateSearchKeyword('auto.components.settings.alicornWorkflows.search.canvas', 'canvas'),
      ...translateSearchKeyword(
        'auto.components.settings.alicornWorkflows.search.correction',
        'correction edge'
      )
    ]
  }
])
