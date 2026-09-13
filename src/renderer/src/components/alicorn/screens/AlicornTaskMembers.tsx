/**
 * Who is on this ticket, under the conversation rather than over it.
 *
 * At the top it competed with the thing you opened the ticket to read, and it grew sideways: four
 * members pushed the stage rail off its own line. At the bottom it sits beside the composer, which
 * is where "who am I talking to" is actually asked, and it wraps without moving anything above it.
 *
 * The one running the session reads differently from the rest on purpose. A reviewer bound to the
 * same ticket is *not* in this session, and two chips that look alike said both of them were.
 */
import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { Member } from '../../../../../shared/alicorn/members'
import type { TaskSessionActivity } from './task-session-activity'

const ACTIVITY_DOT: Record<TaskSessionActivity, string> = {
  working: 'bg-status-running',
  waiting: 'bg-status-attention',
  idle: 'bg-muted-foreground/40',
  offline: 'bg-muted-foreground/25'
}

function activityLabel(activity: TaskSessionActivity): string {
  if (activity === 'working') {
    return translate('auto.components.alicorn.task.memberWorking', 'working')
  }
  if (activity === 'waiting') {
    return translate('auto.components.alicorn.task.memberWaiting', 'waiting on you')
  }
  if (activity === 'idle') {
    return translate('auto.components.alicorn.task.memberIdle', 'idle')
  }
  return translate('auto.components.alicorn.task.memberNotStarted', 'not started')
}

/**
 * One member, and — for the one the session is running as — what it is doing right now.
 *
 * The two read differently on purpose. A reviewer bound to the same ticket is *not* in this
 * session, and two chips that look alike said "both of these are on it", which was the question
 * being asked. The one running is solid and carries the activity; the others are outlined and say
 * which member they are waiting to be.
 */

function MemberChip({
  member,
  activity
}: {
  member: Member
  /** Null for a member bound to the ticket but not running this session. */
  activity: TaskSessionActivity | null
}): React.JSX.Element {
  const initials = member.name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span
      title={
        activity
          ? translate(
              'auto.components.alicorn.task.memberRunsThis',
              '{{member}} is running this session on {{backend}}',
              { member: member.name, backend: member.backend }
            )
          : translate(
              'auto.components.alicorn.task.memberNotInSession',
              '{{member}} is on this ticket but is not running this session',
              { member: member.name }
            )
      }
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[12px]',
        activity
          ? activity === 'working'
            ? 'border-status-running/50 bg-accent'
            : 'border-border bg-accent'
          : 'border-dashed border-border text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold',
          activity ? 'bg-foreground text-background' : 'bg-accent'
        )}
      >
        {initials}
      </span>
      <span className={cn('truncate', activity ? 'font-semibold' : 'font-medium')}>
        {member.name}
      </span>
      {activity ? (
        <>
          <span className={cn('size-1.5 shrink-0 rounded-full', ACTIVITY_DOT[activity])} />
          <span className="truncate text-[11px] text-muted-foreground">
            {activityLabel(activity)}
          </span>
        </>
      ) : null}
      <span className="truncate text-[11px] text-muted-foreground">{member.backend}</span>
    </span>
  )
}

export function AlicornTaskMembers({
  members,
  runningMemberId,
  activity
}: {
  members: readonly Member[]
  /** The member the session runs as; everyone else is on the ticket but not in the room. */
  runningMemberId: string | undefined
  activity: TaskSessionActivity
}): React.JSX.Element | null {
  if (members.length === 0) {
    return null
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-9 py-2">
      {members.map((member) => (
        <MemberChip
          key={member.id}
          member={member}
          activity={member.id === runningMemberId ? activity : null}
        />
      ))}
    </div>
  )
}
