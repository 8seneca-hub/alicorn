/**
 * The servers every project on this machine gets.
 *
 * Alicorn's config panel is workspace-relative by construction — it inspects `.mcp.json`,
 * `.cursor/mcp.json` and the two Claude files *inside the repository*. Claude Code also reads a
 * user-scope config in the home directory, and a server configured there is invisible to that
 * panel while being very much present in every session. This is that file.
 *
 * Read in main, not here: `fs:readFile` is sandboxed to workspace directories on purpose and the
 * home directory is deliberately outside it. Read-only for a second reason — it is not this
 * project's file to change, since a write would reach every other project on the machine.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import type { McpServerSummary } from '../../../../../shared/mcp-config'

function useGlobalMcpServers(): { path: string; servers: McpServerSummary[] } | null {
  const [state, setState] = React.useState<{ path: string; servers: McpServerSummary[] } | null>(
    null
  )

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const read = await window.api?.alicorn?.mcpGlobalServers?.()
      if (!cancelled && read?.ok) {
        setState({ path: read.path, servers: read.servers })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

export function AlicornGlobalMcpSection(): React.JSX.Element | null {
  const config = useGlobalMcpServers()

  if (!config || config.servers.length === 0) {
    return null
  }

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold">
          {translate('auto.components.alicorn.mcpGlobal.title', 'Every project on this machine')}
        </h2>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{config.path}</span>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {config.servers.map((server) => (
          <li key={server.name} className="flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate font-medium">{server.name}</span>
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {server.transport}
            </span>
            <span className="min-w-0 max-w-[45%] shrink-0 truncate font-mono text-[11px] text-muted-foreground">
              {server.url ?? server.command ?? ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-[620px] text-[11px] text-muted-foreground">
        {translate(
          'auto.components.alicorn.mcpGlobal.detail',
          'Claude Code reads these for every project, so they are listed here rather than edited here — a change would reach every other project on this machine.'
        )}
      </p>
    </section>
  )
}
