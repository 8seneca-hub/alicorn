import { z } from 'zod'
import { MemberSkillRefInputSchema } from './skill.js'

export const MEMBER_BACKENDS = ['claude', 'codex', 'grok', 'openclaude'] as const
export const MEMBER_ROLES = ['developer', 'reviewer', 'qa', 'analyst', 'other'] as const
export const WORKSPACE_KINDS = ['worktree', 'folder'] as const
export const PERMISSION_MODES = ['ask', 'accept_edits', 'yolo'] as const

export const MemberBackendSchema = z.enum(MEMBER_BACKENDS)
export const MemberRoleSchema = z.enum(MEMBER_ROLES)

export const MemberInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: MemberRoleSchema,
  backend: MemberBackendSchema,
  workspaceKind: z.enum(WORKSPACE_KINDS),
  permissionMode: z.enum(PERMISSION_MODES),
  systemRules: z.string().max(20_000).default(''),
  // Additive (OP2): a skill is a `{ name, versionId }` ref; a bare string still arrives as
  // "follow latest". Dedup is by name — one member cannot hold two pins of the same skill.
  skills: z
    .array(MemberSkillRefInputSchema)
    .max(50)
    .default([])
    .refine((s) => new Set(s.map((ref) => ref.name)).size === s.length, 'skills must be unique by name')
})

export const MemberSchema = MemberInputSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export type MemberBackend = z.infer<typeof MemberBackendSchema>
export type MemberRole = z.infer<typeof MemberRoleSchema>
export type MemberInput = z.infer<typeof MemberInputSchema>
export type Member = z.infer<typeof MemberSchema>
