import { z } from 'zod'

/**
 * A project: the thing a board, a workflow and a set of required checks actually belong to.
 *
 * Until now `project_id` was Orca's repo id — every product table takes it as an opaque TEXT
 * column with no foreign key, which is why this table is additive rather than a migration. A row
 * here gives that id a name, a task-id prefix, and the repositories it spans, so one feature
 * crossing two repositories is one project instead of two unrelated configurations.
 *
 * A repository belongs to at most one project. Two would make "which project is this gate in"
 * unanswerable, and that question has exactly one right answer or the queue cannot be read.
 */
export const ProjectKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'key must be 2-10 uppercase letters or digits, starting with a letter')

/**
 * Where the project came from, when it was imported rather than typed.
 *
 * Its *issues* are deliberately not copied — Alicorn's board is a private working surface, and a
 * mirrored tracker is two places for one ticket to drift. The link is what lets a task reach one
 * issue on demand, where it is still current.
 */
export const ProjectSourceSchema = z.object({
  provider: z.enum(['plane', 'linear', 'jira']),
  /** The provider's own project id, which its API takes. */
  boardId: z.string().trim().min(1).max(200),
  /** The short key the provider shows in issue ids — `ALC` in `ALC-11`. */
  identifier: z.string().trim().max(50).default(''),
  url: z.string().trim().max(1000).nullable().default(null)
})

export type ProjectSource = z.infer<typeof ProjectSourceSchema>

export const ProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Prefixes every task id in the project — PAY-142. Uppercase so the ids read as one shape. */
  key: ProjectKeySchema,
  /**
   * What the project is for, in prose. Carried into every brief, so a member reads the domain
   * before it reads the ticket — the underinformed member is the one the ledger cannot tell from
   * a wrong one.
   */
  context: z.string().trim().max(20_000).default(''),
  /** Orca repo ids. Order is not meaningful; the set is. */
  repoIds: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  source: ProjectSourceSchema.nullable().default(null)
})

export type ProjectInput = z.infer<typeof ProjectInputSchema>

export type Project = {
  id: string
  tenantId: string
  name: string
  key: string
  context: string
  repoIds: string[]
  source: ProjectSource | null
  createdBy: string
  createdAt: string
  updatedAt: string
}
