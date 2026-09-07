import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { decideInitialAgentTabViewMode } from './native-chat-initial-view-mode'

// Alicorn UI2a: chat is the default agent tab surface, so fresh settings alone must reach 'chat'.
describe('agent tab chat by default', () => {
  it('opens a supported agent tab in chat on fresh settings', () => {
    const settings = getDefaultSettings('/tmp')
    expect(
      decideInitialAgentTabViewMode({
        experimentalNativeChat: settings.experimentalNativeChat,
        openAgentTabsInChatByDefault: settings.openAgentTabsInChatByDefault,
        agent: 'codex'
      })
    ).toBe('chat')
  })

  it('still leaves an unsupported agent on the terminal path', () => {
    const settings = getDefaultSettings('/tmp')
    expect(
      decideInitialAgentTabViewMode({
        experimentalNativeChat: settings.experimentalNativeChat,
        openAgentTabsInChatByDefault: settings.openAgentTabsInChatByDefault,
        agent: null
      })
    ).toBeUndefined()
  })
})
