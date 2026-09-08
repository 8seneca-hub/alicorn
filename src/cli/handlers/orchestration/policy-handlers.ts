import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../../flags'
import { callOrchestrationMutation } from './mutation-request'

type PolicyView = {
  stageKey: string
  memberId: string | null
  mode: string
  minRuns: number
  minAcceptRate: number
  maxFiles: number | null
  maxSpendCents: number | null
  createdBy: string
  expiresAt: string | null
}

type ExceptionView = {
  stageKey: string
  memberId: string | null
  createdBy: string
  expiresAt: string | null
  lapsed: boolean
}

function describePolicy(policy: PolicyView): string {
  const scope = policy.memberId ? `member ${policy.memberId}` : 'every member'
  const budgets = [
    policy.maxFiles === null ? null : `files≤${policy.maxFiles}`,
    policy.maxSpendCents === null ? null : `spend≤${policy.maxSpendCents}c`
  ].filter((part) => part !== null)
  return [
    `${policy.stageKey} (${scope}): ${policy.mode}`,
    `runs≥${policy.minRuns} accept≥${policy.minAcceptRate}`,
    ...budgets,
    policy.expiresAt ? `expires ${policy.expiresAt}` : null
  ]
    .filter((part) => part !== null)
    .join(' ')
}

/** Numeric flags reach the RPC as numbers; a non-numeric value must fail here, not silently vanish. */
function optionalNumberFlag(
  flags: Map<string, string | boolean>,
  name: string
): number | undefined {
  const raw = getOptionalStringFlag(flags, name)
  if (raw === undefined) {
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number for --${name}: ${raw}`)
  }
  return value
}

export const ORCHESTRATION_POLICY_HANDLERS: Record<string, CommandHandler> = {
  'orchestration policy-get': async ({ flags, client, json }) => {
    const result = await client.call<{
      policy: PolicyView
      authored: boolean
      stageConfig: { reversibility: string; inheritedCost: string }
    }>('orchestration.policyGet', {
      project: getRequiredStringFlag(flags, 'project'),
      stageKey: getOptionalStringFlag(flags, 'stage-key'),
      member: getOptionalStringFlag(flags, 'member')
    })
    printResult(result, json, (value) =>
      [
        `${describePolicy(value.policy)}${value.authored ? '' : ' [default, unauthored]'}`,
        `stage ${value.stageConfig.reversibility}, inherited cost ${value.stageConfig.inheritedCost}`
      ].join('\n')
    )
  },

  'orchestration policy-set': async ({ flags, client, json }) => {
    const result = await callOrchestrationMutation<{ policy: PolicyView }>(
      client,
      flags,
      'orchestration.policySet',
      {
        project: getRequiredStringFlag(flags, 'project'),
        mode: getRequiredStringFlag(flags, 'mode'),
        stageKey: getOptionalStringFlag(flags, 'stage-key'),
        member: getOptionalStringFlag(flags, 'member'),
        minRuns: optionalNumberFlag(flags, 'min-runs'),
        minAcceptRate: optionalNumberFlag(flags, 'min-accept-rate'),
        maxFiles: optionalNumberFlag(flags, 'max-files'),
        maxSpendCents: optionalNumberFlag(flags, 'max-spend-cents'),
        expiresAt: getOptionalStringFlag(flags, 'expires-at')
      }
    )
    printResult(
      result,
      json,
      (value) => `Policy authored by ${value.policy.createdBy}: ${describePolicy(value.policy)}`
    )
  },

  'orchestration policy-list': async ({ flags, client, json }) => {
    const result = await client.call<{
      policies: PolicyView[]
      exceptions: ExceptionView[]
      standingExceptions: number
    }>('orchestration.policyList', { project: getRequiredStringFlag(flags, 'project') })
    printResult(result, json, (value) => {
      if (value.policies.length === 0) {
        return 'No autonomy policies authored for this project.'
      }
      const lines = value.policies.map((policy) => describePolicy(policy))
      if (value.exceptions.length > 0) {
        lines.push(
          `\n${value.standingExceptions} standing never_gate exception(s):`,
          ...value.exceptions.map(
            (exception) =>
              `  ${exception.stageKey} (${exception.memberId ?? 'every member'}) by ${exception.createdBy}` +
              ` until ${exception.expiresAt ?? 'never'}${exception.lapsed ? ' [lapsed]' : ''}`
          )
        )
      }
      return lines.join('\n')
    })
  },

  'orchestration evidence': async ({ flags, client, json }) => {
    const result = await client.call<{
      memberId: string | null
      trackRecord: {
        runs: number
        acceptRate: number
        recentRegression: boolean
        level: number
      } | null
      wouldDecide: { decision: string; reason: string }
    }>('orchestration.evidence', {
      task: getRequiredStringFlag(flags, 'task'),
      stageKey: getOptionalStringFlag(flags, 'stage-key')
    })
    printResult(result, json, (value) => {
      const record = value.trackRecord
      const history = record
        ? `${record.runs} run(s), accept ${record.acceptRate.toFixed(2)}, level ${record.level}` +
          `${record.recentRegression ? ', recent regression' : ''}`
        : `no track record${value.memberId ? '' : ' (no member recorded for this task)'}`
      return `${history}\nPolicy would ${value.wouldDecide.decision} (${value.wouldDecide.reason})`
    })
  }
}
