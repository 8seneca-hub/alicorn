/**
 * Fence 0 is not a lease, and a write must not leave against one.
 *
 * The regression this pins: a failed history read substitutes 0 for the fence it did not receive,
 * because a reset event has to carry a number. Every send guard tested `fence !== null`, so that
 * substitute passed as a live lease — the composer stayed enabled, the outbox dispatched against
 * fence 0, and the message was queued and never sent with the panel reading Idle and no error.
 */
import { describe, expect, it } from 'vitest'
import { agentSessionFenceIsLive } from './agent-session-wire'

describe('agentSessionFenceIsLive', () => {
  it('rejects the substitute a failed read writes in place of a fence', () => {
    expect(agentSessionFenceIsLive(0)).toBe(false)
  })

  it('rejects an absent fence however it is spelled', () => {
    expect(agentSessionFenceIsLive(null)).toBe(false)
    expect(agentSessionFenceIsLive(undefined)).toBe(false)
  })

  it('accepts the first admitted lease, which is fenced 1', () => {
    // agent-session-reservation-admission admits at runtimeFence 1 and only counts up, so 1 is the
    // lowest fence any live session can hold.
    expect(agentSessionFenceIsLive(1)).toBe(true)
    expect(agentSessionFenceIsLive(7)).toBe(true)
  })

  it('rejects a negative fence rather than treating any number as a lease', () => {
    expect(agentSessionFenceIsLive(-1)).toBe(false)
  })
})
