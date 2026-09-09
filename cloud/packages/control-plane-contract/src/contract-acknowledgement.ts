import { z } from 'zod'

/**
 * A human's acknowledgement that a breaking interface change may ship (CR2).
 *
 * Deliberately *not* stored next to the contracts themselves. The Contract Registry lives in the
 * run's journal on disk, which the run that broke the contract can write — an acknowledgement kept
 * there is one a member could grant itself. Here it sits behind the Control API bearer, which a
 * worker terminal never holds, so *a member cannot loosen its own criteria* is enforced by the
 * boundary rather than by convention.
 */

export const CONTRACT_NAME_MAX = 200
export const CONTRACT_RUN_ID_MAX = 200
/** One acknowledgement request covers one run's breaking set; the registry itself caps at 200. */
export const CONTRACT_ACK_BATCH_MAX = 200

export const ContractAcknowledgementSchema = z.object({
  runId: z.string().min(1).max(CONTRACT_RUN_ID_MAX),
  contractName: z.string().min(1).max(CONTRACT_NAME_MAX),
  /** The API actor — never the member being judged. */
  acknowledgedBy: z.string().min(1),
  acknowledgedAt: z.string()
})
export type ContractAcknowledgement = z.infer<typeof ContractAcknowledgementSchema>

export const AcknowledgeContractsBodySchema = z.object({
  runId: z.string().min(1).max(CONTRACT_RUN_ID_MAX),
  contractNames: z
    .array(z.string().min(1).max(CONTRACT_NAME_MAX))
    .min(1)
    .max(CONTRACT_ACK_BATCH_MAX)
})
export type AcknowledgeContractsBody = z.infer<typeof AcknowledgeContractsBodySchema>
