/**
 * Deleting a project.
 *
 * The confirmation names what actually goes and what does not, because the two are easy to confuse
 * and only one of them is recoverable: the board goes with the project — its tasks are rows in the
 * control plane and nothing else holds them — while the repositories are only *unbound*. No branch,
 * no worktree and no file on disk is touched, so nothing a developer has written is at stake.
 *
 * Typing the name is the guard rather than a second button. A project holds every ticket in it, and
 * a misplaced click should not be able to spend them.
 */
import React from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { Project } from '../../../../../shared/alicorn/projects'

type DeleteProjectFormProps = {
  project: Project
  openTaskCount: number
  onOpenChange: (open: boolean) => void
  onDelete: (projectId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onDeleted: () => void
}

/**
 * The confirmation is mounted only while a project is being deleted, so what someone typed for
 * one project can never be sitting in the field for the next.
 */
export function AlicornDeleteProjectDialog({
  project,
  ...form
}: Omit<DeleteProjectFormProps, 'project'> & {
  /** Null when nothing is being deleted; the dialog is closed. */
  project: Project | null
}): React.JSX.Element {
  return (
    <Dialog open={project !== null} onOpenChange={form.onOpenChange}>
      {project ? <AlicornDeleteProjectForm project={project} {...form} /> : null}
    </Dialog>
  )
}

function AlicornDeleteProjectForm({
  project,
  openTaskCount,
  onOpenChange,
  onDelete,
  onDeleted
}: DeleteProjectFormProps): React.JSX.Element {
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  const confirmed = typed.trim() === project.name

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const result = await onDelete(project.id)
    setBusy(false)
    if (!result.ok) {
      setFailure(result.error)
      return
    }
    onOpenChange(false)
    onDeleted()
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {translate('auto.components.alicorn.deleteProject.title', 'Delete {{name}}?', {
            name: project.name
          })}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.alicorn.deleteProject.description',
            'Its board goes with it. The repositories are only unbound — no branch, worktree or file on disk is touched.'
          )}
        </DialogDescription>
      </DialogHeader>

      {openTaskCount > 0 ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-status-attention/40 bg-status-attention/10 px-3 py-2.5 text-[12.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-attention" />
          <span>
            {openTaskCount === 1
              ? translate(
                  'auto.components.alicorn.deleteProject.openOne',
                  'One task is still open. It goes too.'
                )
              : translate(
                  'auto.components.alicorn.deleteProject.openMany',
                  '{{count}} tasks are still open. They go too.',
                  { count: openTaskCount }
                )}
          </span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="alicorn-delete-project">
          {translate(
            'auto.components.alicorn.deleteProject.confirmLabel',
            'Type {{name}} to confirm',
            { name: project.name }
          )}
        </label>
        <Input
          id="alicorn-delete-project"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="h-8 text-xs"
          autoComplete="off"
        />
      </div>

      {failure ? <p className="text-[11px] text-destructive">{failure}</p> : null}

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          {translate('auto.components.alicorn.newProject.cancel', 'Cancel')}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!confirmed || busy}
          onClick={() => void submit()}
        >
          {translate('auto.components.alicorn.deleteProject.confirm', 'Delete project')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
