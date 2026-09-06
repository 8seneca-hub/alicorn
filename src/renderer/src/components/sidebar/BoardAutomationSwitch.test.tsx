// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoardAutomationSwitch from './BoardAutomationSwitch'
import { TooltipProvider } from '@/components/ui/tooltip'

const status = vi.fn()
const setKilled = vi.fn()

function view(repoId: string | null = 'repo-1') {
  return render(
    <TooltipProvider>
      <BoardAutomationSwitch repoId={repoId} />
    </TooltipProvider>
  )
}

const RUNNING = {
  killed: false,
  globalDisabledAt: null,
  globalDisabledBy: null,
  boardDisabledAt: null,
  boardDisabledBy: null,
  lastRefusal: null
}

describe('BoardAutomationSwitch', () => {
  beforeEach(() => {
    status.mockReset()
    setKilled.mockReset()
    status.mockResolvedValue(RUNNING)
    setKilled.mockResolvedValue({ ok: true })
    ;(window as unknown as { api: unknown }).api = { boardAutomation: { status, setKilled } }
  })

  afterEach(() => {
    cleanup()
  })

  it('shows automation as on when it is running', async () => {
    view()
    expect((await screen.findByRole('switch')).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Automation on')).toBeTruthy()
  })

  it('shows automation as off when the board is stopped', async () => {
    status.mockResolvedValue({ ...RUNNING, killed: true, boardDisabledAt: '2026-09-07T00:00:00Z' })
    view()
    expect((await screen.findByRole('switch')).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Automation off')).toBeTruthy()
  })

  it('stops automation for the board when switched off', async () => {
    view()
    await userEvent.click(await screen.findByRole('switch'))

    await waitFor(() => expect(setKilled).toHaveBeenCalledWith({ repoId: 'repo-1', killed: true }))
  })

  it('resumes automation when switched back on', async () => {
    status.mockResolvedValue({ ...RUNNING, killed: true, boardDisabledAt: '2026-09-07T00:00:00Z' })
    view()
    await userEvent.click(await screen.findByRole('switch'))

    await waitFor(() => expect(setKilled).toHaveBeenCalledWith({ repoId: 'repo-1', killed: false }))
  })

  // Why disabled rather than hidden: the board reads as off, and hiding the control would leave no
  // way to see why.
  it('disables the switch while a global stop stands', async () => {
    status.mockResolvedValue({
      ...RUNNING,
      killed: true,
      globalDisabledAt: '2026-09-07T00:00:00Z',
      globalDisabledBy: 'nghia'
    })
    view()

    expect((await screen.findByRole('switch')).hasAttribute('disabled')).toBe(true)
  })

  // Why: a board spanning repos has no single automation state to show, and showing one repo's
  // would be wrong rather than merely incomplete.
  it('renders nothing when the board spans repos', async () => {
    view(null)

    await waitFor(() => expect(status).not.toHaveBeenCalled())
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('re-reads status after a change so the switch reflects what was stored', async () => {
    view()
    await userEvent.click(await screen.findByRole('switch'))

    await waitFor(() => expect(status).toHaveBeenCalledTimes(2))
  })
})
