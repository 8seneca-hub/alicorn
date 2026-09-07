import type { Tab, TabGroup } from './tab-types'

/**
 * Version 2 of the persisted tab model: a tab is a session.
 *
 * v1 keyed tabs and groups by worktree (`Record<worktreeId, Tab[]>`), which made the workspace the
 * identity and a tab a thing inside it. Alicorn's unit of work is a ticket, so the session is the
 * identity and the workspace is a field on it — `Tab.worktreeId` and `TabGroup.worktreeId` already
 * carry it, which is what makes the two shapes inter-derivable rather than a rewrite.
 *
 * Lives in `shared/` rather than `main/persistence/`: the renderer owns both the serializer and the
 * hydrator for this state, and the main process reads the v1 projection in fourteen places. A module
 * under `main/` is unreachable from the renderer, so it could not be the one definition of the
 * mapping — and two definitions of a migration is how a migration goes wrong.
 */
export const TAB_MODEL_VERSION_V2 = 2

export type SessionKeyedTabModel = {
  /** Every tab in the session, keyed by its own id — the session id. */
  sessionsById: Record<string, Tab>
  /** Every group, keyed by group id. Named for the sessions it holds, not for its own key. */
  tabGroupsBySession: Record<string, TabGroup>
}

export type WorktreeKeyedTabModel = {
  unifiedTabs: Record<string, Tab[]>
  tabGroups: Record<string, TabGroup[]>
}

/**
 * Why insertion order carries the array order: JavaScript preserves insertion order for string keys
 * that are not array indices, and both key spaces qualify — a tab id is a UUID or an absolute file
 * path, a group id is a UUID. `numericLikeSessionIds` below is the guard that keeps that true: an
 * integer-like id would be hoisted to the front of the object and silently reorder the tab strip, so
 * the conversion refuses to rely on insertion order when it sees one and records the order instead.
 */
function isArrayIndexKey(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key) && Number(key) <= 2 ** 32 - 2
}

export function numericLikeSessionIds(model: SessionKeyedTabModel): string[] {
  return [...Object.keys(model.sessionsById), ...Object.keys(model.tabGroupsBySession)].filter(
    isArrayIndexKey
  )
}

export function toSessionKeyedTabModel(v1: WorktreeKeyedTabModel): SessionKeyedTabModel {
  const sessionsById: Record<string, Tab> = {}
  const tabGroupsBySession: Record<string, TabGroup> = {}
  for (const tabs of Object.values(v1.unifiedTabs)) {
    for (const tab of tabs) {
      sessionsById[tab.id] = tab
    }
  }
  for (const groups of Object.values(v1.tabGroups)) {
    for (const group of groups) {
      tabGroupsBySession[group.id] = group
    }
  }
  return { sessionsById, tabGroupsBySession }
}

export function toWorktreeKeyedTabModel(v2: SessionKeyedTabModel): WorktreeKeyedTabModel {
  const unifiedTabs: Record<string, Tab[]> = {}
  const tabGroups: Record<string, TabGroup[]> = {}
  for (const tab of Object.values(v2.sessionsById)) {
    ;(unifiedTabs[tab.worktreeId] ??= []).push(tab)
  }
  for (const group of Object.values(v2.tabGroupsBySession)) {
    ;(tabGroups[group.worktreeId] ??= []).push(group)
  }
  return { unifiedTabs, tabGroups }
}
