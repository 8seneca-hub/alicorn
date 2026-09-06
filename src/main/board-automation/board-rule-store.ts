import type { BoardAutomationRule, GlobalSettings } from '../../shared/global-settings-types'

export type BoardRuleStore = {
  /** The enabled rule for this column, or null. */
  findRule: (repoId: string, toStatusId: string) => BoardAutomationRule | null
}

// Why a lookup rather than a list: the engine only ever asks "does this column dispatch?", and
// keeping the search here means the caller cannot accidentally act on a disabled rule.
export function createBoardRuleStore(getSettings: () => GlobalSettings | null): BoardRuleStore {
  return {
    findRule: (repoId, toStatusId) => {
      const rules = getSettings()?.boardAutomation?.rules ?? []
      return (
        rules.find(
          (rule) => rule.enabled && rule.repoId === repoId && rule.toStatusId === toStatusId
        ) ?? null
      )
    }
  }
}

/**
 * Fills a rule's prompt template.
 *
 * Unknown placeholders are left as written rather than blanked: a prompt that still shows
 * `{{issue}}` tells the author the template is wrong, where an empty string silently briefs an
 * agent with a hole in it.
 */
export function renderBoardPromptTemplate(
  template: string,
  values: Record<string, string | null | undefined>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, key: string) => {
    const value = values[key]
    return value === null || value === undefined ? whole : value
  })
}
