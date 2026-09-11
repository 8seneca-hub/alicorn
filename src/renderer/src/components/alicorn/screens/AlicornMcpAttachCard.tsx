/**
 * Giving this project's agents the Alicorn control plane.
 *
 * One click writes the `alicorn` server into the repository's `.mcp.json`, which is what every
 * Claude session in that repository reads — however Orca launched it. That is deliberately a
 * click and not a silent write on bind: `.mcp.json` is usually a tracked file, and committing a
 * server to someone's repository without asking is not ours to do.
 *
 * The merge, the refusal on an unparseable file, and the SSH write expectation are all the add-server
 * dialog's own path (`writeMcpServerToConfig`), so a config this touches behaves exactly like one a
 * developer edited through Settings.
 */
import React from 'react'
import { Plug, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { joinPath } from '@/lib/path'
import { writeMcpServerToConfig } from '../../settings/mcp-add-server-write'
import { ALICORN_MCP_SERVER_DRAFT } from '../../../../../shared/alicorn/alicorn-mcp-server-draft'
import type { Repo } from '../../../../../shared/repo-types'

type Status = 'idle' | 'writing' | 'attached' | 'refused' | 'failed'

export function AlicornMcpAttachCard({ repo }: { repo: Repo }): React.JSX.Element {
  const [status, setStatus] = React.useState<Status>('idle')
  const [detail, setDetail] = React.useState<string | null>(null)

  const attach = async (): Promise<void> => {
    setStatus('writing')
    setDetail(null)
    const outcome = await writeMcpServerToConfig({
      targetPath: joinPath(repo.path, '.mcp.json'),
      connectionId: repo.connectionId ?? undefined,
      draft: ALICORN_MCP_SERVER_DRAFT
    })
    if (outcome.status === 'added' || outcome.status === 'replaced') {
      setStatus('attached')
      return
    }
    if (outcome.status === 'refused') {
      setStatus('refused')
      setDetail(
        outcome.reason === 'unreadable'
          ? translate(
              'auto.components.alicorn.mcpAttach.unreadable',
              'The repository’s .mcp.json could not be parsed, so it was left exactly as it is. Open it and fix the JSON first.'
            )
          : translate('auto.components.alicorn.mcpAttach.invalidName', 'Refused the server name.')
      )
      return
    }
    setStatus('failed')
    setDetail(outcome.status === 'failed' ? outcome.message : null)
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold">
            {translate('auto.components.alicorn.mcpAttach.title', 'Alicorn’s control plane')}
          </h2>
          <p className="mt-1 max-w-[620px] text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.mcpAttach.detail',
              'Lets this repository’s agents read and change Alicorn in words — create a task, move one, add a member. Every change comes back with a receipt saying what it did and how to undo it. Required checks, autonomy and hard stops are not exposed: a member may not author the criteria that judge it.'
            )}
          </p>
          {detail ? <p className="mt-2 text-[11px] text-destructive">{detail}</p> : null}
        </div>
        {status === 'attached' ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            <Check className="size-3" />
            {translate('auto.components.alicorn.mcpAttach.attached', 'Added to .mcp.json')}
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={status === 'writing'}
            onClick={() => void attach()}
          >
            {translate('auto.components.alicorn.mcpAttach.attach', 'Add to this repository')}
          </Button>
        )}
      </div>
    </section>
  )
}
