import { useCallback, useMemo } from 'react'
import { useShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { bestCmdJPaletteSectionQualityClass } from '@/components/cmd-j/palette-results'
import {
  bestPaletteQualityRank,
  NO_PALETTE_QUALITY_RANK,
  shouldIntentSectionLeadPaletteSections,
  shouldOpenTabsLeadPaletteSections
} from '@/lib/cmd-j-section-leadership'
import {
  capPaletteSection,
  layoutMultiPrimaryPaletteSections,
  PALETTE_SECTION_EXPAND_STEP,
  PALETTE_SECTION_RENDER_CAP,
  TYPED_QUERY_LEADING_PREVIEW
} from '@/components/cmd-j/palette-section-render-cap'
import {
  DIGIT_INDEX_ACTION_ID,
  DIGIT_INDEX_ADDRESSABLE_ROWS,
  EMPTY_QUERY_RECENT_TAB_CAP,
  EMPTY_QUERY_ROW_BUDGET,
  EMPTY_QUERY_TASK_CAP,
  type OpenTabPaletteItem,
  type PaletteItem,
  type TaskPaletteItem
} from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteOpenTabs } from './use-worktree-jump-palette-open-tabs'
import type { WorktreeJumpPaletteProjectTargets } from './use-worktree-jump-palette-project-targets'
import type { WorktreeJumpPaletteQuickActions } from './use-worktree-jump-palette-quick-actions'
import type { WorktreeJumpPaletteRecentTabs } from './use-worktree-jump-palette-recent-tabs'
import type { WorktreeJumpPaletteTasks } from './use-worktree-jump-palette-tasks'
import type { WorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'

type WorktreeJumpPaletteSectionsInput = WorktreeJumpPaletteOpenTabs &
  WorktreeJumpPaletteRecentTabs &
  WorktreeJumpPaletteProjectTargets &
  Pick<WorktreeJumpPaletteTasks, 'taskItems'> &
  Pick<WorktreeJumpPaletteQuickActions, 'middleItems'> &
  Pick<WorktreeJumpPaletteWorktrees, 'hasQuery'> &
  Pick<
    WorktreeJumpPaletteLocalState,
    'createWorktreeName' | 'showCreateAction' | 'expandedSectionCaps' | 'setExpandedSectionCaps'
  >

export function useWorktreeJumpPaletteSections({
  hasQuery,
  taskItems,
  openTabItems,
  recentTabItems,
  projectTargetItems,
  middleItems,
  createWorktreeName,
  showCreateAction,
  expandedSectionCaps,
  setExpandedSectionCaps
}: WorktreeJumpPaletteSectionsInput) {
  // Tasks lead the empty-query list: the unit of work comes before the sessions working it.
  const openTabsLeadSections = useMemo(() => {
    if (!hasQuery) {
      return false
    }
    return shouldOpenTabsLeadPaletteSections({
      bestEntityQualityRank: taskItems[0]
        ? bestPaletteQualityRank([taskItems[0].result.qualityClass])
        : NO_PALETTE_QUALITY_RANK,
      bestOpenTabQualityRank: openTabItems[0]
        ? bestPaletteQualityRank([openTabItems[0].result.qualityClass])
        : NO_PALETTE_QUALITY_RANK
    })
  }, [hasQuery, openTabItems, taskItems])

  const middleLeadsSections = useMemo(() => {
    if (!hasQuery) {
      return false
    }
    const bestEntityQualityRank = Math.min(
      taskItems[0]
        ? bestPaletteQualityRank([taskItems[0].result.qualityClass])
        : NO_PALETTE_QUALITY_RANK,
      openTabItems[0]
        ? bestPaletteQualityRank([openTabItems[0].result.qualityClass])
        : NO_PALETTE_QUALITY_RANK
    )
    return shouldIntentSectionLeadPaletteSections({
      bestEntityQualityRank,
      bestIntentQualityRank: bestPaletteQualityRank([
        bestCmdJPaletteSectionQualityClass(middleItems.map((item) => item.result)),
        bestCmdJPaletteSectionQualityClass(projectTargetItems.map((item) => item.result))
      ])
    })
  }, [hasQuery, middleItems, openTabItems, projectTargetItems, taskItems])

  const handleExpandSection = useCallback(
    (sectionKey: string) => {
      setExpandedSectionCaps((previous) => ({
        ...previous,
        [sectionKey]: (previous[sectionKey] ?? 0) + PALETTE_SECTION_EXPAND_STEP
      }))
    },
    [setExpandedSectionCaps]
  )

  const paletteSections = useMemo(() => {
    const openTabsCap = PALETTE_SECTION_RENDER_CAP + (expandedSectionCaps['open-tabs'] ?? 0)
    // Why: "See more" drops the above-the-fold trim outright instead of stepping 20 at a time, so one
    // click reveals the whole recent history the shared render cap allows.
    const recentTabsCap = expandedSectionCaps['open-tabs']
      ? openTabsCap
      : EMPTY_QUERY_RECENT_TAB_CAP
    const openTabs = hasQuery
      ? capPaletteSection(openTabItems, openTabsCap)
      : capPaletteSection(recentTabItems, recentTabsCap)
    // Tasks lead on an empty query, so they take the row budget first and the recent rows fill
    // whatever is left rather than the other way round.
    const baseTaskCap = hasQuery
      ? Infinity
      : Math.min(
          openTabs.visible.length === 0 ? EMPTY_QUERY_ROW_BUDGET : EMPTY_QUERY_TASK_CAP,
          Math.max(1, EMPTY_QUERY_ROW_BUDGET - openTabs.visible.length)
        )
    const taskCap = hasQuery
      ? PALETTE_SECTION_RENDER_CAP + (expandedSectionCaps.tasks ?? 0)
      : baseTaskCap + (expandedSectionCaps.tasks ?? 0)
    const tasks = capPaletteSection(taskItems, taskCap)
    const projectTargets = capPaletteSection(
      hasQuery ? projectTargetItems : [],
      PALETTE_SECTION_RENDER_CAP + (expandedSectionCaps.projects ?? 0)
    )
    const middle = capPaletteSection(
      hasQuery ? middleItems : [],
      PALETTE_SECTION_RENDER_CAP + (expandedSectionCaps.middle ?? 0)
    )
    const multiPrimaryFirstScreen =
      hasQuery && openTabs.visible.length > 0 && tasks.visible.length > 0
    const multiPrimaryLayout = multiPrimaryFirstScreen
      ? layoutMultiPrimaryPaletteSections<TaskPaletteItem | OpenTabPaletteItem>({
          leadingItems: openTabsLeadSections ? openTabItems : taskItems,
          trailingItems: openTabsLeadSections ? taskItems : openTabItems,
          leadingPreviewCount:
            TYPED_QUERY_LEADING_PREVIEW +
            (expandedSectionCaps[openTabsLeadSections ? 'open-tabs' : 'tasks'] ?? 0),
          leadingHardCap: openTabsLeadSections ? openTabsCap : taskCap,
          trailingHardCap: openTabsLeadSections ? taskCap : openTabsCap
        })
      : null
    return {
      visibleTaskItems: tasks.visible as PaletteItem[],
      taskOverflowCount: tasks.overflowCount,
      visibleProjectTargetItems: projectTargets.visible as PaletteItem[],
      projectTargetOverflowCount: projectTargets.overflowCount,
      visibleMiddleItems: middle.visible as PaletteItem[],
      middleOverflowCount: middle.overflowCount,
      visibleOpenTabItems: openTabs.visible as PaletteItem[],
      openTabOverflowCount: openTabs.overflowCount,
      multiPrimaryFirstScreen,
      multiPrimaryLayout
    }
  }, [
    expandedSectionCaps,
    hasQuery,
    middleItems,
    openTabItems,
    openTabsLeadSections,
    projectTargetItems,
    recentTabItems,
    taskItems
  ])

  // Why: badges number the snapshotted recent rows only — ⌘N is meaningless on a typed query, and an
  // expanded section leaves its unaddressable rows unbadged rather than advertising ⌘10.
  const recentTabShortcutIndexByItem = useMemo(
    () =>
      new Map(
        hasQuery
          ? []
          : paletteSections.visibleOpenTabItems
              .slice(0, DIGIT_INDEX_ADDRESSABLE_ROWS)
              .map((item, index) => [item, index])
      ),
    [hasQuery, paletteSections]
  )
  const recentTabShortcutIndexById = useMemo(
    () =>
      new Map(
        hasQuery
          ? []
          : paletteSections.visibleOpenTabItems
              .slice(0, DIGIT_INDEX_ADDRESSABLE_ROWS)
              .map((item, index) => [item.id, index])
      ),
    [hasQuery, paletteSections]
  )
  const digitShortcutModifiers =
    useShortcutKeyComboDetails(DIGIT_INDEX_ACTION_ID)[0]?.keys.slice(0, -1) ?? []

  return {
    openTabsLeadSections,
    middleLeadsSections,
    paletteSections,
    recentTabShortcutIndexByItem,
    recentTabShortcutIndexById,
    digitShortcutModifiers,
    createWorktreeName,
    showCreateAction,
    handleExpandSection
  }
}

export type WorktreeJumpPaletteSections = ReturnType<typeof useWorktreeJumpPaletteSections>
