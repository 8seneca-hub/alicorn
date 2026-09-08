import { useCallback, useEffect, useState } from 'react'
import type {
  ContextCaptureDetailResult,
  RunInspectorViewResult
} from '../../../../../shared/alicorn/run-inspector-view'
import { useLedgerBranchTarget, type LedgerBranchTarget } from '../use-ledger-branch-target'

/** Same cadence as PV1's panel, for the same reason: a run settles at dispatch speed. */
export const RUN_INSPECTOR_POLL_MS = 15_000

export type ContextInspectorState = {
  /** Null while the first read of the current target is still in flight. */
  result: RunInspectorViewResult | null
  target: LedgerBranchTarget | null
  /** Null until a reader picks a run; the read then defaults to the branch's newest. */
  runId: string | null
  selectRun: (runId: string) => void
  refresh: () => void
}

export function useContextInspectorState({
  isVisible
}: {
  isVisible: boolean
}): ContextInspectorState {
  const target = useLedgerBranchTarget()
  const repoId = target?.repoId ?? null
  const branch = target?.branch ?? null

  const [result, setResult] = useState<RunInspectorViewResult | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])

  const read = useCallback(async (): Promise<RunInspectorViewResult | null> => {
    // A render surface under test may not install window.api — degrade to "nothing to read".
    if (!repoId || !branch || !window.api?.alicorn?.getRunInspector) {
      return null
    }
    return window.api.alicorn.getRunInspector({ repoId, branch, runId })
  }, [repoId, branch, runId])

  // Never show the previous branch's run under a new one, and never carry its run id across.
  useEffect(() => {
    setResult(null)
    setRunId(null)
  }, [repoId, branch])

  useEffect(() => {
    if (!isVisible || !repoId || !branch) {
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      const next = await read()
      if (!cancelled) {
        setResult(next)
      }
    }
    void load()
    // Polling stops with the panel: a closed panel must not keep the control plane busy.
    const timer = setInterval(() => void load(), RUN_INSPECTOR_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isVisible, read, refreshCount, repoId, branch])

  return { result, target, runId, selectRun: setRunId, refresh }
}

/**
 * One dispatch's body, read only while it is open. Deliberately not polled: a capture is written
 * once at dispatch and never amended, so re-reading 64 KiB on a timer would buy nothing.
 */
export function useContextCapture(
  runId: string | null,
  dispatchId: string | null
): ContextCaptureDetailResult | null {
  const [result, setResult] = useState<ContextCaptureDetailResult | null>(null)

  useEffect(() => {
    setResult(null)
    if (!runId || !dispatchId || !window.api?.alicorn?.getContextCapture) {
      return
    }
    let cancelled = false
    void window.api.alicorn.getContextCapture({ runId, dispatchId }).then((next) => {
      if (!cancelled) {
        setResult(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [runId, dispatchId])

  return result
}
