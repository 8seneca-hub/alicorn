import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export function PlaneConnectForm({ onConnected }: { onConnected: () => void }): React.JSX.Element {
  const connectPlane = useAppStore((s) => s.connectPlane)
  const [baseUrl, setBaseUrl] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const submit = async (): Promise<void> => {
    setConnecting(true)
    setError(null)
    const result = await connectPlane({ baseUrl, workspaceSlug, apiKey })
    setConnecting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    // Why clear the key and not the URL: reconnecting the same workspace with a
    // rotated key is the common case, and the key must not linger in state.
    setApiKey('')
    onConnected()
  }

  return (
    <div className="space-y-2">
      <Input
        value={baseUrl}
        className="h-7 text-xs"
        placeholder={translate(
          'auto.components.settings.plane.integration.card.urlPlaceholder',
          'https://plane.example.com'
        )}
        aria-label={translate('auto.components.settings.plane.integration.card.url', 'Plane URL')}
        onChange={(event) => setBaseUrl(event.target.value)}
      />
      <Input
        value={workspaceSlug}
        className="h-7 text-xs"
        placeholder={translate(
          'auto.components.settings.plane.integration.card.slugPlaceholder',
          'workspace-slug'
        )}
        aria-label={translate(
          'auto.components.settings.plane.integration.card.slug',
          'Workspace slug'
        )}
        onChange={(event) => setWorkspaceSlug(event.target.value)}
      />
      <Input
        value={apiKey}
        type="password"
        className="h-7 text-xs"
        placeholder={translate(
          'auto.components.settings.plane.integration.card.keyPlaceholder',
          'plane_api_…'
        )}
        aria-label={translate('auto.components.settings.plane.integration.card.key', 'API key')}
        onChange={(event) => setApiKey(event.target.value)}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button
        size="sm"
        disabled={connecting || !baseUrl.trim() || !workspaceSlug.trim() || !apiKey.trim()}
        onClick={() => void submit()}
      >
        {translate('auto.components.settings.plane.integration.card.connect', 'Connect Plane')}
      </Button>
    </div>
  )
}
