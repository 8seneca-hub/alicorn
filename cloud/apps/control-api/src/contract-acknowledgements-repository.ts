import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { ContractAcknowledgement } from '@alicorn-cloud/control-plane-contract'

type Row = { run_id: string; contract_name: string; acknowledged_by: string; acknowledged_at: Date }

function toAcknowledgement(row: Row): ContractAcknowledgement {
  return {
    runId: row.run_id,
    contractName: row.contract_name,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at.toISOString()
  }
}

export function listContractAcknowledgements(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  runId: string
): Promise<ContractAcknowledgement[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT run_id, contract_name, acknowledged_by, acknowledged_at
         FROM contract_acknowledgements
        WHERE project_id = $1 AND run_id = $2
        ORDER BY contract_name`,
      [projectId, runId]
    )
    return rows.map(toAcknowledgement)
  })
}

/**
 * Records one human's acknowledgement per contract name, first writer wins.
 *
 * First-writer-wins rather than upsert: the row answers *who accepted this break*, and a re-post
 * that rewrote the actor would quietly reassign the responsibility the gate exists to place.
 */
export function acknowledgeContracts(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  runId: string,
  acknowledgedBy: string,
  contractNames: readonly string[]
): Promise<ContractAcknowledgement[]> {
  return withTenant(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO contract_acknowledgements
         (tenant_id, project_id, run_id, contract_name, acknowledged_by)
       SELECT $1, $2, $3, name, $4 FROM unnest($5::text[]) AS name
       ON CONFLICT (tenant_id, project_id, run_id, contract_name) DO NOTHING`,
      [tenantId, projectId, runId, acknowledgedBy, [...contractNames]]
    )
    const { rows } = await client.query<Row>(
      `SELECT run_id, contract_name, acknowledged_by, acknowledged_at
         FROM contract_acknowledgements
        WHERE project_id = $1 AND run_id = $2
        ORDER BY contract_name`,
      [projectId, runId]
    )
    return rows.map(toAcknowledgement)
  })
}
