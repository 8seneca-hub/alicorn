// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { PlaneIntegrationCard } from './plane-integration-card'
import { useAppStore } from '@/store'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import type { PlaneConnectionStatus } from '../../../../shared/plane-types'

const connectPlane = vi.fn()
const disconnectPlane = vi.fn()
const listPlaneProjects = vi.fn()
const setPlaneDefaultProject = vi.fn()
const checkPlaneConnection = vi.fn()

const CONNECTED: PlaneConnectionStatus = {
  connected: true,
  viewer: null,
  activeConnectionId: 'c1',
  connections: [
    {
      id: 'c1',
      baseUrl: 'https://plane.example.com',
      workspaceSlug: '8seneca',
      displayName: '8seneca (plane.example.com)',
      defaultProjectId: null
    }
  ]
}

const DISCONNECTED: PlaneConnectionStatus = {
  connected: false,
  viewer: null,
  connections: [],
  activeConnectionId: null
}

function setStatus(status: PlaneConnectionStatus): void {
  useAppStore.setState({
    planeStatus: status,
    planeStatusChecked: true,
    // The card treats a mismatched context key as "still checking", so the
    // fixture has to agree with what the card computes.
    planeStatusContextKey: getProviderRuntimeContextKey(useAppStore.getState().settings),
    connectPlane,
    disconnectPlane,
    listPlaneProjects,
    setPlaneDefaultProject,
    checkPlaneConnection
  } as never)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  connectPlane.mockReset().mockResolvedValue({ ok: true })
  disconnectPlane.mockReset().mockResolvedValue(undefined)
  listPlaneProjects.mockReset().mockResolvedValue([
    { id: 'p1', identifier: 'ALC', name: 'Alicorn' },
    { id: 'p2', identifier: 'FB', name: 'Freshbox' }
  ])
  setPlaneDefaultProject.mockReset().mockResolvedValue(undefined)
  checkPlaneConnection.mockReset().mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('when disconnected', () => {
  it('offers the connect form', async () => {
    setStatus(DISCONNECTED)
    render(<PlaneIntegrationCard />)

    expect(await screen.findByLabelText('Plane URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace slug')).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toBeInTheDocument()
  })

  it('will not connect until all three fields are filled', async () => {
    setStatus(DISCONNECTED)
    const user = userEvent.setup()
    render(<PlaneIntegrationCard />)

    await user.type(screen.getByLabelText('Plane URL'), 'https://plane.example.com')
    expect(screen.getByRole('button', { name: 'Connect Plane' })).toBeDisabled()

    await user.type(screen.getByLabelText('Workspace slug'), '8seneca')
    await user.type(screen.getByLabelText('API key'), 'plane_api_x')

    expect(screen.getByRole('button', { name: 'Connect Plane' })).toBeEnabled()
  })

  it('connects with the three fields and rechecks the connection', async () => {
    setStatus(DISCONNECTED)
    const user = userEvent.setup()
    render(<PlaneIntegrationCard />)

    await user.type(screen.getByLabelText('Plane URL'), 'https://plane.example.com')
    await user.type(screen.getByLabelText('Workspace slug'), '8seneca')
    await user.type(screen.getByLabelText('API key'), 'plane_api_x')
    await user.click(screen.getByRole('button', { name: 'Connect Plane' }))

    await waitFor(() => expect(connectPlane).toHaveBeenCalled())
    expect(connectPlane).toHaveBeenCalledWith({
      baseUrl: 'https://plane.example.com',
      workspaceSlug: '8seneca',
      apiKey: 'plane_api_x'
    })
    await waitFor(() => expect(checkPlaneConnection).toHaveBeenCalled())
  })

  it('shows a rejected key instead of silently doing nothing', async () => {
    setStatus(DISCONNECTED)
    connectPlane.mockResolvedValue({ ok: false, error: 'Invalid API key.' })
    const user = userEvent.setup()
    render(<PlaneIntegrationCard />)

    await user.type(screen.getByLabelText('Plane URL'), 'https://plane.example.com')
    await user.type(screen.getByLabelText('Workspace slug'), '8seneca')
    await user.type(screen.getByLabelText('API key'), 'bad')
    await user.click(screen.getByRole('button', { name: 'Connect Plane' }))

    expect(await screen.findByText('Invalid API key.')).toBeInTheDocument()
    expect(checkPlaneConnection).not.toHaveBeenCalled()
  })
})

describe('when connected', () => {
  it('lists the workspace and offers its projects as the default', async () => {
    setStatus(CONNECTED)
    render(<PlaneIntegrationCard />)

    expect(await screen.findByText('8seneca (plane.example.com)')).toBeInTheDocument()
    // Listing projects doubles as the connection test.
    await waitFor(() => expect(listPlaneProjects).toHaveBeenCalled())
    expect(screen.getByLabelText('Default project')).toBeInTheDocument()
  })

  it('disconnects the named workspace', async () => {
    setStatus(CONNECTED)
    const user = userEvent.setup()
    render(<PlaneIntegrationCard />)

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }))

    expect(disconnectPlane).toHaveBeenCalledWith({ connectionId: 'c1' })
  })

  it('says so when the key can read no projects', async () => {
    setStatus(CONNECTED)
    listPlaneProjects.mockResolvedValue([])
    render(<PlaneIntegrationCard />)

    expect(await screen.findByText(/no projects the API key can read/)).toBeInTheDocument()
  })
})
