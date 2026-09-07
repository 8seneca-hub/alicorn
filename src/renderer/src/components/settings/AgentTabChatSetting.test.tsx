// @vitest-environment happy-dom

import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { getDefaultSettings } from '../../../../shared/constants'
import { AgentTabChatSetting } from './AgentTabChatSetting'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

vi.mock('../ui/select', async () => {
  const React = await import('react')

  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
  }>({})

  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => {
      const contextValue = React.useMemo(() => ({ onValueChange }), [onValueChange])
      return (
        <SelectContext.Provider value={contextValue}>
          <div data-slot="native-chat-default-view-select" data-value={value}>
            {children}
          </div>
        </SelectContext.Provider>
      )
    },
    SelectTrigger: ({ children, ...props }: React.ComponentProps<'button'> & { size?: string }) => (
      <button type="button" data-slot="select-trigger" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div data-slot="select-content">{children}</div>
    ),
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const { onValueChange } = React.useContext(SelectContext)
      return (
        <button
          type="button"
          data-slot="select-item"
          data-value={value}
          onClick={() => onValueChange?.(value)}
        >
          {children}
        </button>
      )
    }
  }
})

afterEach(() => {
  document.body.innerHTML = ''
})

// Chat is the shipped default now, so an "off" case has to switch it off explicitly.
function chatDisabledSettings(): GlobalSettings {
  return { ...getDefaultSettings('/tmp'), experimentalNativeChat: false }
}

async function renderAgentTabChatSetting(args: {
  updateSettings: (settings: Partial<GlobalSettings>) => void
  settings?: GlobalSettings
}): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <AgentTabChatSetting
        settings={args.settings ?? getDefaultSettings('/tmp')}
        updateSettings={args.updateSettings}
      />
    )
  })
  return { root, container }
}

