import { describe, expect, it } from 'vitest'
import { classifyOutboxFailure, MAX_OUTBOX_ATTEMPTS } from './outbox-failure-policy'
import { ControlPlaneRequestError, ControlPlaneUnavailableError } from './control-plane-http'

describe('classifyOutboxFailure', () => {
  it('stops the pass when the control plane is unconfigured', () => {
    expect(classifyOutboxFailure(new ControlPlaneUnavailableError(), 1)).toEqual({
      action: 'stop_pass',
      reason: 'control_plane_unconfigured',
      message: '[ledger-outbox] control plane unconfigured; row untouched'
    })
  })

  it('stops the pass on a 401, blaming auth rather than the row', () => {
    expect(classifyOutboxFailure(new ControlPlaneRequestError(401, 'unauthorized'), 1)).toEqual({
      action: 'stop_pass',
      reason: 'control_plane_unauthorized',
      message: '[ledger-outbox] control plane unauthorized; row untouched'
    })
  })

  it('stops the pass on a 403, blaming auth rather than the row', () => {
    expect(classifyOutboxFailure(new ControlPlaneRequestError(403, 'forbidden'), 1)).toEqual({
      action: 'stop_pass',
      reason: 'control_plane_unauthorized',
      message: '[ledger-outbox] control plane unauthorized; row untouched'
    })
  })

  it('dead-letters a permanently rejected 404', () => {
    expect(classifyOutboxFailure(new ControlPlaneRequestError(404, 'not_found'), 1)).toEqual({
      action: 'dead',
      reason: '404 not_found'
    })
  })

  it('retries a 500, which is transient', () => {
    expect(classifyOutboxFailure(new ControlPlaneRequestError(500, 'server_error'), 1)).toEqual({
      action: 'retry'
    })
  })

  it('retries at attempts one below the limit', () => {
    expect(classifyOutboxFailure(new Error('boom'), MAX_OUTBOX_ATTEMPTS - 1)).toEqual({
      action: 'retry'
    })
  })

  it('dead-letters once the attempt budget is exhausted', () => {
    expect(classifyOutboxFailure(new Error('boom'), MAX_OUTBOX_ATTEMPTS)).toEqual({
      action: 'dead',
      reason: 'max_attempts'
    })
  })
})
