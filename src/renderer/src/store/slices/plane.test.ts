/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'

const status = vi.fn()
const connect = vi.fn()
const disconnect = vi.fn()

beforeEach(() => {
  status.mockReset()
  connect.mockReset()
  disconnect.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    ...(window as unknown as { api?: Record<string, unknown> }).api,
    plane: { status, connect, disconnect }
  }
})

const CONNECTED = {
  connected: true,
  viewer: null,
  connections: [{ id: 'ws@https://p.example.com' }],
  activeConnectionId: 'ws@https://p.example.com'
}

describe('checkPlaneConnection', () => {
  it('starts unchecked and disconnected', () => {
    const store = createTestStore()
    expect(store.getState().planeStatusChecked).toBe(false)
    expect(store.getState().planeStatus.connected).toBe(false)
  })

  it('records the status and marks the check settled', async () => {
    status.mockResolvedValue(CONNECTED)
    const store = createTestStore()

    await store.getState().checkPlaneConnection()

    expect(store.getState().planeStatus).toEqual(CONNECTED)
    expect(store.getState().planeStatusChecked).toBe(true)
    expect(store.getState().planeStatusContextKey).not.toBeNull()
  })

  it('settles as disconnected when the status read throws', async () => {
    status.mockRejectedValue(new Error('offline'))
    const store = createTestStore()

    await store.getState().checkPlaneConnection()

    expect(store.getState().planeStatus.connected).toBe(false)
    // Settled, not stuck: the settings card must not spin forever.
    expect(store.getState().planeStatusChecked).toBe(true)
  })

  it('drops a superseded read rather than overwriting a newer one', async () => {
    let releaseSlow: (value: unknown) => void = () => {}
    const slow = new Promise((resolve) => {
      releaseSlow = resolve
    })
    status.mockReturnValueOnce(slow).mockResolvedValueOnce(CONNECTED)
    const store = createTestStore()

    const first = store.getState().checkPlaneConnection()
    await store.getState().checkPlaneConnection()
    releaseSlow({ connected: false, viewer: null, connections: [], activeConnectionId: null })
    await first

    expect(store.getState().planeStatus).toEqual(CONNECTED)
  })
})

describe('connectPlane', () => {
  it('adopts the status the connect returned without a second read', async () => {
    connect.mockResolvedValue({ ok: true, value: CONNECTED })
    const store = createTestStore()

    await expect(
      store
        .getState()
        .connectPlane({ baseUrl: 'https://p.example.com', workspaceSlug: 'ws', apiKey: 'k' })
    ).resolves.toEqual({ ok: true })
    expect(store.getState().planeStatus).toEqual(CONNECTED)
    expect(status).not.toHaveBeenCalled()
  })

  it('passes the error through and leaves the status alone', async () => {
    connect.mockResolvedValue({ ok: false, error: 'Invalid API key.' })
    const store = createTestStore()

    await expect(
      store
        .getState()
        .connectPlane({ baseUrl: 'https://p.example.com', workspaceSlug: 'ws', apiKey: 'bad' })
    ).resolves.toEqual({ ok: false, error: 'Invalid API key.' })
    expect(store.getState().planeStatus.connected).toBe(false)
    expect(store.getState().planeStatusChecked).toBe(false)
  })
})

describe('disconnectPlane', () => {
  it('adopts the status the disconnect returned', async () => {
    connect.mockResolvedValue({ ok: true, value: CONNECTED })
    disconnect.mockResolvedValue({
      connected: false,
      viewer: null,
      connections: [],
      activeConnectionId: null
    })
    const store = createTestStore()
    await store
      .getState()
      .connectPlane({ baseUrl: 'https://p.example.com', workspaceSlug: 'ws', apiKey: 'k' })

    await store.getState().disconnectPlane()

    expect(store.getState().planeStatus.connected).toBe(false)
    expect(store.getState().planeStatusChecked).toBe(true)
  })
})
