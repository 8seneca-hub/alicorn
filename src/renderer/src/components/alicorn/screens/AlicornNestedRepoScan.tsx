/**
 * Finding the git repositories inside a folder a project is bound to.
 *
 * A folder workspace has no branch, so nothing that keys on one — Source Control, Checks,
 * Provenance, Context — can show anything for a task working in it. The repositories *inside* the
 * folder do have branches, and binding those is what gives a task a diff.
 *
 * The scan and the import are Orca's own (`scanNestedRepos` / `importNestedRepos`), so depth
 * limits, timeouts, cancellation and the SSH path are the ones already proven rather than a second
 * implementation of the same walk.
 */
import React from 'react'
import { FolderGit2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { NestedRepoCandidate } from '../../../../../shared/project-group-types'
import type { Repo } from '../../../../../shared/repo-types'

type ScanState =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'found'; candidates: NestedRepoCandidate[]; truncated: boolean }
  | { kind: 'importing' }
  | { kind: 'failed'; message: string }

export function AlicornNestedRepoScan({
  folder,
  onImported
}: {
  /** The folder workspace repo whose contents are worth looking inside. */
  folder: Repo
  onImported: (paths: string[]) => void
}): React.JSX.Element {
  const scanNestedRepos = useAppStore((state) => state.scanNestedRepos)
  const importNestedRepos = useAppStore((state) => state.importNestedRepos)
  const [state, setState] = React.useState<ScanState>({ kind: 'idle' })
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())

  const scan = async (): Promise<void> => {
    setState({ kind: 'scanning' })
    try {
      const result = await scanNestedRepos(folder.path, folder.connectionId ?? undefined)
      if (!result) {
        setState({
          kind: 'failed',
          message: translate(
            'auto.components.alicorn.screens.AlicornNestedRepoScan.c0313e4ff7',
            'The scan did not answer.'
          )
        })
        return
      }
      // Nothing preselected: a folder like this holds dozens, and a single click that adds all of
      // them is a decision nobody made.
      setSelected(new Set())
      setState({ kind: 'found', candidates: result.repos, truncated: result.truncated })
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const importSelected = async (): Promise<void> => {
    const paths = [...selected]
    if (paths.length === 0) {
      return
    }
    setState({ kind: 'importing' })
    try {
      await importNestedRepos({
        parentPath: folder.path,
        groupName: folder.displayName,
        projectPaths: paths,
        ...(folder.connectionId ? { connectionId: folder.connectionId } : {}),
        // Separate, not grouped: the point is that each one is its own git repository with its own
        // branch, which is precisely what a group would flatten back into one folder workspace.
        mode: 'separate'
      })
      onImported(paths)
      setState({ kind: 'idle' })
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const toggle = (path: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <FolderGit2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold">
            {translate(
              'auto.components.alicorn.nestedScan.title',
              'Repositories inside {{folder}}',
              { folder: folder.displayName }
            )}
          </h2>
          <p className="mt-1 max-w-[620px] text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.nestedScan.detail',
              'This folder is not a git repository, so a task working in it has no branch — and nothing that reads one, like the diff, the checks or provenance, can show anything. Binding the repositories inside it gives a task somewhere with a branch to work.'
            )}
          </p>
        </div>
        {state.kind === 'idle' || state.kind === 'failed' ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void scan()}>
            {translate('auto.components.alicorn.nestedScan.scan', 'Scan the folder')}
          </Button>
        ) : null}
      </div>

      {state.kind === 'scanning' ? (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {translate('auto.components.alicorn.nestedScan.scanning', 'Looking for repositories…')}
        </p>
      ) : null}

      {state.kind === 'found' ? (
        <>
          {state.candidates.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              {translate(
                'auto.components.alicorn.nestedScan.none',
                'No git repositories were found inside this folder.'
              )}
            </p>
          ) : (
            <>
              <ul className="scrollbar-sleek mt-3 max-h-[280px] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {state.candidates.map((candidate) => (
                  <li key={candidate.path} className="flex items-center gap-2.5 px-3 py-2">
                    <input
                      type="checkbox"
                      id={`nested-${candidate.path}`}
                      checked={selected.has(candidate.path)}
                      onChange={() => toggle(candidate.path)}
                      className="size-3.5 shrink-0"
                    />
                    <label
                      htmlFor={`nested-${candidate.path}`}
                      className="min-w-0 flex-1 truncate text-[13px]"
                    >
                      {candidate.displayName}
                    </label>
                    <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                      {candidate.path}
                    </span>
                  </li>
                ))}
              </ul>
              {state.truncated ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {translate(
                    'auto.components.alicorn.nestedScan.truncated',
                    'The scan stopped at its limit, so this is not the whole folder.'
                  )}
                </p>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => void importSelected()}
                >
                  {selected.size === 1
                    ? translate('auto.components.alicorn.nestedScan.addOne', 'Add 1 to Alicorn')
                    : translate(
                        'auto.components.alicorn.nestedScan.add',
                        'Add {{count}} to Alicorn',
                        { count: selected.size }
                      )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected(
                      selected.size === state.candidates.length
                        ? new Set()
                        : new Set(state.candidates.map((candidate) => candidate.path))
                    )
                  }
                >
                  {selected.size === state.candidates.length
                    ? translate('auto.components.alicorn.nestedScan.selectNone', 'Select none')
                    : translate('auto.components.alicorn.nestedScan.all', 'Select all {{count}}', {
                        count: state.candidates.length
                      })}
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}

      {state.kind === 'importing' ? (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {translate('auto.components.alicorn.nestedScan.importing', 'Adding them…')}
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <p className="mt-3 text-[11px] text-destructive">{state.message}</p>
      ) : null}
    </section>
  )
}
