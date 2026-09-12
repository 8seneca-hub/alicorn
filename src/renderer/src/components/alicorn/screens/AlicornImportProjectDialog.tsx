/**
 * Importing a board from a PM tool as an Alicorn project.
 *
 * One screen, in the order the decisions actually happen: which tool, which board, what the project
 * will be called, where its work happens, and how much is coming. The issue-by-issue table the
 * prototype draws belongs to the *task* import on the board — at project level the number is the
 * decision, and a hundred checkboxes on a first-run screen is not.
 *
 * Nothing is created until Import: the preview line is computed from what was fetched, by the same
 * pure functions the import then runs, so it cannot promise a different result than it produces.
 */
import React from 'react'
import { Loader2, PackageOpen } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { planeIssueToTask, planeProjectKey } from '../../../../../shared/alicorn/pm-import'
import type { Project, ProjectInput } from '../../../../../shared/alicorn/projects'
import { AlicornRepoPicker } from './AlicornRepoPicker'
import { usePlaneImportBoard, usePlaneImportSource } from './use-plane-import-source'

/** Mirrors ProjectKeySchema: 2-10 uppercase letters or digits, starting with a letter. */
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (
    input: ProjectInput
  ) => Promise<{ ok: true; project: Project } | { ok: false; error: string }>
  onImported: (projectId: string) => void
}

export function AlicornImportProjectDialog(props: Props): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <ImportDialogBody {...props} /> : null}
    </Dialog>
  )
}

function ImportDialogBody({ onOpenChange, onCreate, onImported }: Props): React.JSX.Element {
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const source = usePlaneImportSource(true)
  const [boardId, setBoardId] = React.useState<string | null>(null)
  const board = usePlaneImportBoard(boardId)
  const [name, setName] = React.useState('')
  const [key, setKey] = React.useState('')
  const [repoIds, setRepoIds] = React.useState<string[]>([])
  const [openOnly, setOpenOnly] = React.useState(true)
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)

  const chosen = source.projects.find((project) => project.id === boardId)
  const importing = progress !== null
  const issues = openOnly ? board.openIssues : board.issues
  const keyValid = KEY_PATTERN.test(key)
  const canImport =
    Boolean(chosen) && name.trim() !== '' && keyValid && repoIds.length > 0 && !importing

  // Picking a board fills the fields it can answer; a later edit stands, because re-deriving over
  // someone's typing is worse than never helping.
  const pickBoard = (projectId: string): void => {
    const picked = source.projects.find((project) => project.id === projectId)
    setBoardId(projectId)
    setFailure(null)
    if (picked) {
      setName(picked.name)
      setKey(planeProjectKey(picked.identifier, picked.name))
    }
  }

  const runImport = async (): Promise<void> => {
    setFailure(null)
    setProgress({ done: 0, total: issues.length })
    const created = await onCreate({ name: name.trim(), key, repoIds })
    if (!created.ok) {
      setProgress(null)
      setFailure(
        created.error === 'project_exists'
          ? translate(
              'auto.components.alicorn.newProject.exists',
              'A project already uses that name or key.'
            )
          : created.error
      )
      return
    }
    const createTask = window.api?.alicorn?.createTask
    let done = 0
    for (const issue of issues) {
      if (!createTask) {
        break
      }
      // One at a time and tolerant: a board where three issues fail should still import the rest,
      // and the count below says plainly how many landed.
      const result = await createTask({
        ...planeIssueToTask(issue),
        projectId: created.project.id
      })
      if (result.ok) {
        done += 1
      }
      setProgress({ done, total: issues.length })
    }
    onOpenChange(false)
    onImported(created.project.id)
  }

  return (
    <DialogContent className="scrollbar-sleek max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {translate('auto.components.alicorn.import.title', 'Import a project')}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.alicorn.import.description',
            'Bring a board across as a project. Each issue becomes a task that keeps its reference back, so importing again picks up only what is new.'
          )}
        </DialogDescription>
      </DialogHeader>

      {source.connected === null ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          {translate('auto.components.alicorn.import.checking', 'Looking for a connected PM tool…')}
        </p>
      ) : source.connected === false ? (
        <div className="space-y-3 py-4 text-center">
          <PackageOpen className="mx-auto size-5 text-muted-foreground" />
          <p className="text-[13px] font-semibold">
            {translate('auto.components.alicorn.import.noProvider', 'No PM tool is connected')}
          </p>
          <p className="mx-auto max-w-sm text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.import.noProviderDetail',
              'Connect Plane in Settings and its boards appear here. An agent with its own PM server can import through Alicorn’s MCP tools meanwhile.'
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            // The integrations pane, not the settings root: a button that says it opens the place
            // to connect Plane and lands on the front page has not done what it said.
            onClick={() => openSettingsTarget({ pane: 'integrations', repoId: null })}
          >
            {translate('auto.components.alicorn.import.openSettings', 'Open Settings')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium">
              {translate('auto.components.alicorn.import.board', 'Board')}
            </span>
            <div className="scrollbar-sleek max-h-36 overflow-y-auto rounded-md border border-border">
              {source.projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => pickBoard(project.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                    project.id === boardId ? 'bg-accent font-semibold' : 'hover:bg-accent'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {project.identifier}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {chosen ? (
            <>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <label className="text-xs font-medium" htmlFor="alicorn-import-name">
                    {translate('auto.components.alicorn.newProject.name', 'Name')}
                  </label>
                  <Input
                    id="alicorn-import-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="w-28 space-y-1">
                  <label className="text-xs font-medium" htmlFor="alicorn-import-key">
                    {translate('auto.components.alicorn.newProject.key', 'Task key')}
                  </label>
                  <Input
                    id="alicorn-import-key"
                    value={key}
                    onChange={(event) => setKey(event.target.value.toUpperCase())}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </div>
              {key !== '' && !keyValid ? (
                <p className="text-[11px] text-destructive">
                  {translate(
                    'auto.components.alicorn.newProject.keyInvalid',
                    'Two to ten uppercase letters or digits, starting with a letter.'
                  )}
                </p>
              ) : null}

              <AlicornRepoPicker repoIds={repoIds} onChange={setRepoIds} />

              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-foreground"
                  checked={openOnly}
                  onChange={() => setOpenOnly((current) => !current)}
                />
                {translate('auto.components.alicorn.import.openOnly', 'Only issues still open')}
              </label>

              <p className="text-[11px] text-muted-foreground">
                {board.loading
                  ? translate('auto.components.alicorn.import.counting', 'Reading the board…')
                  : board.error
                    ? board.error
                    : translate(
                        'auto.components.alicorn.import.preview',
                        'Creates {{name}} ({{key}}) with {{count}} tasks.',
                        { name: name.trim() || chosen.name, key: key || '—', count: issues.length }
                      )}
              </p>
            </>
          ) : null}

          {failure ? <p className="text-[11px] text-destructive">{failure}</p> : null}
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={importing}>
          {translate('auto.components.alicorn.newProject.cancel', 'Cancel')}
        </Button>
        <Button
          size="sm"
          disabled={!canImport}
          onClick={() => void runImport()}
          className="gap-1.5"
        >
          {importing ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {importing
            ? translate(
                'auto.components.alicorn.import.importing',
                'Importing {{done}} of {{total}}…',
                { done: progress.done, total: progress.total }
              )
            : translate('auto.components.alicorn.import.import', 'Import project')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
