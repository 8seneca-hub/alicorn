import { useCallback, useEffect, useState } from 'react'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useMountedRef } from '@/hooks/useMountedRef'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'
import type { PlaneProject } from '../../../../shared/plane-types'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useIntegrationSubordinateRowClass } from './integration-card-presentation'
import { PlaneConnectForm } from './plane-connect-form'
import { PLANE_INTEGRATION_SECTION_ID } from './task-provider-integration-section-ids'
import { translate } from '@/i18n/i18n'

export function PlaneIntegrationCard(): React.JSX.Element {
  const planeStatus = useAppStore((s) => s.planeStatus)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const checkPlaneConnection = useAppStore((s) => s.checkPlaneConnection)
  const disconnectPlane = useAppStore((s) => s.disconnectPlane)
  const listPlaneProjects = useAppStore((s) => s.listPlaneProjects)
  const setPlaneDefaultProject = useAppStore((s) => s.setPlaneDefaultProject)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()

  const [projects, setProjects] = useState<PlaneProject[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  const contextMatches = planeStatusContextKey === getProviderRuntimeContextKey(settings)
  const checking = !contextMatches || !planeStatusChecked
  const connected = contextMatches && planeStatus.connected
  const connections = planeStatus.connections ?? []
  const rowClass = useIntegrationSubordinateRowClass('flex items-center gap-3')

  // Listing projects is also the connection test: it is the narrowest read the
  // key must be able to perform for the provider to be useful at all.
  const loadProjects = useCallback(async () => {
    const list = await listPlaneProjects()
    if (mountedRef.current) {
      setProjects(list)
      setProjectsLoaded(true)
    }
  }, [listPlaneProjects, mountedRef])

  useEffect(() => {
    if (connected && !projectsLoaded) {
      void loadProjects()
    }
  }, [connected, projectsLoaded, loadProjects])

  return (
    <IntegrationCardShell
      icon={<PlaneIcon className="size-5" />}
      name={translate('auto.components.settings.plane.integration.card.name', 'Plane')}
      description={translate(
        'auto.components.settings.plane.integration.card.description',
        'Connect a Plane workspace to browse its issues and start work from them. The API key is stored on the host that runs the workspace.'
      )}
      settingsSectionId={PLANE_INTEGRATION_SECTION_ID}
      checking={checking}
      statusTone={connected ? 'connected' : 'attention'}
      statusLabel={
        connected
          ? translate('auto.components.settings.plane.integration.card.connected', 'Connected')
          : translate(
              'auto.components.settings.plane.integration.card.notConnected',
              'Not connected'
            )
      }
    >
      <IntegrationCardDetails>
        {connected ? (
          <div className="space-y-2">
            {connections.map((connection) => (
              <div key={connection.id} className={rowClass}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {connection.displayName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{connection.baseUrl}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void disconnectPlane({ connectionId: connection.id })}
                >
                  {translate(
                    'auto.components.settings.plane.integration.card.disconnect',
                    'Disconnect'
                  )}
                </Button>
              </div>
            ))}
            <div className={rowClass}>
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.plane.integration.card.defaultProject',
                  'Default project'
                )}
              </p>
              <Select
                value={planeStatus.connections?.[0]?.defaultProjectId ?? ''}
                onValueChange={(projectId) => {
                  const connectionId = planeStatus.activeConnectionId
                  if (connectionId) {
                    void setPlaneDefaultProject({ connectionId, projectId })
                  }
                }}
              >
                <SelectTrigger
                  className="h-7 w-52 text-xs"
                  aria-label={translate(
                    'auto.components.settings.plane.integration.card.defaultProject',
                    'Default project'
                  )}
                >
                  <SelectValue
                    placeholder={translate(
                      'auto.components.settings.plane.integration.card.selectProject',
                      'Select a project'
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id} className="text-xs">
                      {project.identifier
                        ? `${project.identifier} · ${project.name}`
                        : project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Plane's v1 API has no cross-project issue list, so the Tasks
                surface cannot show anything until a project is chosen. */}
            {projectsLoaded && projects.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.plane.integration.card.noProjects',
                  'This workspace has no projects the API key can read.'
                )}
              </p>
            ) : null}
          </div>
        ) : (
          <PlaneConnectForm onConnected={() => void checkPlaneConnection()} />
        )}
      </IntegrationCardDetails>
    </IntegrationCardShell>
  )
}
