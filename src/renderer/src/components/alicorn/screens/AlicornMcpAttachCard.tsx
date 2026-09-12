/**
 * Where this project's agents get the Alicorn control plane.
 *
 * A session Alicorn starts already holds it: the host passes `--mcp-config` pointing at Alicorn's
 * own config, so nothing has to be written into the repository for a task or a project chat to
 * reach the board. The one thing that file buys is *other* agents — a bare `claude` in a terminal,
 * another editor, a teammate who cloned the repo — and that is why it stays a click rather than a
 * silent write: `.mcp.json` is usually tracked, and committing a server to someone's repository
 * without asking is not ours to do.
 *
 * The state is read from the file, never from having clicked. A card that says "added" because
 * this render remembers a click is a card that lies after a revert, a branch switch or a reload.
 */
import React from 'react'
import { Check, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { joinPath } from '@/lib/path'
import { writeMcpServerToConfig } from '../../settings/mcp-add-server-write'
import { loadMcpConfigInspections } from '../../settings/mcp-config-inspection'
import {
  ALICORN_MCP_SERVER_DRAFT,
  hasAlicornMcpServer
} from '../../../../../shared/alicorn/alicorn-mcp-server-draft'
import type { Repo } from '../../../../../shared/repo-types'

type Status = 'reading' | 'absent' | 'writing' | 'present' | 'refused' | 'failed'

const WORKSPACE_CONFIG = '.mcp.json'

async function readIsAttached(repo: Repo): Promise<boolean> {
  const inspections = await loadMcpConfigInspections(repo.path, repo.connectionId ?? undefined)
  const workspace = inspections.find(
    (inspection) => inspection.candidate.relativePath === WORKSPACE_CONFIG
  )
  return hasAlicornMcpServer((workspace?.servers ?? []).map((server) => server.name))
}

export function AlicornMcpAttachCard({
  repo,
  onWritten
}: {
  repo: Repo
  /** Lets the config list beside this card re-read the file this just changed. */
  onWritten?: () => void
}): React.JSX.Element {
  const [status, setStatus] = React.useState<Status>('reading')
  const [detail, setDetail] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setStatus('reading')
    void (async () => {
      try {
        const attached = await readIsAttached(repo)
        if (!cancelled) {
          setStatus(attached ? 'present' : 'absent')
        }
      } catch {
        // An unreadable workspace is not evidence the server is missing, but offering the write is
        // still the only useful thing to show.
        if (!cancelled) {
          setStatus('absent')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repo])

  const attach = async (): Promise<void> => {
    setStatus('writing')
    setDetail(null)
    const outcome = await writeMcpServerToConfig({
      targetPath: joinPath(repo.path, WORKSPACE_CONFIG),
      connectionId: repo.connectionId ?? undefined,
      draft: ALICORN_MCP_SERVER_DRAFT
    })
    if (outcome.status === 'added' || outcome.status === 'replaced') {
      setStatus('present')
      onWritten?.()
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
              'auto.components.alicorn.mcpAttach.alreadyOn',
              'Every session Alicorn starts already holds these tools — a task’s session and the project chat reach the board without anything being written here. Required checks, autonomy and hard stops are not exposed: a member may not author the criteria that judge it.'
            )}
          </p>
          <p className="mt-2 max-w-[620px] text-[12.5px] text-muted-foreground">
            {status === 'present'
              ? translate(
                  'auto.components.alicorn.mcpAttach.inRepo',
                  'It is also in this repository’s .mcp.json, so agents Alicorn did not start — a bare claude in a terminal, another editor — reach it too.'
                )
              : translate(
                  'auto.components.alicorn.mcpAttach.forOthers',
                  'Adding it to this repository’s .mcp.json extends that to agents Alicorn did not start: a bare claude in a terminal, or another editor.'
                )}
          </p>
          {detail ? <p className="mt-2 text-[11px] text-destructive">{detail}</p> : null}
        </div>
        {status === 'present' ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            <Check className="size-3" />
            {translate('auto.components.alicorn.mcpAttach.attached', 'Added to .mcp.json')}
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={status === 'writing' || status === 'reading'}
            onClick={() => void attach()}
          >
            {translate('auto.components.alicorn.mcpAttach.attach', 'Add to this repository')}
          </Button>
        )}
      </div>
    </section>
  )
}
