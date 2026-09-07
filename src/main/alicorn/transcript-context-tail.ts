import { open } from 'node:fs/promises'
import { parseClaudeUsageRecord } from '../claude-usage/transcript-record-parser'

export type TranscriptContextUsage = {
  /**
   * Context tokens the *next* turn would have to carry: input plus both cache halves. Output is
   * excluded — it is not in the window — so this never offers escalation early.
   */
  contextTokens: number
  /** The model that served the turn, so a caller can size the window it is a fraction of. */
  model: string | null
}

/**
 * Scans from the end because only the last turn's figure matters, and because a transcript being
 * written mid-flush often ends in a partial line.
 */
export function contextUsageFromTranscriptTail(text: string): TranscriptContextUsage | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const turn = parseClaudeUsageRecord(lines[i]!)
    if (turn) {
      return {
        contextTokens: turn.inputTokens + turn.cacheReadTokens + turn.cacheWriteTokens,
        model: turn.model
      }
    }
  }
  return null
}

export function contextTokensFromTranscriptTail(text: string): number | null {
  return contextUsageFromTranscriptTail(text)?.contextTokens ?? null
}

// Why: transcripts run to hundreds of MB; only the tail carries the current window size.
// A fixed-size read slices the first line mid-record, which the parser drops.
export async function readTranscriptTail(path: string, maxBytes = 256 * 1024): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, Math.max(0, size - length))
    return buffer.toString('utf-8')
  } finally {
    await handle.close()
  }
}
