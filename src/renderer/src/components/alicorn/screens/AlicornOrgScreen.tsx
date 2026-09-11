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
import { useAppStore } from '@/store'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { OrgSection } from '../shell/alicorn-shell-route'

const TITLES: Record<OrgSection, string> = {
  members: 'Members',
  workflows: 'Workflows',
  autonomy: 'Autonomy',
  checks: 'Required Checks',
  orchestration: 'Orchestration'
}

export function AlicornOrgScreen({
  section,
  projects
}: {
  section: OrgSection
  projects: readonly Project[]
}): React.JSX.Element {
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
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
        {section === 'orchestration' ? (
          <div className="max-w-[640px] space-y-3">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {translate(
                'auto.components.alicorn.org.orchestrationNote',
                'Orchestration is what runs a task with execution_strategy: orchestrated — a lead that writes no code, subagents with a fresh context window each, and schema-bounded returns. It costs roughly an order of magnitude more than one agent, so single stays the default and nothing here changes that.'
              )}
            </p>
            <button
              type="button"
              onClick={() => openSettingsPage()}
              className="h-8 rounded-md border border-border px-3 text-[12.5px] font-medium transition hover:bg-accent"
            >
              {translate(
                'auto.components.alicorn.org.openOrchestrationSettings',
                'Open orchestration settings'
              )}
            </button>
          </div>
        ) : null}
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
