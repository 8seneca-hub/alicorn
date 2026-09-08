import { CircleCheck, CircleDashed, CircleX } from 'lucide-react'
import type React from 'react'
import type { ProvenanceCheckView } from '../../../../../shared/alicorn/provenance-view'

export const CHECK_ICON: Record<
  ProvenanceCheckView['status'],
  React.ComponentType<{ className?: string }>
> = {
  passed: CircleCheck,
  failed: CircleX,
  error: CircleX,
  skipped: CircleDashed
}

// A check that errored and a check that failed read the same: neither is evidence of a pass.
const CHECK_FAILED = 'text-rose-500'

export const CHECK_COLOR: Record<ProvenanceCheckView['status'], string> = {
  passed: 'text-emerald-500',
  failed: CHECK_FAILED,
  error: CHECK_FAILED,
  skipped: 'text-muted-foreground'
}
