/**
 * The project's CLAUDE.md, rendered.
 *
 * **The file is the artifact.** Claude reads `CLAUDE.md` out of the working directory by itself, so
 * a context kept only in the control plane is a second description of the project that the agent
 * never sees — and the two drift the moment anyone edits either. Where the file exists, this screen
 * shows it and writes it.
 *
 * The control-plane `context` is the seed and the fallback. An imported project has its board's
 * description before it has a repository worth reading, so the first save turns that description
 * into the repository's first CLAUDE.md. A project with no repository resolved here keeps the
 * control-plane copy, which is better than nothing to show.
 *
 * The assistant writes the control-plane copy through `alicorn_set_project_context`; asking it to
 * write the file is a thing it can do directly, because it has the working directory.
 */
import React from 'react'
import { Pencil, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import CommentMarkdown from '../../sidebar/CommentMarkdown'
import type { Project } from '../../../../../shared/alicorn/projects'
import { CLAUDE_MD, useProjectClaudeMd, writeProjectClaudeMd } from './use-project-claude-md'
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
  repoPath,
  onSaved
}: {
  crumbs: AlicornCrumb[]
  project: Project
  /** The project's primary repository on this machine, when one resolves. */
  repoPath: string | null
  onSaved: () => void
}): React.JSX.Element {
  const claudeMd = useProjectClaudeMd({ repoPath, fallback: project.context })
  const context = claudeMd.text
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(context)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  // Reset during render when the saved value changes underneath — the file may have been rewritten
  // by an agent working in this very repository, which is the normal case here.
  const [seen, setSeen] = React.useState(context)
  if (seen !== context && !editing) {
    setSeen(context)
    setDraft(context)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      if (claudeMd.path) {
        // The file, because that is what the agent reads. Writing the control-plane copy as well
        // would be a second answer nothing keeps in sync.
        await writeProjectClaudeMd(claudeMd.path, draft)
        claudeMd.reload()
      } else {
        // No repository here, so there is nowhere to put a file. The control plane holds it.
        const result = await window.api?.alicorn?.updateProject?.(project.id, {
          name: project.name,
          key: project.key,
          context: draft,
          repoIds: project.repoIds,
          source: project.source
        })
        if (!result?.ok) {
          throw new Error(result?.error ?? 'control_plane_unreachable')
        }
        onSaved()
      }
      setEditing(false)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
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
        <p className="mb-4 text-[11px] text-muted-foreground">
          {claudeMd.path
            ? claudeMd.fromFile
              ? translate(
                  'auto.components.alicorn.project.contextFromFile',
                  'Reading {{file}} in this project’s repository — the same file the agent reads.',
                  { file: CLAUDE_MD }
                )
              : translate(
                  'auto.components.alicorn.project.contextWillCreate',
                  'This repository has no {{file}} yet. Saving writes one, seeded with what is below.',
                  { file: CLAUDE_MD }
                )
            : translate(
                'auto.components.alicorn.project.contextNoRepo',
                'No repository resolved on this machine, so this is kept in the control plane instead of a file.'
              )}
        </p>
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
