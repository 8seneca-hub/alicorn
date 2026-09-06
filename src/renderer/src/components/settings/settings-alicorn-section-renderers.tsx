import { SettingsSection } from './SettingsSection'
import { AlicornMembersPane } from './AlicornMembersPane'
import type { SettingsRenderContext } from './settings-render-context'
import { translate } from '@/i18n/i18n'

export function renderAlicornMembersSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element {
  const { navigation, view } = context
  return (
    <SettingsSection
      id="alicorn-members"
      title={translate('auto.components.settings.alicornMembers.sectionTitle', 'Members')}
      description={translate(
        'auto.components.settings.alicornMembers.sectionDescription',
        'Reusable agent roles: backend, skills, permission mode and workspace kind.'
      )}
      searchEntries={navigation.getSectionSearchEntries('alicorn-members')}
    >
      {view.isSectionMounted('alicorn-members') ? <AlicornMembersPane /> : null}
    </SettingsSection>
  )
}
