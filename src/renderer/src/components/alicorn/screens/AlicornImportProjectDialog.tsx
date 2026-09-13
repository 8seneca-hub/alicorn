/**
 * Importing a board from a PM tool as an Alicorn project.
 *
 * **Issues are deliberately not copied.** Alicorn's board is a private working surface, not a second
 * home for a tracker everyone already reads — mirroring a hundred issues into it produces a hundred
 * rows nobody asked for and two places for the same ticket to drift. What comes across is the
 * project's own identity: its name, its key, and the description that says what it is for. An agent
 * that needs a specific issue reads it through the PM tool's own MCP server, where it is current.
 *
 * One screen, in the order the decisions actually happen: which tool, which board, what the project
 * will be called, and where its work happens. Nothing is created until Import.
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
import { htmlToPlainText, planeProjectKey } from '../../../../../shared/alicorn/pm-import'
import type { Project, ProjectInput } from '../../../../../shared/alicorn/projects'
import { AlicornRepoPicker } from './AlicornRepoPicker'
import { usePmImportSource } from './use-pm-import-source'
import { PM_PROVIDER_LABELS, type PmProvider } from './pm-import-providers'

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
  const [provider, setProvider] = React.useState<PmProvider | null>(null)
  const source = usePmImportSource(provider)
  const [boardId, setBoardId] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [key, setKey] = React.useState('')
  const [repoIds, setRepoIds] = React.useState<string[]>([])
  const [importing, setImporting] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  const chosen = source.boards.find((board) => board.id === boardId)
  const keyValid = KEY_PATTERN.test(key)
  const canImport =
    Boolean(chosen) && name.trim() !== '' && keyValid && repoIds.length > 0 && !importing

  // Picking a board fills the fields it can answer; a later edit stands, because re-deriving over
  // someone's typing is worse than never helping.
  const pickBoard = (nextBoardId: string): void => {
    const picked = source.boards.find((board) => board.id === nextBoardId)
    setBoardId(nextBoardId)
    setFailure(null)
    if (picked) {
      setName(picked.name)
      setKey(planeProjectKey(picked.identifier, picked.name))
    }
  }

  // One connected provider is not a choice, so it is made rather than asked.
  React.useEffect(() => {
    if (provider === null && source.connected?.length === 1) {
      setProvider(source.connected[0]!)
    }
  }, [provider, source.connected])

  const runImport = async (): Promise<void> => {
    setFailure(null)
    setImporting(true)
    const created = await onCreate({
      name: name.trim(),
      key,
      // The board's own description is what the project is *for*; every brief carries it, so a
      // member reads the domain before it reads the ticket.
      context: chosen?.description
        ? chosen.descriptionIsHtml
          ? htmlToPlainText(chosen.description)
          : chosen.description
        : '',
      repoIds,
      // The link, not the issues: a task reaches one issue on demand, where it is still current.
      source:
        chosen && provider
          ? { provider, boardId: chosen.id, identifier: chosen.identifier, url: null }
          : null
    })
    setImporting(false)
    if (!created.ok) {
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
            'Bring a board across as a project — its name, its key and what it is for. Its issues stay where they are: an agent reads them through the PM tool, where they are current.'
          )}
        </DialogDescription>
      </DialogHeader>

      {source.connected === null ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          {translate('auto.components.alicorn.import.checking', 'Looking for a connected PM tool…')}
        </p>
      ) : source.connected.length === 0 ? (
        <div className="space-y-3 py-4 text-center">
          <PackageOpen className="mx-auto size-5 text-muted-foreground" />
          <p className="text-[13px] font-semibold">
            {translate('auto.components.alicorn.import.noProvider', 'No PM tool is connected')}
          </p>
          <p className="mx-auto max-w-sm text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.import.noProviderDetail',
              'Connect Plane, Linear or Jira in Settings and its boards appear here. An agent with its own PM server can import through Alicorn’s MCP tools meanwhile.'
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
          {source.connected.length > 1 ? (
            <div className="flex gap-1 rounded-md border border-border p-1">
              {source.connected.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    setProvider(candidate)
                    setBoardId(null)
                  }}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-[12px] transition',
                    provider === candidate
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent'
                  )}
                >
                  {PM_PROVIDER_LABELS[candidate]}
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-1">
            <span className="text-xs font-medium">
              {translate('auto.components.alicorn.import.board', 'Board')}
            </span>
            <div className="scrollbar-sleek max-h-36 overflow-y-auto rounded-md border border-border">
              {source.loading ? (
                <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                  {translate('auto.components.alicorn.import.boardsLoading', 'Reading boards…')}
                </p>
              ) : (
                source.boards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    onClick={() => pickBoard(board.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                      board.id === boardId ? 'bg-accent font-semibold' : 'hover:bg-accent'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{board.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {board.identifier}
                    </span>
                  </button>
                ))
              )}
            </div>
            {source.error ? <p className="text-[11px] text-destructive">{source.error}</p> : null}
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

              <p className="text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.import.preview',
                  'Creates {{name}} ({{key}}). Its board stays in the PM tool.',
                  { name: name.trim() || chosen.name, key: key || '—' }
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
          {translate('auto.components.alicorn.import.import', 'Import project')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
