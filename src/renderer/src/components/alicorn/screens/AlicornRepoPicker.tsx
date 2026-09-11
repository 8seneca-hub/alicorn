/**
 * Choosing the repositories a project owns.
 *
 * Extracted when the PM import grew a second copy of it: both ways of making a project have to ask
 * the same question, and two pickers would drift on the rule that matters — a project needs at
 * least one, and binding a repository here moves it off whatever project held it before.
 *
 * The "choose a folder" button is Orca's own picker, which already knows about git repos, folder
 * workspaces, SSH targets and every setup path this would otherwise have to learn a second time.
 */
import React from 'react'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export function AlicornRepoPicker({
  repoIds,
  onChange
}: {
  repoIds: readonly string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const repos = useAppStore((state) => state.repos)
  const addRepo = useAppStore((state) => state.addRepo)
  const [adding, setAdding] = React.useState(false)

  // Whatever the picker returns is selected straight away: a developer who just chose a folder has
  // said which one they mean, and making them tick it again is a second answer to one question.
  // openAfterAdd: false because this binds a folder — opening a session for it would switch the
  // main view and take this dialog, half filled in, with it.
  const addFolder = async (): Promise<void> => {
    setAdding(true)
    const repo = await addRepo({ openAfterAdd: false })
    setAdding(false)
    if (repo && !repoIds.includes(repo.id)) {
      onChange([...repoIds, repo.id])
    }
  }

  const toggle = (id: string): void =>
    onChange(repoIds.includes(id) ? repoIds.filter((current) => current !== id) : [...repoIds, id])

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium">
        {translate('auto.components.alicorn.newProject.repos', 'Repositories')}
      </span>
      {repos.length > 0 ? (
        <div className="scrollbar-sleek max-h-40 overflow-y-auto rounded-md border border-border">
          {repos.map((repo) => (
            <label
              key={repo.id}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              <input
                type="checkbox"
                className="size-3.5 accent-foreground"
                checked={repoIds.includes(repo.id)}
                onChange={() => toggle(repo.id)}
              />
              <span className="truncate">{repo.displayName}</span>
            </label>
          ))}
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        disabled={adding}
        onClick={() => void addFolder()}
      >
        <FolderPlus className="size-3.5" />
        {translate('auto.components.alicorn.newProject.addFolder', 'Choose a folder…')}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        {repos.length > 0
          ? translate(
              'auto.components.alicorn.newProject.reposHint',
              'A repository belongs to at most one project; binding one here moves it.'
            )
          : translate(
              'auto.components.alicorn.newProject.reposEmptyHint',
              'Pick the folder the project lives in. A project can own several, and needs at least one.'
            )}
      </p>
    </div>
  )
}
