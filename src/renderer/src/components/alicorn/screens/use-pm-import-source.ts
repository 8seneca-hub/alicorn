/**
 * Which PM tools are connected, and what boards each holds.
 *
 * Not what is *on* a board. An import brings the project across and leaves its issues in the
 * tracker they already live in, so there is nothing here that reads them.
 *
 * Every provider answers in one shape (`PmBoard`), so the dialog is a list and a picker rather than
 * three branches — and a project records which provider it came from, so two projects in one org
 * can sit on different trackers.
 */
import React from 'react'
import {
  isPmProviderConnected,
  listPmBoards,
  PM_PROVIDERS,
  type PmBoard,
  type PmProvider
} from './pm-import-providers'

export type PmImportSource = {
  /** Null while the first status read is in flight. */
  connected: readonly PmProvider[] | null
  boards: PmBoard[]
  loading: boolean
  error: string | null
}

export function usePmImportSource(provider: PmProvider | null): PmImportSource {
  const [connected, setConnected] = React.useState<readonly PmProvider[] | null>(null)
  const [boards, setBoards] = React.useState<PmBoard[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const answers = await Promise.all(
        PM_PROVIDERS.map(
          async (candidate) => [candidate, await isPmProviderConnected(candidate)] as const
        )
      )
      if (!cancelled) {
        setConnected(answers.filter(([, ok]) => ok).map(([name]) => name))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!provider) {
      setBoards([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      const listed = await listPmBoards(provider)
      if (cancelled) {
        return
      }
      if (listed.ok) {
        setBoards(listed.boards)
      } else {
        setError(listed.error)
        setBoards([])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [provider])

  return { connected, boards, loading, error }
}
