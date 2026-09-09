import { z } from 'zod'

/**
 * The org skill catalog (OP2/SP1). A skill is admin-authored: a member references one, and can
 * neither publish a version nor move `latest`. That is what keeps a stage check that names a
 * catalog skill out of reach of the member being judged.
 *
 * Versions reuse Orca's skill-manifest vocabulary (`packageId`/`versionId`/digest) rather than
 * inventing a second one — see `src/shared/skill-package-manifest.ts`.
 */
export const SKILL_SCOPES = ['org', 'project'] as const
export const SkillScopeSchema = z.enum(SKILL_SCOPES)

export const SkillNameSchema = z.string().trim().min(1).max(200)
export const SkillVersionIdSchema = z.string().trim().min(1).max(128)
const ProjectIdSchema = z.string().trim().min(1).max(200)

export const SkillInputSchema = z
  .object({
    scope: SkillScopeSchema.default('org'),
    projectId: ProjectIdSchema.nullable().default(null),
    name: SkillNameSchema,
    packageId: z.string().trim().min(1).max(128).nullable().default(null)
  })
  // Why paired rather than two independent fields: a 'project' skill with no project is
  // unreachable, and an 'org' skill carrying one would silently narrow who may reference it.
  .refine((s) => (s.scope === 'project') === (s.projectId !== null), {
    message: 'a project skill carries a projectId; an org skill does not'
  })

export const SkillVersionInputSchema = z.object({
  versionId: SkillVersionIdSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/, 'digest must be a sha256 hex digest'),
  manifest: z.record(z.unknown()).default({})
})

export const SkillVersionSchema = z.object({
  skillId: z.string().min(1),
  versionId: SkillVersionIdSchema,
  digest: z.string(),
  manifest: z.record(z.unknown()),
  publishedAt: z.string().datetime()
})

export const SkillSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  scope: SkillScopeSchema,
  projectId: z.string().nullable(),
  name: z.string(),
  packageId: z.string().nullable(),
  latestVersionId: z.string().nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime()
})

export const SkillLatestInputSchema = z.object({ versionId: SkillVersionIdSchema })

/** `versionId: null` follows the catalog's `latest`; a value pins and survives a `latest` move. */
export const MemberSkillRefSchema = z.object({
  name: SkillNameSchema,
  versionId: SkillVersionIdSchema.nullable().default(null)
})

/** Additive: a bare string is the pre-catalog shape and still means "follow latest". */
export const MemberSkillRefInputSchema = z.union([
  SkillNameSchema.transform((name) => ({ name, versionId: null as string | null })),
  MemberSkillRefSchema
])

export type SkillScope = z.infer<typeof SkillScopeSchema>
export type SkillInput = z.infer<typeof SkillInputSchema>
export type Skill = z.infer<typeof SkillSchema>
export type SkillVersionInput = z.infer<typeof SkillVersionInputSchema>
export type SkillVersion = z.infer<typeof SkillVersionSchema>
export type MemberSkillRef = z.infer<typeof MemberSkillRefSchema>
