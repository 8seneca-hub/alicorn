import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseJournal, renderJournal } from './journal-markdown'
import type { Journal } from './journal-types'

export * from './journal-types'
export { parseJournal, renderJournal } from './journal-markdown'

export function journalPath(worktreePath: string, runId: string): string {
  return join(worktreePath, '.foreman', runId, 'journal.md')
}

/** Absent journal reads as null: a run that has not started one is not an error. */
export async function readJournal(path: string): Promise<Journal | null> {
  let markdown: string
  try {
    markdown = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  return parseJournal(markdown)
}

/**
 * Atomic write. The journal is the only record of an orchestrated run, so a crash mid-write must
 * leave the previous version intact rather than a half-file that no longer parses.
 */
export async function writeJournal(path: string, journal: Journal): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, renderJournal(journal), 'utf8')
  await rename(temporary, path)
}
