import { describe, expect, it } from 'vitest'
import {
  recordManagedScriptWrite,
  recordManagedScriptWritesDuring
} from './managed-script-write-log'

describe('managed script write log', () => {
  it('reports a host as reinstalled when any one script was rewritten', async () => {
    const effect = await recordManagedScriptWritesDuring(async () => {
      recordManagedScriptWrite('unchanged')
      recordManagedScriptWrite('written')
      recordManagedScriptWrite('unchanged')
    })

    expect(effect).toBe('written')
  })

  it('reports a host as current when every script was already byte-identical', async () => {
    const effect = await recordManagedScriptWritesDuring(async () => {
      recordManagedScriptWrite('unchanged')
      recordManagedScriptWrite('unchanged')
    })

    expect(effect).toBe('unchanged')
  })

  // A host with no managed agents installed writes nothing, and that is not a rewrite.
  it('reports a host that wrote nothing at all as current', async () => {
    expect(await recordManagedScriptWritesDuring(async () => {})).toBe('unchanged')
  })

  // The reason the log is scoped rather than global: one host's writes must not be another's.
  it('collects nothing once the sweep is over', async () => {
    await recordManagedScriptWritesDuring(async () => {
      recordManagedScriptWrite('written')
    })
    recordManagedScriptWrite('written')

    expect(await recordManagedScriptWritesDuring(async () => {})).toBe('unchanged')
  })

  it('stops collecting when the install throws, rather than leaking into the next host', async () => {
    await expect(
      recordManagedScriptWritesDuring(async () => {
        recordManagedScriptWrite('written')
        throw new Error('sftp channel closed')
      })
    ).rejects.toThrow('sftp channel closed')

    expect(await recordManagedScriptWritesDuring(async () => {})).toBe('unchanged')
  })

  it('refuses to nest, rather than attributing writes to the wrong host', async () => {
    await expect(
      recordManagedScriptWritesDuring(async () => {
        await recordManagedScriptWritesDuring(async () => {})
      })
    ).rejects.toThrow('already collecting')
  })
})
