import { useMemo } from 'react'
import { sortWorktreesSmart } from '@/components/sidebar/smart-sort'
import { buildPaletteWorktreeIndex, resolvePaletteWorktree } from '@/lib/palette-repo-resolution'
import type { Worktree } from '../../../shared/worktree/types'
import { EMPTY_SORTED_WORKTREES } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'
import { buildWorktreeJumpPaletteWorktreeMaps } from './worktree-jump-palette-worktree-maps'

/**
 * The worktrees the palette still needs — to resolve an open tab's workspace and to order it.
 *
 * A worktree is no longer something the palette *finds*: it is how a task is being worked, not a
 * thing a person looks up by name, so there is no worktree document index and no worktree search.
 */
type WorktreeJumpPaletteWorktreesInput = WorktreeJumpPaletteStoreState &
  Pick<WorktreeJumpPaletteFilter, 'filterPredicate' | 'repoMap'> &
  Pick<WorktreeJumpPaletteLocalState, 'paletteSearchQuery'>

export function useWorktreeJumpPaletteWorktrees({
  paletteSearchQuery,
  repos,
  worktreesByRepo,
  agentStatusByPaneKey,
  tabsByWorktree,
  allWorktrees,
  filterPredicate,
  ptyIdsByTabId,
  paletteStatusInputsActive,
  repoMap,
  runtimePaneTitlesByTabId,
  migrationUnsupportedByPtyId,
  terminalLayoutsByTabId
}: WorktreeJumpPaletteWorktreesInput) {
  const hasQuery = paletteSearchQuery.length > 0
  const isLoading = repos.length > 0 && Object.keys(worktreesByRepo).length === 0
  const browserSortedWorktrees = useMemo(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_SORTED_WORKTREES
    }
    const scope = filterPredicate
      ? allWorktrees.filter(filterPredicate.matchesWorktree)
      : allWorktrees
    return sortWorktreesSmart(
      scope,
      tabsByWorktree,
      repoMap,
      agentStatusByPaneKey,
      runtimePaneTitlesByTabId,
      ptyIdsByTabId,
      migrationUnsupportedByPtyId,
      terminalLayoutsByTabId
    )
  }, [
    paletteStatusInputsActive,
    allWorktrees,
    filterPredicate,
    tabsByWorktree,
    repoMap,
    agentStatusByPaneKey,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    migrationUnsupportedByPtyId,
    terminalLayoutsByTabId
  ])
  const paletteWorktreeIndex = useMemo(
    () => buildPaletteWorktreeIndex(browserSortedWorktrees),
    [browserSortedWorktrees]
  )
  const resolveWorktree = useMemo(
    () =>
      (worktreeId: string, hostId: Worktree['hostId'] | undefined): Worktree | undefined =>
        resolvePaletteWorktree(paletteWorktreeIndex, worktreeId, hostId),
    [paletteWorktreeIndex]
  )
  const { worktreeMap, worktreeOrder } = useMemo(
    () => buildWorktreeJumpPaletteWorktreeMaps(browserSortedWorktrees),
    [browserSortedWorktrees]
  )
  return {
    hasQuery,
    isLoading,
    browserSortedWorktrees,
    worktreeMap,
    resolveWorktree,
    paletteWorktreeIndex,
    worktreeOrder
  }
}

export type WorktreeJumpPaletteWorktrees = ReturnType<typeof useWorktreeJumpPaletteWorktrees>
