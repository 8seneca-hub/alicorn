import type { Hono } from 'hono'
import { AcknowledgeContractsBodySchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import {
  acknowledgeContracts,
  listContractAcknowledgements
} from './contract-acknowledgements-repository.js'
import { readJsonBody } from './read-json-body.js'
import { isValidProjectId } from './project-id-param.js'

/**
 * CR2's human action. The desktop's `contract_acknowledged` check reads the GET; only a caller
 * holding the Control API bearer can POST, and a worker terminal never holds it.
 */
export function registerContractAcknowledgementRoutes(
  app: Hono<ControlApiEnv>,
  deps: ControlApiDeps
): void {
  app.get('/v1/projects/:projectId/contracts/acknowledgements', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) {
      return c.json({ error: 'invalid_project_id' }, 400)
    }
    const runId = c.req.query('runId')
    if (!runId) {
      return c.json({ error: 'run_id_required' }, 400)
    }
    const acknowledgements = await listContractAcknowledgements(
      deps.pool,
      auth.tenantId,
      projectId,
      runId
    )
    return c.json({ acknowledgements })
  })

  app.post('/v1/projects/:projectId/contracts/acknowledge', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) {
      return c.json({ error: 'invalid_project_id' }, 400)
    }
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = AcknowledgeContractsBodySchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const acknowledgements = await acknowledgeContracts(
      deps.pool,
      auth.tenantId,
      projectId,
      result.data.runId,
      auth.actor,
      result.data.contractNames
    )
    return c.json({ acknowledgements })
  })
}
