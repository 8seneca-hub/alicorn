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
import type { OrgSection } from '../shell/alicorn-shell-route'

const TITLES: Record<OrgSection, string> = {
  members: 'Members',
  workflows: 'Workflows',
  checks: 'Required Checks'
}

export function AlicornOrgScreen({ section }: { section: OrgSection }): React.JSX.Element {
  return (
    <>
      <AlicornScreenHeader
        crumbs={[translate('auto.components.alicorn.shell.organisation', 'Organisation')]}
        title={TITLES[section]}
      />
      <AlicornScreenBody>
        {section === 'members' ? <AlicornMembersPane /> : null}
        {section === 'workflows' ? <AlicornWorkflowsPane /> : null}
        {section === 'checks' ? (
          <p className="max-w-xl text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.org.checksNote',
              'Required checks are authored per project by an org admin, so they live in a project rather than here. A member cannot loosen the criteria that judge it, which is why this pane does not edit them.'
            )}
          </p>
        ) : null}
      </AlicornScreenBody>
    </>
  )
}
