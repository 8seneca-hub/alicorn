/**
 * A project's conversation — the third way to work, beside the list and the board.
 *
 * Requiring a ticket before you can start is a tax on the cheapest kind of work: a question, a
 * look, a small fix. This is where someone begins in the right context and creates the ticket when
 * the work turns out to deserve one, which is the honest order. `alicorn_create_task` reaches it
 * through the MCP server every structured session already carries, so "make this a ticket" happens
 * mid-conversation rather than by leaving and re-explaining.
 *
 * Distinct from the right-hand assistant, which follows you across every screen and answers about
 * whatever you are looking at. This is a place with a transcript that persists and members
 * attached; that is a helper.
 *
 * A task opened from here does **not** inherit this conversation. A subject owns exactly one
 * conversation, and a ticket's transcript has to read as the record of that ticket rather than as a
 * continuation of whatever was being discussed beforehand — the context reaches the task through
 * its brief, which is where context belongs.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { projectChatSubjectId } from '../../../../../shared/alicorn/task-session'
import type { Repo } from '../../../../../shared/repo-types'
import { useAlicornMembers } from '../shell/use-alicorn-members'
import { AlicornTaskChat } from './AlicornTaskChat'
import { AlicornTaskChatSkeleton } from './AlicornTaskChatSkeleton'
import { AlicornTaskMembers } from './AlicornTaskMembers'
import { AlicornScreenHeader, type AlicornCrumb } from './AlicornScreenChrome'
import { useAlicornChat } from './use-alicorn-chat'
import type { TaskSessionActivity } from './task-session-activity'

export function AlicornProjectChatScreen({
  crumbs,
  projectId,
  projectName,
  projectRepos
}: {
  crumbs: AlicornCrumb[]
  projectId: string
  projectName: string
  projectRepos: readonly Repo[]
}): React.JSX.Element {
  const { members } = useAlicornMembers()
  const [activity, setActivity] = React.useState<TaskSessionActivity>('offline')
  const preferredRepoIds = React.useMemo(() => projectRepos.map((repo) => repo.id), [projectRepos])
  const chat = useAlicornChat({
    subjectId: projectChatSubjectId(projectId),
    preferredRepoIds,
    model: null
  })

  return (
    <>
      <AlicornScreenHeader
        crumbs={crumbs}
        title={translate('auto.components.alicorn.project.chat', 'Chat')}
        titleHint={translate(
          'auto.components.alicorn.project.chatHint',
          'A conversation about {{project}}. Ask first, and turn it into a ticket when it earns one — a task always opens its own session rather than continuing this one.',
          { project: projectName }
        )}
      />
      {chat.session ? (
        <>
          <AlicornTaskChat
            session={chat.session}
            onActivityChange={setActivity}
            onRestart={chat.restart}
          />
          {/* No member runs this session — it is the project's conversation, not a ticket's — so
              every chip reads as bound rather than as working. */}
          <AlicornTaskMembers
            members={members ?? []}
            runningMemberId={undefined}
            activity={activity}
          />
        </>
      ) : chat.repoId === undefined ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-9 text-center text-[12.5px] text-muted-foreground">
          {translate(
            'auto.components.alicorn.project.chatNoRepo',
            'A conversation runs in a workspace, and this project has no repository to run in yet. Add one in settings.'
          )}
        </div>
      ) : chat.error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-9 text-center text-[12.5px] text-destructive">
          {chat.error}
        </div>
      ) : (
        <AlicornTaskChatSkeleton />
      )}
    </>
  )
}
