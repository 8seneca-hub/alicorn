import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { NativeChatSupportedAgents } from './NativeChatSupportedAgents'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getAgentTabChatSearchEntry } from './agent-tab-chat-search-entry'

type NativeChatDefaultView = 'terminal-chat' | 'native-chat'

type AgentTabChatSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function AgentTabChatSetting({
  settings,
  updateSettings
}: AgentTabChatSettingProps): React.JSX.Element {
  const nativeChatEnabled = settings.experimentalNativeChat === true
  const structuredNativeChatEnabled = settings.experimentalStructuredNativeChat === true
  const defaultView: NativeChatDefaultView =
    settings.openAgentTabsInChatByDefault === true ? 'native-chat' : 'terminal-chat'

  return (
    <SearchableSetting
      title={translate('auto.components.settings.AgentTabChatSetting.909632a38c', 'Agent tab chat')}
      description={translate(
        'auto.components.settings.AgentTabChatSetting.4920efcb62',
        'How supported agent tabs open: the chat surface, or the terminal.'
      )}
      keywords={getAgentTabChatSearchEntry().keywords}
      className="space-y-3 py-2"
      id="agent-tab-chat"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate('auto.components.settings.ExperimentalPane.nativeChat.title', 'Chat UI')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.AgentTabChatSetting.f1046e8629',
              'Renders newly created supported local sessions as chat. Existing terminal sessions keep the terminal chat path.'
            )}
          </p>
          <NativeChatSupportedAgents />
        </div>
        <SettingsSwitch
          checked={nativeChatEnabled}
          ariaLabel={translate(
            'auto.components.settings.ExperimentalPane.nativeChat.toggleLabel',
            'Toggle Chat UI'
          )}
          onChange={() =>
            updateSettings({
              experimentalNativeChat: !nativeChatEnabled
            })
          }
        />
      </div>
      {nativeChatEnabled ? (
        <div className="ml-4 space-y-4 border-l border-border pl-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 shrink space-y-0.5">
              <Label>
                {translate(
                  'auto.components.settings.ExperimentalPane.nativeChat.defaultTitle',
                  'Default view'
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.ExperimentalPane.nativeChat.defaultCopy',
                  'Choose how new supported agent terminal tabs open.'
                )}
              </p>
            </div>
            <Select
              value={defaultView}
              onValueChange={(value: NativeChatDefaultView) => {
                updateSettings({
                  openAgentTabsInChatByDefault: value === 'native-chat'
                })
              }}
            >
              <SelectTrigger
                aria-label={translate(
                  'auto.components.settings.ExperimentalPane.nativeChat.defaultViewLabel',
                  'Default Chat UI view'
                )}
                className="w-36"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" sideOffset={4} avoidCollisions={false}>
                <SelectItem value="terminal-chat">
                  {translate(
                    'auto.components.settings.ExperimentalPane.nativeChat.defaultViewTerminal',
                    'Terminal chat'
                  )}
                </SelectItem>
                <SelectItem value="native-chat">
                  {translate(
                    'auto.components.settings.ExperimentalPane.nativeChat.defaultViewNative',
                    'Chat UI'
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Structured chat rides the Chat UI default view; it has no entry path under Terminal
              chat. Hidden only — the opt-in keeps its persisted value for when Chat UI returns. */}
          {defaultView === 'native-chat' ? (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 shrink space-y-0.5">
                <Label>
                  {translate(
                    'auto.components.settings.ExperimentalPane.nativeChat.structuredTitle',
                    'Use updated structured native chat'
                  )}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.ExperimentalPane.nativeChat.structuredCopy',
                    'Opt in to the host-owned structured chat runtime for Codex and Claude. Off keeps the existing terminal-backed chat path.'
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.ExperimentalPane.nativeChat.structuredScope',
                    'Local sessions only for now. WSL and remote execution hosts (including SSH) continue to use terminal chat, and Windows falls back to it unless Orca can read process start times.'
                  )}
                </p>
              </div>
              <SettingsSwitch
                checked={structuredNativeChatEnabled}
                ariaLabel={translate(
                  'auto.components.settings.ExperimentalPane.nativeChat.structuredToggleLabel',
                  'Toggle updated structured native chat'
                )}
                onChange={() =>
                  updateSettings({
                    experimentalStructuredNativeChat: !structuredNativeChatEnabled
                  })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </SearchableSetting>
  )
}
