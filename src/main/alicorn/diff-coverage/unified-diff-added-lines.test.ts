import { describe, expect, it } from 'vitest'
import { addedLinesFromUnifiedDiff } from './unified-diff-added-lines'

const DIFF_FIXTURE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,0 +11,2 @@ some context',
  '+added line 11',
  '+added line 12',
  '@@ -20,2 +23,0 @@ other context',
  '-removed line 20',
  '-removed line 21',
  'diff --git a/src/b.ts b/src/b.ts',
  'index 333..444 100644',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -5,0 +6,3 @@ context',
  '+added line 6',
  '+added line 7',
  '+added line 8'
].join('\n')

describe('addedLinesFromUnifiedDiff', () => {
  it('records the new-file cursor for each + line, advancing per line', () => {
    const added = addedLinesFromUnifiedDiff(DIFF_FIXTURE)

    expect(added.get('src/a.ts')).toEqual(new Set([11, 12]))
    expect(added.get('src/b.ts')).toEqual(new Set([6, 7, 8]))
  })

  it('does not record a file whose only hunk is deletion-only', () => {
    const diff = [
      '--- a/src/c.ts',
      '+++ b/src/c.ts',
      '@@ -1,2 +0,0 @@',
      '-removed line 1',
      '-removed line 2'
    ].join('\n')

    const added = addedLinesFromUnifiedDiff(diff)

    expect(added.has('src/c.ts')).toBe(false)
  })
})
