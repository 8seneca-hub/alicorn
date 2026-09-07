import { describe, expect, it } from 'vitest'
import { getAgentTabChatSearchEntry } from './agent-tab-chat-search-entry'
import { matchesSettingsSearch } from './settings-search'

describe('agent tab chat search entry', () => {
  it.each(['openclaude', 'omp'])('matches the supported-agent keyword %s', (query) => {
    expect(matchesSettingsSearch(query, getAgentTabChatSearchEntry())).toBe(true)
  })

  // The setting left the Experimental pane; searching there must no longer surface it.
  it('no longer answers to "experimental"', () => {
    expect(matchesSettingsSearch('experimental', getAgentTabChatSearchEntry())).toBe(false)
  })
})
