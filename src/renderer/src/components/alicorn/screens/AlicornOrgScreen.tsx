/**
 * The org library: the members, workflows and checks every project draws from.
 *
 * These panes already exist as settings panes and are reused rather than rebuilt — the library is
 * the same library whichever door you reach it through, and a second editor for a member would be
 * a second place for the reviewer-backend rule to be got wrong.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { AlicornMembersPane } from '../../settings/AlicornMembersPane'
import { AlicornWorkflowsPane } from '../../settings/AlicornWorkflowsPane'
import { AlicornScreenBody, AlicornScreenHeader } from './AlicornScreenChrome'
import { AlicornOrgAutonomy } from './AlicornOrgAutonomy'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { OrgSection } from '../shell/alicorn-shell-route'

const TITLES: Record<OrgSection, string> = {
  members: 'Members',
  workflows: 'Workflows',
  autonomy: 'Autonomy'
}

export function AlicornOrgScreen({
  section,
  projects
}: {
  section: OrgSection
  projects: readonly Project[]
}): React.JSX.Element {
  return (
    <>
      <AlicornScreenHeader
        crumbs={[translate('auto.components.alicorn.shell.organisation', 'Organisation')]}
        title={TITLES[section]}
      />
      <AlicornScreenBody>
        {section === 'members' ? <AlicornMembersPane /> : null}
        {section === 'workflows' ? <AlicornWorkflowsPane /> : null}
        {section === 'autonomy' ? <AlicornOrgAutonomy projects={projects} /> : null}
      </AlicornScreenBody>
    </>
  )
}
