import { z } from 'zod'

/**
 * The reach half of a blast-radius budget (BR1, ARCHITECTURE §9): the parts of a repository a run
 * may not touch unattended, whatever its track record says.
 *
 * Authored per project by an org admin and read-only to the desktop, for exactly the reason
 * required checks are: a member cannot loosen its own criteria, so the surface it is judged
 * against must not be writable by anything on the worker side.
 *
 * Two forms rather than a glob dialect. A glob engine is a matcher with its own escaping,
 * traversal and case-folding rules, and a second one in this codebase is a second place for those
 * to be subtly wrong — `qa-workspace-path.ts` is the first and it was not cheap. `path` protects a
 * file or a whole subtree; `extension` protects "every .tf anywhere". A third form is additive
 * when something actually needs it.
 */
const ProtectedPathReasonSchema = z.string().trim().max(200).optional()

export const ProtectedPathPrefixSchema = z.object({
  kind: z.literal('path'),
  /** Repo-relative. A directory protects everything beneath it, on a segment boundary. */
  path: z.string().trim().min(1).max(500),
  reason: ProtectedPathReasonSchema
})

export const ProtectedPathExtensionSchema = z.object({
  kind: z.literal('extension'),
  /** With or without the leading dot; matched case-insensitively anywhere in the repository. */
  extension: z.string().trim().min(1).max(50),
  reason: ProtectedPathReasonSchema
})

export const ProtectedPathSchema = z.discriminatedUnion('kind', [
  ProtectedPathPrefixSchema,
  ProtectedPathExtensionSchema
])
export const ProtectedPathsSchema = z.array(ProtectedPathSchema).max(200)

export type ProtectedPath = z.infer<typeof ProtectedPathSchema>
