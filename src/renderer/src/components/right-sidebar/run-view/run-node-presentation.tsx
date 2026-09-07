import React from 'react'
import { CircleCheck, CircleDashed, CircleSlash, CircleX, LoaderCircle } from 'lucide-react'
import type { ForemanNodeStatus, ForemanRunStatus } from '../../../../../shared/alicorn/foreman-run'

// Mirrors CHECK_ICON/CHECK_COLOR in checks-panel so a dispatched node reads the same as a running
// check. STYLEGUIDE reserves the git decoration tokens for git status, so these are the plain
// state colours the checks panel already established.
export const NODE_ICON: Record<ForemanNodeStatus, React.ComponentType<{ className?: string }>> = {
  pending: CircleDashed,
  dispatched: LoaderCircle,
  done: CircleCheck,
  failed: CircleX,
  blocked: CircleSlash
}

export const NODE_COLOR: Record<ForemanNodeStatus, string> = {
  pending: 'text-muted-foreground',
  dispatched: 'text-amber-500',
  done: 'text-emerald-500',
  failed: 'text-rose-500',
  blocked: 'text-rose-500'
}

/** Badge classes for the run's own status, matching `prStateColor`'s tinted-outline shape. */
export const RUN_STATUS_COLOR: Record<ForemanRunStatus, string> = {
  planning: 'bg-muted text-muted-foreground/70 border-border',
  running: 'bg-amber-500/15 text-amber-500 border-amber-500/20',
  paused: 'bg-muted text-muted-foreground/70 border-border',
  blocked: 'bg-destructive/10 text-destructive border-destructive/20',
  done: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  failed: 'bg-destructive/10 text-destructive border-destructive/20'
}
