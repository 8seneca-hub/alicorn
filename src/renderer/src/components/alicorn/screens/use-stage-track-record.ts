/**
 * The windowed track record for one stage, for the screen that shows progress towards its bar.
 *
 * Read rather than derived: this is the same record `gateReasonFor` reads, so a screen saying "4 of
 * 10 runs" and an engine refusing the run cannot disagree about why. A stage with no member has
 * earned nothing and asks for nothing.
 */
import React from 'react'
import type { TrackRecord } from '../../../../../shared/alicorn/gate-policy'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'

export function useStageTrackRecord(
  projectId: string,
  stage: Pick<WorkflowStage, 'key' | 'memberId'>
): TrackRecord | null {
  const [record, setRecord] = React.useState<TrackRecord | null>(null)
  const memberId = stage.memberId

  React.useEffect(() => {
    if (!memberId) {
      setRecord(null)
      return
    }
    let cancelled = false
    void (async () => {
      const result = await window.api?.alicorn?.getTrackRecord?.({
        projectId,
        stageKey: stage.key,
        memberId
      })
      if (!cancelled) {
        setRecord(result?.ok ? result.record : null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, stage.key, memberId])

  return record
}
