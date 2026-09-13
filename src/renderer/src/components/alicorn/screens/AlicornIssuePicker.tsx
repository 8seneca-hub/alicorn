/**
 * Choosing one issue off a PM board.
 *
 * A plain select was the wrong control the moment a real board turned up: this repository's own
 * Plane project has 117 open issues, and a 117-row list you can only scroll is a list you cannot
 * use. You already know the reference — you type `ALC-113`, or three words of the title.
 *
 * Filtering is on the reference *and* the title, because half the time you remember one and half
 * the time the other.
 */
import React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type IssueOption = {
  id: string
  ref: string
  title: string
}

export function AlicornIssuePicker({
  issues,
  loading,
  selectedRef,
  boardLabel,
  onSelect
}: {
  issues: readonly IssueOption[]
  loading: boolean
  selectedRef: string | null
  /** The board's own identifier, so the placeholder says which tracker this reaches. */
  boardLabel: string
  onSelect: (issue: IssueOption) => void
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const selected = issues.find((issue) => issue.ref === selectedRef) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          id="alicorn-task-issue"
          aria-label={translate('auto.components.alicorn.newTask.fromIssue', 'From an issue')}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 text-left text-xs"
        >
          <span className={cn('min-w-0 flex-1 truncate', selected ? '' : 'text-muted-foreground')}>
            {selected
              ? `${selected.ref} · ${selected.title}`
              : loading
                ? translate('auto.components.alicorn.newTask.issuesLoading', 'Reading the board…')
                : translate(
                    'auto.components.alicorn.newTask.issuePlaceholder',
                    'Search {{board}} — type a reference or a few words',
                    { board: boardLabel }
                  )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          // The reference and the title are one haystack: you remember one or the other.
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder={translate(
              'auto.components.alicorn.newTask.issueSearch',
              'ALC-113, or “outbox dedupe”'
            )}
            className="text-xs"
          />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              {loading
                ? translate('auto.components.alicorn.newTask.issuesLoading', 'Reading the board…')
                : translate('auto.components.alicorn.newTask.noIssue', 'No issue matches that.')}
            </CommandEmpty>
            {issues.map((issue) => (
              <CommandItem
                key={issue.id}
                value={`${issue.ref} ${issue.title}`}
                onSelect={() => {
                  onSelect(issue)
                  setOpen(false)
                }}
                className="gap-2 text-xs"
              >
                <Check
                  className={cn(
                    'size-3.5 shrink-0',
                    issue.ref === selectedRef ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {issue.ref}
                </span>
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
