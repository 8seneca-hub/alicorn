// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EscalationOffer } from '../../../../shared/alicorn/escalation-offer'
import { EscalationOfferToaster } from './EscalationOfferToaster'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  setTaskExecutionStrategy: vi.fn(async () => {})
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

type ToastOptions = {
  description?: string
  action?: { label: string; onClick: () => void }
}

function offer(overrides: Partial<EscalationOffer> = {}): EscalationOffer {
  return {
    taskId: 'task_1',
    dispatchId: 'ctx_1',
    paneKey: null,
    signal: 'context_ceiling',
    contextTokens: 311_000,
    repoCount: null,
    ...overrides
  }
}

describe('EscalationOfferToaster', () => {
  let root: Root
  let container: HTMLDivElement
  let publish: ((payload: EscalationOffer) => void) | null = null

  beforeEach(() => {
    mocks.toast.mockClear()
    mocks.setTaskExecutionStrategy.mockClear()
    publish = null
    ;(window as unknown as { api: unknown }).api = {
      alicorn: {
        onEscalationOffer: (callback: (payload: EscalationOffer) => void) => {
          publish = callback
          return () => {
            publish = null
          }
        },
        setTaskExecutionStrategy: mocks.setTaskExecutionStrategy
      }
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<EscalationOfferToaster />)
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  function emit(payload: EscalationOffer): void {
    act(() => {
      publish?.(payload)
    })
  }

  it('names the repo count when the multi-repo signal raised the offer', () => {
    emit(offer({ signal: 'multi_repo', contextTokens: null, repoCount: 3 }))

    expect(mocks.toast.mock.calls[0]![0]).toBe(
      'This task spans 3 repositories. Switch it to orchestrated?'
    )
  })

  it('names the measured context when the ceiling raised the offer', () => {
    emit(offer())

    expect(mocks.toast.mock.calls[0]![0]).toBe(
      'This task is at 311k tokens of context. Switch it to orchestrated?'
    )
  })

  // Multi-agent is a trade, not an upgrade: the price is on the toast for either signal.
  it('always shows the cost of orchestrated', () => {
    emit(offer({ signal: 'multi_repo', contextTokens: null, repoCount: 2 }))

    expect((mocks.toast.mock.calls[0]![1] as ToastOptions).description).toContain('ten times')
  })

  // Offered, never applied — nothing switches until the action is clicked, and it is recorded as
  // an escalation so acceptance is measurable.
  it('switches nothing until the action is clicked', () => {
    emit(offer({ signal: 'multi_repo', contextTokens: null, repoCount: 2 }))
    expect(mocks.setTaskExecutionStrategy).not.toHaveBeenCalled()

    const options = mocks.toast.mock.calls[0]![1] as ToastOptions
    act(() => {
      options.action!.onClick()
    })

    expect(mocks.setTaskExecutionStrategy).toHaveBeenCalledWith({
      taskId: 'task_1',
      strategy: 'orchestrated',
      source: 'escalation'
    })
  })
})
