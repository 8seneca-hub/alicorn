import type React from 'react'
import { SquareKanban } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { TaskPaletteItem } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteController } from './use-worktree-jump-palette-controller'
import { HighlightedText } from './worktree-jump-palette-primitives'

export function WorktreeJumpPaletteTaskRow({
  entry,
  renderKey,
  controller
}: {
  entry: TaskPaletteItem
  renderKey: string
  controller: WorktreeJumpPaletteController
}): React.JSX.Element {
  const result = entry.result

  return (
    <CommandItem
      value={renderKey}
      onSelect={() => controller.handleSelectItem(entry)}
      className={cn(
        'group mx-0.5 flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]',
        'data-[selected=true]:border-border data-[selected=true]:bg-accent data-[selected=true]:text-foreground'
      )}
    >
      <div className="flex h-5 w-4 shrink-0 items-center justify-center self-start text-muted-foreground/85">
        <SquareKanban className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground/88">
            <HighlightedText text={result.ref} matchRanges={result.refRanges} />
          </span>
          <span className="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
            <HighlightedText text={result.title} matchRanges={result.titleRanges} />
          </span>
          {result.isOpen ? null : (
            <span className="shrink-0 rounded-[6px] border border-border/60 bg-background/45 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground/88">
              {translate('worktreeJumpPalette.task.doneBadge', 'Done')}
            </span>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-5 text-muted-foreground/88">
          <span className="truncate">
            <HighlightedText text={result.projectName} matchRanges={result.projectRanges} />
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{result.column}</span>
        </div>
      </div>
    </CommandItem>
  )
}
