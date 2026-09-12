/**
 * Two project sections the navigation promises and the product does not yet keep.
 *
 * They say where the thing actually lives and take you there, rather than drawing an editor that
 * writes nowhere. A skill set belongs to a member in the org library; a provider connection belongs
 * to the device. Scoping either to one project is real work, and pretending otherwise here would
 * cost someone an afternoon finding out.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  type AlicornCrumb
} from './AlicornScreenChrome'

function GoTo({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 h-8 rounded-md border border-border px-3 text-[12.5px] font-medium transition hover:bg-accent"
    >
      {label}
    </button>
  )
}

export function AlicornProjectSkillsSection({
  crumbs,
  onOpenSkills
}: {
  crumbs: AlicornCrumb[]
  onOpenSkills: () => void
}): React.JSX.Element {
  return (
    <>
      <AlicornScreenHeader
        crumbs={crumbs}
        title={translate('auto.components.alicorn.project.skills', 'Skills')}
      />
      <AlicornScreenBody>
        <AlicornEmptyState
          title={translate(
            'auto.components.alicorn.project.skillsTitle',
            'Skills are a member’s, not a project’s'
          )}
          detail={translate(
            'auto.components.alicorn.project.skillsDetail',
            'A skill set is bound to a member in the org library, and the catalogue lives in the Skills view. Choosing which of them this project may use is not built yet.'
          )}
          action={
            <GoTo
              label={translate(
                'auto.components.alicorn.project.openSkills',
                'Open the skill catalogue'
              )}
              onClick={onOpenSkills}
            />
          }
        />
      </AlicornScreenBody>
    </>
  )
}

export function AlicornProjectIntegrationsSection({
  crumbs,
  onOpenConnections
}: {
  crumbs: AlicornCrumb[]
  onOpenConnections: () => void
}): React.JSX.Element {
  return (
    <>
      <AlicornScreenHeader
        crumbs={crumbs}
        title={translate('auto.components.alicorn.project.integrations', 'Integrations')}
      />
      <AlicornScreenBody>
        <AlicornEmptyState
          title={translate(
            'auto.components.alicorn.project.integrationsTitle',
            'Connected per device, not per project'
          )}
          detail={translate(
            'auto.components.alicorn.project.integrationsDetail',
            'Linear, GitHub and the other providers are connected in Settings, and a task picks up whatever is connected there. Scoping a connection to one project is not built yet.'
          )}
          action={
            <GoTo
              label={translate(
                'auto.components.alicorn.project.openConnections',
                'Open connected accounts'
              )}
              onClick={onOpenConnections}
            />
          }
        />
      </AlicornScreenBody>
    </>
  )
}
