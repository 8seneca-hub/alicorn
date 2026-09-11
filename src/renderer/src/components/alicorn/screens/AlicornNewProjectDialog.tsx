/**
 * Creating a project: a name, the key that prefixes its task ids, and the repositories it owns.
 *
 * The key derives from the name until the developer touches it, then stops — the same rule the
 * task composer's plan follows, because a field that keeps rewriting what you just typed is worse
 * than one that never helped.
 */
import React from 'react'
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
import { cn } from '@/lib/utils'
import type { Project, ProjectInput } from '../../../../../shared/alicorn/projects'
import { AlicornRepoPicker } from './AlicornRepoPicker'

/** Mirrors ProjectKeySchema: 2-10 uppercase letters or digits, starting with a letter. */
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

export function deriveProjectKey(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return letters.slice(0, 4)
}

export function AlicornNewProjectDialog({
  open,
  onOpenChange,
  onCreate,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (
    input: ProjectInput
  ) => Promise<{ ok: true; project: Project } | { ok: false; error: string }>
  onCreated: (projectId: string) => void
}): React.JSX.Element {
  const [name, setName] = React.useState('')
  const [key, setKey] = React.useState('')
  const [keyTouched, setKeyTouched] = React.useState(false)
  const [repoIds, setRepoIds] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setName('')
      setKey('')
      setKeyTouched(false)
      setRepoIds([])
      setFailure(null)
    }
  }, [open])

  const effectiveKey = keyTouched ? key : deriveProjectKey(name)
  const keyValid = KEY_PATTERN.test(effectiveKey)
  // A project with no repository has nowhere for its work to happen, and the repositories screen
  // cannot add one afterwards yet — so it is asked for here rather than left to be fixed later.
  const canSubmit = name.trim().length > 0 && keyValid && repoIds.length > 0 && !busy

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const result = await onCreate({ name: name.trim(), key: effectiveKey, repoIds })
    setBusy(false)
    if (!result.ok) {
      setFailure(
        result.error === 'project_exists'
          ? translate(
              'auto.components.alicorn.newProject.exists',
              'A project already uses that name or key.'
            )
          : result.error === 'project_requires_repo'
            ? translate(
                'auto.components.alicorn.newProject.requiresRepo',
                'A project needs at least one repository.'
              )
            : result.error
      )
      return
    }
    onOpenChange(false)
    onCreated(result.project.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.alicorn.newProject.title', 'New project')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.alicorn.newProject.description',
              'One instance of the org library, with its own repositories and board.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="alicorn-project-name">
              {translate('auto.components.alicorn.newProject.name', 'Name')}
            </label>
            <Input
              id="alicorn-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Payments Platform"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="alicorn-project-key">
              {translate('auto.components.alicorn.newProject.key', 'Task key')}
            </label>
            <Input
              id="alicorn-project-key"
              value={effectiveKey}
              onChange={(event) => {
                setKeyTouched(true)
                setKey(event.target.value.toUpperCase())
              }}
              placeholder="PAY"
              className="h-8 font-mono text-xs"
            />
            <p
              className={cn(
                'text-[11px]',
                effectiveKey !== '' && !keyValid ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {effectiveKey !== '' && !keyValid
                ? translate(
                    'auto.components.alicorn.newProject.keyInvalid',
                    'Two to ten uppercase letters or digits, starting with a letter.'
                  )
                : translate(
                    'auto.components.alicorn.newProject.keyHint',
                    'Prefixes every task id — {{key}}-142.',
                    { key: effectiveKey || 'PAY' }
                  )}
            </p>
          </div>

          <AlicornRepoPicker repoIds={repoIds} onChange={setRepoIds} />

          {failure ? <p className="text-[11px] text-destructive">{failure}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {translate('auto.components.alicorn.newProject.cancel', 'Cancel')}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
            {translate('auto.components.alicorn.newProject.create', 'Create project')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
