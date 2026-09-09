import assert from 'node:assert/strict'
import test from 'node:test'
import { proveRelayLoadRegionBehavior } from './relay-load-region-behavior.mjs'

function peer(origin, reassigned = origin) {
  let shutdowns = 0
  return {
    connect: async () => undefined,
    assignedCellUrl: () => origin,
    requestAssignment: async () => ({ cellUrl: reassigned }),
    shutdown: async () => { shutdowns++ },
    shutdowns: () => shutdowns
  }
}

test('proves unhinted US-first placement and sticky Asia preservation', async () => {
  const oldClientPeer = peer('https://c3.relay-staging.alicorn.8seneca.com')
  const stickyPeer = peer('https://c4.relay-staging.alicorn.8seneca.com')
  let retryDelayMs = 0
  assert.deepEqual(await proveRelayLoadRegionBehavior({
    oldClientPeer,
    stickyPeer,
    asiaOrigin: 'https://c4.relay-staging.alicorn.8seneca.com',
    scheduleAssignmentRetry: (resolve, delayMs) => {
      retryDelayMs = delayMs
      resolve()
    }
  }), { oldClientUsFirst: true, stickyAssignmentPreserved: true })
  assert.equal(retryDelayMs, 5_100)
  assert.equal(oldClientPeer.shutdowns(), 1)
  assert.equal(stickyPeer.shutdowns(), 1)
})

test('rejects Asia placement for an unhinted client or a moved sticky assignment', async () => {
  await assert.rejects(proveRelayLoadRegionBehavior({
    oldClientPeer: peer('https://c4.relay-staging.alicorn.8seneca.com'),
    stickyPeer: peer('https://c4.relay-staging.alicorn.8seneca.com'),
    asiaOrigin: 'https://c4.relay-staging.alicorn.8seneca.com',
    scheduleAssignmentRetry: (resolve) => resolve()
  }), /US-first/)
  await assert.rejects(proveRelayLoadRegionBehavior({
    oldClientPeer: peer('https://c3.relay-staging.alicorn.8seneca.com'),
    stickyPeer: peer('https://c4.relay-staging.alicorn.8seneca.com', 'https://c3.relay-staging.alicorn.8seneca.com'),
    asiaOrigin: 'https://c4.relay-staging.alicorn.8seneca.com',
    scheduleAssignmentRetry: (resolve) => resolve()
  }), /sticky assignment moved/)
})
