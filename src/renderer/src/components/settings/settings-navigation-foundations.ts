import type { MutableRefObject } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { SpeechModelState } from '../../../../shared/speech-types'
import type { SourceControlAiSettings } from '../../../../shared/source-control-ai-types'
import { normalizeSourceControlAiSettings } from '../../../../shared/source-control-ai'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import type { SettingsNavSection, SettingsNavTarget } from '@/lib/settings-navigation-types'
import type { SettingsDeepLinkTargetWatch } from './settings-deep-link-target-watcher'

// PRODUCT-ARCHITECTURE §6: every inherited pane gets exactly one home, and the order is the order
// a developer needs them — what this machine does, then who it runs as, then the two altitudes
// that are configuration rather than operation. The remainder is a flat root.
export const SETTINGS_NAV_GROUPS = [
  {
    id: 'device',
    titleKey: 'auto.components.settings.Settings.groupDevice',
    titleDefault: 'Device'
  },
  {
    id: 'account',
    titleKey: 'auto.components.settings.Settings.groupAccount',
    titleDefault: 'Account'
  },
  {
    id: 'project',
    titleKey: 'auto.components.settings.Settings.groupProject',
    titleDefault: 'Project'
  },
  {
    id: 'organisation',
    titleKey: 'auto.components.settings.Settings.groupOrganisation',
    titleDefault: 'Organisation'
  },
  {
    id: 'general',
    titleKey: 'auto.components.settings.Settings.groupGeneral',
    titleDefault: 'General'
  }
] as const

export type SettingsNavGroupDefinition = (typeof SETTINGS_NAV_GROUPS)[number]

const SETTINGS_NAV_GROUP_BY_ID = new Map<string, SettingsNavGroupDefinition>(
  SETTINGS_NAV_GROUPS.map((group) => [group.id, group])
)

export const SHORTCUTS_ESCAPE_CONFIRM_TOAST_ID = 'shortcuts-escape-confirm'
export const SHORTCUTS_ESCAPE_CONFIRM_WINDOW_MS = 2200
export const SETTINGS_TARGET_HIGHLIGHT_MS = 3_000

export function getSettingsSectionId(
  pane: SettingsNavTarget,
  repoId: string | null,
  repoIdToRepresentative: Map<string, string>
): string {
  if (pane === 'repo' && repoId) {
    // Why: Settings renders one collapsed pane per project, so resolve a repoId target to its project's representative section.
    return `repo-${repoIdToRepresentative.get(repoId) ?? repoId}`
  }
  return pane
}

export function getFallbackVisibleSection(
  sections: SettingsNavSection[]
): SettingsNavSection | undefined {
  return sections.at(0)
}

export function getSettingsNavGroupDefinitionsForSearch(
  sections: readonly SettingsNavSection[],
  query: string
): readonly SettingsNavGroupDefinition[] {
  if (query.trim() === '') {
    return SETTINGS_NAV_GROUPS
  }
  const seenGroupIds = new Set<string>()
  return sections.flatMap((section) => {
    if (section.id.startsWith('repo-') || seenGroupIds.has(section.group)) {
      return []
    }
    const group = SETTINGS_NAV_GROUP_BY_ID.get(section.group)
    if (!group) {
      return []
    }
    seenGroupIds.add(section.group)
    return [group]
  })
}

export function hasReadyVoiceModel(
  settings: GlobalSettings,
  modelStates: readonly SpeechModelState[]
): boolean {
  const voiceSettings = settings.voice ?? getDefaultVoiceSettings()
  if (
    voiceSettings.sttModel !== '' &&
    modelStates.some((state) => state.id === voiceSettings.sttModel && state.status === 'ready')
  ) {
    return true
  }
  return modelStates.some((state) => state.status === 'ready')
}

export function getSettingsScrollTarget(
  sectionId: string,
  container?: HTMLElement | null
): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>(`[data-settings-section="${CSS.escape(sectionId)}"]`) ??
    document.getElementById(sectionId)
  )
}

export function scrollSubsectionIntoView(targetId: string, container?: HTMLElement | null): void {
  // Why: the pane is swapped in wholesale, so a subsection deep link only nudges inner scroll when the pane exceeds the viewport.
  const target = getSettingsScrollTarget(targetId, container)
  if (!target) {
    return
  }
  if (!container) {
    target.scrollIntoView({ block: 'start' })
    return
  }
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = targetRect.top - containerRect.top + container.scrollTop
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  container.scrollTo({ top: Math.min(Math.max(0, targetTop - 16), maxScrollTop) })
}

export function readSourceControlAiSettings(settings: GlobalSettings): SourceControlAiSettings {
  return normalizeSourceControlAiSettings(settings.sourceControlAi, settings.commitMessageAi)
}

export function cancelPendingSettingsSubsectionScrollFrame(
  frameRef: MutableRefObject<number | null>
): void {
  if (frameRef.current !== null) {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }
}

export function cancelPendingSettingsDeepLinkTargetWatch(
  watchRef: MutableRefObject<SettingsDeepLinkTargetWatch | null>
): void {
  watchRef.current?.cancel()
  watchRef.current = null
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