describe('AgentTabChatSetting', () => {
  it('shows the structured-native-chat child setting only when Chat UI is the default view', async () => {
    const updateSettings = vi.fn()
    const disabledSettings = chatDisabledSettings()
    const disabledMarkup = renderToStaticMarkup(
      <AgentTabChatSetting settings={disabledSettings} updateSettings={vi.fn()} />
    )
    expect(disabledMarkup).toContain('Chat UI')
    expect(disabledMarkup).not.toContain('Use updated structured native chat')
    expect(disabledMarkup).not.toContain('Default view')

    const terminalDefault = {
      ...getDefaultSettings('/tmp'),
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: false,
      openAgentTabsInChatByDefault: false
    }
    const terminalRender = await renderAgentTabChatSetting({
      updateSettings,
      settings: terminalDefault
    })

    // The default-view control is a sibling of the Chat UI toggle, never replaced by the opt-in.
    expect(terminalRender.container.textContent).toContain('Default view')
    expect(
      terminalRender.container.querySelector('[data-slot="native-chat-default-view-select"]')
    ).not.toBeNull()
    // Structured chat has no entry path under Terminal chat, so its opt-in is not offered.
    expect(terminalRender.container.textContent).not.toContain('Use updated structured native chat')
    terminalRender.root.unmount()

    const { root, container } = await renderAgentTabChatSetting({
      updateSettings,
      settings: { ...terminalDefault, openAgentTabsInChatByDefault: true }
    })

    expect(container.textContent).toContain('Use updated structured native chat')
    // The one opt-in gates both providers, so its copy must not name only Codex.
    expect(container.textContent).toContain(
      'Opt in to the host-owned structured chat runtime for Codex and Claude.'
    )
    expect(container.textContent).toContain(
      'Local sessions only for now. WSL and remote execution hosts (including SSH) continue to use terminal chat, and Windows falls back to it unless Orca can read process start times.'
    )
    expect(container.textContent).toContain('Default view')
    root.unmount()
  })

  it('hides a stale structured opt-in under Terminal chat without clearing it', async () => {
    const updateSettings = vi.fn()
    const settings = {
      ...getDefaultSettings('/tmp'),
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    const { root, container } = await renderAgentTabChatSetting({ updateSettings, settings })

    expect(container.textContent).toContain('Use updated structured native chat')

    const terminalChatOption = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-slot="select-item"]')
    ).find((button) => button.getAttribute('data-value') === 'terminal-chat')
    if (!terminalChatOption) {
      throw new Error('Terminal chat default-view option was not rendered')
    }

    await act(async () => {
      terminalChatOption.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Switching the default view must not clobber the persisted opt-in — only hide its control.
    expect(updateSettings).toHaveBeenCalledWith({ openAgentTabsInChatByDefault: false })
    expect(updateSettings).toHaveBeenCalledTimes(1)
    root.unmount()

    const hidden = await renderAgentTabChatSetting({
      updateSettings,
      settings: { ...settings, openAgentTabsInChatByDefault: false }
    })

    expect(hidden.container.textContent).not.toContain('Use updated structured native chat')
    hidden.root.unmount()

    // Returning to Chat UI restores the control still switched on.
    const restored = await renderAgentTabChatSetting({ updateSettings, settings })
    const structuredSwitch = restored.container.querySelector<HTMLButtonElement>(
      '#agent-tab-chat button[role="switch"][aria-label="Toggle updated structured native chat"]'
    )
    expect(structuredSwitch?.getAttribute('aria-checked')).toBe('true')
    restored.root.unmount()
  })

  it('shows Chat UI default-mode as a child setting only when Chat UI is enabled', async () => {
    const updateSettings = vi.fn()
    const disabledSettings = chatDisabledSettings()
    const disabledMarkup = renderToStaticMarkup(
      <AgentTabChatSetting settings={disabledSettings} updateSettings={vi.fn()} />
    )
    expect(disabledMarkup).toContain('Chat UI')
    expect(disabledMarkup).not.toContain('Default view')

    const settings = {
      ...getDefaultSettings('/tmp'),
      experimentalNativeChat: true,
      openAgentTabsInChatByDefault: false
    }
    const { root, container } = await renderAgentTabChatSetting({ updateSettings, settings })

    expect(container.textContent).toContain('Default view')
    expect(container.textContent).toContain('Terminal chat')
    expect(container.textContent).toContain('Chat UI')
    expect(
      container
        .querySelector('[data-slot="native-chat-default-view-select"]')
        ?.getAttribute('data-value')
    ).toBe('terminal-chat')

    const nativeChatOption = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-slot="select-item"]')
    ).find((button) => button.getAttribute('data-value') === 'native-chat')
    if (!nativeChatOption) {
      throw new Error('Chat UI default-view option was not rendered')
    }

    await act(async () => {
      nativeChatOption.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(updateSettings).toHaveBeenCalledWith({ openAgentTabsInChatByDefault: true })

    root.unmount()

    const nativeSettings = {
      ...settings,
      openAgentTabsInChatByDefault: true
    }
    const secondRender = await renderAgentTabChatSetting({
      updateSettings,
      settings: nativeSettings
    })

    expect(
      secondRender.container
        .querySelector('[data-slot="native-chat-default-view-select"]')
        ?.getAttribute('data-value')
    ).toBe('native-chat')

    const terminalChatOption = Array.from(
      secondRender.container.querySelectorAll<HTMLButtonElement>('[data-slot="select-item"]')
    ).find((button) => button.getAttribute('data-value') === 'terminal-chat')
    if (!terminalChatOption) {
      throw new Error('Terminal chat default-view option was not rendered')
    }

    await act(async () => {
      terminalChatOption.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(updateSettings).toHaveBeenCalledWith({ openAgentTabsInChatByDefault: false })

    secondRender.root.unmount()
  })

  // The two controls are nested, but each still writes only its own key.
  it('never writes one Chat UI child setting while changing the other', async () => {
    const updateSettings = vi.fn()
    const settings = {
      ...getDefaultSettings('/tmp'),
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: false,
      openAgentTabsInChatByDefault: true
    }
    const { root, container } = await renderAgentTabChatSetting({ updateSettings, settings })

    const structuredSwitch = container.querySelector<HTMLButtonElement>(
      '#agent-tab-chat button[role="switch"][aria-label="Toggle updated structured native chat"]'
    )
    if (!structuredSwitch) {
      throw new Error('Structured native chat switch was not rendered')
    }

    await act(async () => {
      structuredSwitch.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(updateSettings).toHaveBeenCalledWith({ experimentalStructuredNativeChat: true })

    const terminalChatOption = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-slot="select-item"]')
    ).find((button) => button.getAttribute('data-value') === 'terminal-chat')
    if (!terminalChatOption) {
      throw new Error('Terminal chat default-view option was not rendered')
    }

    await act(async () => {
      terminalChatOption.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(updateSettings).toHaveBeenCalledWith({ openAgentTabsInChatByDefault: false })
    expect(updateSettings).toHaveBeenCalledTimes(2)
    root.unmount()
  })
})
