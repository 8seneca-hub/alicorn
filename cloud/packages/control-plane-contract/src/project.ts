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

export const ProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Prefixes every task id in the project — PAY-142. Uppercase so the ids read as one shape. */
  key: ProjectKeySchema,
  /** Orca repo ids. Order is not meaningful; the set is. */
  repoIds: z.array(z.string().trim().min(1).max(200)).max(50).default([])
})

export type ProjectInput = z.infer<typeof ProjectInputSchema>

export type Project = {
  id: string
  tenantId: string
  name: string
  key: string
  repoIds: string[]
  createdBy: string
  createdAt: string
  updatedAt: string
}
