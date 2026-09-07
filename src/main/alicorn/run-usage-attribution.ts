import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { SpendPatch } from '../../shared/alicorn/ledger-inputs'

/** Inverse of parseSqliteUtc. Kept beside it so the pair cannot drift apart. */
export function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** SQLite stores UTC as 'YYYY-MM-DD HH:MM:SS' with no timezone marker. */
export function parseSqliteUtc(value: string | null): number | null {
  if (value === null) {
    return null
  }
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
}

export async function attributeDispatchUsage(input: {
  backend: string
  worktreeId: string | null
  startedAt: string | null
  completedAt: string | null
  claudeUsage: Pick<ClaudeUsageStore, 'getAutomationRunUsage'> | null
  codexUsage: Pick<CodexUsageStore, 'getAutomationRunUsage'> | null
}): Promise<SpendPatch> {
  if (input.backend !== 'claude' && input.backend !== 'codex') {
    return {
      spendCents: null,
      usage: { status: 'unavailable', unavailableReason: 'provider_unsupported' }
    }
  }

  const store = input.backend === 'claude' ? input.claudeUsage : input.codexUsage
  if (!store) {
    return {
      spendCents: null,
      usage: {
        status: 'unavailable',
        unavailableReason: 'usage_not_enabled',
        unavailableMessage: `${input.backend} usage store is not available.`
      }
    }
  }

  const usage = await store.getAutomationRunUsage({
    worktreeId: input.worktreeId,
    terminalSessionId: null,
    startedAt: parseSqliteUtc(input.startedAt),
    completedAt: parseSqliteUtc(input.completedAt)
  })

  if (usage.status === 'known') {
    return {
      spendCents: usage.estimatedCostUsd === null ? null : Math.round(usage.estimatedCostUsd * 100),
      usage: {
        status: usage.status,
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        providerSessionId: usage.providerSessionId,
        attribution: usage.attribution
      }
    }
  }

  return {
    spendCents: null,
    usage: {
      status: 'unavailable',
      unavailableReason: usage.unavailableReason,
      unavailableMessage: usage.unavailableMessage
    }
  }
}
