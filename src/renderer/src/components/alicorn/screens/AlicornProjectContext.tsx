/**
 * What the project is for, written once and read by every member that works it.
 *
 * This is the project's CLAUDE.md, and it is a *screen* rather than a file in a repository for one
 * reason: a project may span several repositories, and a fact about the domain is not a fact about
 * any one of them. It also has to be readable by a person, which a prompt fragment in a settings
 * field is not — so it is markdown, rendered.
 *
 * The assistant writes here too, through `alicorn_set_project_context`. That is the point of it
 * being one field rather than prose scattered across tickets: ask for the domain to be written
 * down, and every brief afterwards carries it.
 */
import React from 'react'
import { Pencil, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import CommentMarkdown from '../../sidebar/CommentMarkdown'
import type { Project } from '../../../../../shared/alicorn/projects'
import { setAlicornAssistantOpen } from '../assistant/alicorn-assistant-store'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  type AlicornCrumb
} from './AlicornScreenChrome'

export function AlicornProjectContext({
  crumbs,
  project,
  onSaved
}: {
  crumbs: AlicornCrumb[]
  project: Project
  onSaved: () => void
}): React.JSX.Element {
  const context = project.context
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(context)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  // Reset during render when the saved value changes underneath — the assistant may have written it.
  const [seen, setSeen] = React.useState(context)
  if (seen !== context && !editing) {
    setSeen(context)
    setDraft(context)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const update = window.api?.alicorn?.updateProject
    // A whole project, because the Control API's PUT takes one — sending a partial would blank
    // every field this screen does not edit.
    const result = await update?.(project.id, {
      name: project.name,
      key: project.key,
      context: draft,
      repoIds: project.repoIds,
      source: project.source
    })
    setBusy(false)
    if (!result?.ok) {
      setFailure(result?.error ?? 'control_plane_unreachable')
      return
    }
    setEditing(false)
    onSaved()
  }

  return (
    <>
      <AlicornScreenHeader
        crumbs={crumbs}
        title={translate('auto.components.alicorn.project.context', 'Context')}
        actions={
          editing ? (
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(context)
                  setEditing(false)
                }}
              >
                {translate('auto.components.alicorn.newProject.cancel', 'Cancel')}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void save()}>
                {translate('auto.components.alicorn.project.contextSave', 'Save')}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" />
              {translate('auto.components.alicorn.project.contextEdit', 'Edit')}
            </Button>
          )
        }
      />
      <AlicornScreenBody>
        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={translate(
                'auto.components.alicorn.project.contextPlaceholder',
                '# The domain\n\nWho the users are, what the constraints are, the decisions already made. Markdown.'
              )}
              className="scrollbar-sleek min-h-[420px] w-full rounded-lg border border-border bg-background px-3.5 py-3 font-mono text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {failure ? <p className="mt-2 text-[11px] text-destructive">{failure}</p> : null}
          </>
        ) : context.trim() ? (
          <div className="max-w-[760px]">
            <CommentMarkdown content={context} variant="document" />
          </div>
        ) : (
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.noContextTitle',
              'Nothing written yet'
            )}
            detail={translate(
              'auto.components.alicorn.project.noContextDetail',
              'The domain, the users, the constraints that hold across every ticket — the part a repository cannot teach. Every brief carries it, so a member reads it before it reads the ticket.'
            )}
            action={
              <div className="mt-3 flex justify-center gap-1.5">
                <Button size="sm" onClick={() => setEditing(true)}>
                  {translate('auto.components.alicorn.project.contextWrite', 'Write it')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setAlicornAssistantOpen(true)}
                >
                  <Sparkles className="size-3.5" />
                  {translate('auto.components.alicorn.project.contextAsk', 'Ask the assistant')}
                </Button>
              </div>
            }
          />
        )}
      </AlicornScreenBody>
    </>
  )
}
