import { z } from 'zod'

// Why: Keycloak's `organization` claim has two shapes depending on how the mapper is configured —
// the Organization Membership mapper emits ids, a plain scope mapping emits aliases only.
const OrganizationClaimSchema = z.union([
  z.record(z.object({ id: z.string().min(1) }).passthrough()),
  z.array(z.string().min(1))
])

export const KeycloakAccessClaimsSchema = z.object({
  sub: z.string().min(1),
  azp: z.string().min(1),
  exp: z.number().int().positive(),
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  nonce: z.string().optional(),
  organization: OrganizationClaimSchema.optional()
})

export type KeycloakAccessClaims = z.infer<typeof KeycloakAccessClaimsSchema>
export type OrganizationMembership = { id: string; alias: string }
export type OrganizationClaim = { resolved: OrganizationMembership[]; unresolvedAliases: string[] }

export function organizationsFromClaim(claim: KeycloakAccessClaims['organization']): OrganizationClaim {
  if (!claim) return { resolved: [], unresolvedAliases: [] }
  if (Array.isArray(claim)) return { resolved: [], unresolvedAliases: [...claim] }
  return {
    resolved: Object.entries(claim).map(([alias, value]) => ({ id: value.id, alias })),
    unresolvedAliases: []
  }
}
