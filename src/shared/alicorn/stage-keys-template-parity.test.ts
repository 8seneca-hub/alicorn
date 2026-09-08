import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURE_DELIVERY_STAGE_KEYS, TEMPLATE_STAGE_KEY_BY_COLUMN_ID } from './stage-keys'

/**
 * A ratchet on the hand-mirror. The desktop cannot import `@alicorn-cloud/control-plane-contract`,
 * so `stage-keys.ts` transcribes `FEATURE_DELIVERY_TEMPLATE` — and a transcription nobody checks
 * drifts. Drift here is silent and expensive: a stage key the ledger measures but the desktop does
 * not recognise as authored simply never retires, with no error anywhere.
 *
 * Read as text rather than imported, because that import is exactly what does not exist.
 */
// From the repository root, which is where the vitest config lives and therefore the cwd.
// `import.meta` is unavailable: this file is also compiled under the CommonJS CLI project.
const TEMPLATE_SOURCE = resolve(
  process.cwd(),
  'cloud/packages/control-plane-contract/src/workflow-template.ts'
)

type TemplateStage = { key: string; columnId: string | null }

function templateStages(): TemplateStage[] {
  const source = readFileSync(TEMPLATE_SOURCE, 'utf8')
  const stages = source.slice(
    source.indexOf('export const FEATURE_DELIVERY_TEMPLATE'),
    source.indexOf('transitions: [')
  )
  return [...stages.matchAll(/\{ key: '([a-z-]+)',[^}]*?columnId: (?:'([a-z-]+)'|null)/g)].map(
    (match) => ({ key: match[1], columnId: match[2] ?? null })
  )
}

describe('the desktop mirror of the shipped workflow template', () => {
  it('finds the template it is mirroring', () => {
    expect(templateStages().length).toBeGreaterThan(0)
  })

  it('carries the same stage keys, in the same order', () => {
    expect(templateStages().map((stage) => stage.key)).toEqual([...FEATURE_DELIVERY_STAGE_KEYS])
  })

  it('carries the same board-column bindings', () => {
    const fromTemplate = Object.fromEntries(
      templateStages()
        .filter((stage) => stage.columnId !== null)
        .map((stage) => [stage.columnId as string, stage.key])
    )
    expect(fromTemplate).toEqual({ ...TEMPLATE_STAGE_KEY_BY_COLUMN_ID })
  })
})
