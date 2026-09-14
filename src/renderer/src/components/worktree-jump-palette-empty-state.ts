import { translate } from '@/i18n/i18n'
import type { WorktreeJumpPaletteController } from './use-worktree-jump-palette-controller'

export function getWorktreeJumpPaletteResultCount(
  controller: WorktreeJumpPaletteController
): number {
  return controller.hasQuery
    ? controller.taskItems.length +
        controller.projectTargetItems.length +
        controller.middleItems.length +
        controller.openTabItems.length
    : controller.selectableItems.length
}

export function getWorktreeJumpPaletteEmptyState(controller: WorktreeJumpPaletteController): {
  title: string
  subtitle: string
} {
  if (controller.filterActive) {
    return {
      title: translate(
        'worktreeJumpPalette.filter.emptyTitle',
        'No results match the active filter'
      ),
      subtitle: translate(
        'worktreeJumpPalette.filter.emptySubtitle',
        'Clear the filter above, or widen it to more hosts and projects.'
      )
    }
  }
  if (
    (controller.hasAnyTasks ||
      controller.hasAnyProjectSearchCandidates ||
      controller.hasAnyMiddleResults ||
      controller.hasAnyOpenTabs) &&
    controller.hasQuery
  ) {
    return {
      title: translate(
        'auto.components.WorktreeJumpPalette.dbd9d87eec',
        'No results match your search'
      ),
      subtitle: translate(
        'worktreeJumpPalette.emptyQuerySubtitle',
        'Try a task reference or title, a project, a setting, an action, a tab title, an agent prompt, a URL, a PR, or a port.'
      )
    }
  }
  return {
    title: translate(
      'worktreeJumpPalette.nothingToShowTitle',
      'No tasks, settings, actions, or open tabs'
    ),
    subtitle: translate(
      'worktreeJumpPalette.nothingToShowSubtitle',
      'Create a task or open a tab in Alicorn to get started.'
    )
  }
}
