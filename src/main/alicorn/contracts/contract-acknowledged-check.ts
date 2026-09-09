import { readJournal, journalPath } from '../foreman/journal'
import type { ContractEntry } from '../foreman/contract-registry'

/**
 * CR2: a breaking interface change may not ship until a human has said so.
 *
 * The contracts come from the run's Contract Registry (the journal on disk); the acknowledgements
 * come from the Control API, which a worker terminal cannot reach. Keeping the two apart is the
 * whole enforcement — *a member cannot loosen its own criteria* is a property of where the
 * acknowledgement lives, not of anything checked here.
 */

export type ContractCheckStatus = 'passed' | 'failed' | 'skipped' | 'error'

export type ContractCheckResult = {
  status: ContractCheckStatus
  detail: Record<string, unknown>
}

/** Acknowledgement is by contract name: what a human read and accepted was a named break. */
function acknowledgementKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * The verdict, given the run's registry entries and the names a human has accepted.
 *
 * Pure, so the interesting half is testable without a journal or a control plane.
 */
export function resolveContractAcknowledged(
  entries: readonly ContractEntry[],
  acknowledgedNames: readonly string[]
): ContractCheckResult {
  const breaking = entries.filter((entry) => entry.breaking)
  if (breaking.length === 0) {
    return { status: 'passed', detail: { breaking: 0 } }
  }
  const acknowledged = new Set(acknowledgedNames.map(acknowledgementKey))
  const unacknowledged = breaking.filter(
    (entry) => !acknowledged.has(acknowledgementKey(entry.name))
  )
  if (unacknowledged.length === 0) {
    return { status: 'passed', detail: { breaking: breaking.length, unacknowledged: 0 } }
  }
  return {
    status: 'failed',
    detail: {
      breaking: breaking.length,
      unacknowledged: unacknowledged.length,
      // Repo-qualified so a human reading the gate knows where to look, even though the
      // acknowledgement itself is keyed on the name alone.
      contracts: unacknowledged.map((entry) => ({
        repo: entry.repo,
        name: entry.name,
        source: entry.source
      }))
    }
  }
}

export type ContractAcknowledgedCheckInput = {
  worktreePath: string
  runId: string
  projectId: string
  listAcknowledgedNames: (projectId: string, runId: string) => Promise<string[]>
}

/**
 * Reads the run's registry and asks the control plane what has been acknowledged.
 *
 * An absent journal passes: a `single` run keeps no registry, so there is nothing that could be
 * unacknowledged. An *unreadable* one errors — "no contracts" and "we could not tell" must not
 * collapse into the same verdict, because only one of them is safe to ship on.
 */
export async function runContractAcknowledgedCheck(
  input: ContractAcknowledgedCheckInput
): Promise<ContractCheckResult> {
  let entries: readonly ContractEntry[]
  try {
    const journal = await readJournal(journalPath(input.worktreePath, input.runId))
    if (!journal) {
      return { status: 'passed', detail: { reason: 'no_contract_registry' } }
    }
    entries = journal.contractRegistry.entries
  } catch (error) {
    return { status: 'error', detail: { reason: 'journal_unreadable', error: String(error) } }
  }
  if (!entries.some((entry) => entry.breaking)) {
    return { status: 'passed', detail: { breaking: 0 } }
  }
  let acknowledgedNames: string[]
  try {
    acknowledgedNames = await input.listAcknowledgedNames(input.projectId, input.runId)
  } catch (error) {
    return {
      status: 'error',
      detail: { reason: 'acknowledgements_unreadable', error: String(error) }
    }
  }
  return resolveContractAcknowledged(entries, acknowledgedNames)
}
