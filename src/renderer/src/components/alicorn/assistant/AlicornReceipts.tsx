/**
 * What this session changed, and the way back.
 *
 * PRODUCT-ARCHITECTURE §3 says every mutation answers with a receipt. A sentence in a transcript
 * is a receipt you have to read and then act on yourself; this is the same receipt as a row you
 * can press. That is the difference between an agent's change being auditable and being
 * *reversible*, and reversibility is what makes letting an agent write at all reasonable.
 *
 * Undo runs through the app's own IPC rather than by asking the agent to undo it. Asking would be
 * a second chance to get it wrong, and deletion is deliberately not in the agent's tool set.
 */
import React from 'react'
import { RotateCcw, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { AlicornReceipt } from '../../../../../shared/alicorn/receipt'
import type { ReceiptEntry } from './alicorn-receipt-feed'

type UndoState = 'idle' | 'running' | 'done' | 'failed'

async function runUndo(undo: NonNullable<AlicornReceipt['undo']>): Promise<boolean> {
  const api = window.api?.alicorn
  if (!api) {
    return false
  }
  const args = undo.args as Record<string, string>
  if (undo.action === 'task.delete') {
    return (await api.deleteTask(args.taskId ?? '')).ok
  }
  if (undo.action === 'project.delete') {
    return (await api.deleteProject(args.projectId ?? '')).ok
  }
  if (undo.action === 'member.delete') {
    return (await api.deleteMember(args.memberId ?? '')).ok
  }
  const { taskId, ...patch } = undo.args as { taskId?: string } & Record<string, unknown>
  return taskId ? (await api.updateTask(taskId, patch)).ok : false
}

function ReceiptRow({ entry }: { entry: ReceiptEntry }): React.JSX.Element {
  const [state, setState] = React.useState<UndoState>('idle')

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.summary}</span>
      {state === 'done' ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="size-3" />
          {translate('auto.components.alicorn.receipts.undone', 'Undone')}
        </span>
      ) : entry.undo ? (
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0 gap-1"
          disabled={state === 'running'}
          onClick={() => {
            setState('running')
            void runUndo(entry.undo!).then((ok) => setState(ok ? 'done' : 'failed'))
          }}
        >
          <RotateCcw className="size-3" />
          {state === 'failed'
            ? translate('auto.components.alicorn.receipts.retry', 'Retry undo')
            : translate('auto.components.alicorn.receipts.undo', 'Undo')}
        </Button>
      ) : null}
    </li>
  )
}

export function AlicornReceipts({
  entries
}: {
  entries: readonly ReceiptEntry[]
}): React.JSX.Element | null {
  const [collapsed, setCollapsed] = React.useState(false)
  if (entries.length === 0) {
    return null
  }
  // Only the recent few: this is a way back from what just happened, not an audit log. The ledger
  // is where the full record lives.
  const shown = collapsed ? [] : entries.slice(0, 4)

  return (
    <section className="shrink-0 border-t border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {entries.length === 1
          ? translate('auto.components.alicorn.receipts.one', '1 change')
          : translate('auto.components.alicorn.receipts.many', '{{count}} changes', {
              count: entries.length
            })}
      </button>
      <ul className="pb-1">
        {shown.map((entry) => (
          <ReceiptRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  )
}
