import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunCostByDispatch } from '../../../shared/alicorn/run-cost'
import type * as AlicornRunCostStoreModule from './alicorn-run-cost-store'

type StoreModule = typeof AlicornRunCostStoreModule

async function loadStore(
  onChanged?: (callback: (payload: RunCostByDispatch) => void) => () => void
): Promise<{ module: StoreModule; onChanged?: typeof onChanged }> {
  vi.resetModules()
  vi.stubGlobal('window', onChanged ? { api: { alicornRunCost: { onChanged } } } : {})
  const module = await import('./alicorn-run-cost-store')
  return { module, onChanged }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subscribeAlicornRunCost', () => {
  it('registers a single shared IPC listener for multiple local subscribers', async () => {
    const onChanged = vi.fn().mockReturnValue(vi.fn())
    const { module } = await loadStore(onChanged)

    const unsubA = module.subscribeAlicornRunCost(vi.fn())
    const unsubB = module.subscribeAlicornRunCost(vi.fn())

    expect(onChanged).toHaveBeenCalledTimes(1)
    unsubA()
    unsubB()
  })

  it('keeps the IPC subscription alive after the last local subscriber unsubscribes', async () => {
    let deliver: ((payload: RunCostByDispatch) => void) | undefined
    const unsubscribeIpc = vi.fn()
    const onChanged = vi.fn((callback: (payload: RunCostByDispatch) => void) => {
      deliver = callback
      return unsubscribeIpc
    })
    const { module } = await loadStore(onChanged)

    const unsub = module.subscribeAlicornRunCost(vi.fn())
    unsub()

    expect(unsubscribeIpc).not.toHaveBeenCalled()

    // A payload published after the last local subscriber left must still land —
    // the IPC listener was never torn down.
    const payload: RunCostByDispatch = { d1: { costUsd: 1.5, status: 'known' } }
    deliver?.(payload)

    expect(module.getAlicornRunCostSnapshot()).toBe(payload)
  })

  it('does not throw when window.api is unavailable, and reports no cost data', async () => {
    const { module } = await loadStore()

    expect(() => {
      const unsub = module.subscribeAlicornRunCost(vi.fn())
      unsub()
    }).not.toThrow()
    expect(module.getAlicornRunCostSnapshot()).toEqual({})
  })

  it('keeps snapshot identity stable across reads until a payload actually arrives', async () => {
    const onChanged = vi.fn().mockReturnValue(vi.fn())
    const { module } = await loadStore(onChanged)
    module.subscribeAlicornRunCost(vi.fn())

    const first = module.getAlicornRunCostSnapshot()
    const second = module.getAlicornRunCostSnapshot()

    expect(first).toBe(second)
  })
})
