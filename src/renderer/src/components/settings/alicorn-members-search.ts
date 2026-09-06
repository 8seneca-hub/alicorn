import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getAlicornMembersSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.alicornMembers.search.title', 'Members'),
    description: translate(
      'auto.components.settings.alicornMembers.search.description',
      'Reusable agent roles: backend, skills, permission mode and workspace kind.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.alicornMembers.search.member', 'member'),
      ...translateSearchKeyword('auto.components.settings.alicornMembers.search.role', 'role'),
      ...translateSearchKeyword(
        'auto.components.settings.alicornMembers.search.backend',
        'backend'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.alicornMembers.search.reviewer',
        'reviewer'
      )
    ]
  }
])
