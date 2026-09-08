import type { DesktopIdentityRecord, DesktopOrganization } from './desktop-identity-store.js'
import type { KeycloakTokens } from './keycloak-token-client.js'

// Shapes are frozen by the desktop's normalizers in
// `src/main/orca-profiles/profile-cloud-client.ts` — `normalizeSessionResponse`,
// `normalizeCloudSummary`, `normalizeOrganizations`, `normalizeCapabilities`. Every field
// `assertString`/`assertNumber` reads must be present and non-empty or sign-in throws.

export type DesktopCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type DesktopCapabilities = { flags: Record<string, boolean>; refreshedAt: number }

export type DesktopSessionResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: DesktopCloudSummary
  organizations: DesktopOrganization[]
  capabilities: DesktopCapabilities
}

export type DesktopContextResponse = {
  cloud: DesktopCloudSummary
  organizations: DesktopOrganization[]
  capabilities: DesktopCapabilities
}

// `relay.use` is read by src/main/runtime/relay/relay-auth-context.ts; `alicorn` marks a
// control plane that speaks our routes. Per-org entitlements are OP1, not this ticket.
export function desktopCapabilities(now: number): DesktopCapabilities {
  return { flags: { alicorn: true, 'relay.use': true }, refreshedAt: now }
}

export function buildDesktopCloudSummary(identity: DesktopIdentityRecord, now: number): DesktopCloudSummary {
  return {
    cloudProfileId: identity.cloudProfileId,
    userId: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
    activeOrgId: identity.activeOrgId,
    activeOrgName: identity.activeOrgName,
    linkedAt: now
  }
}

export function buildDesktopContextResponse(
  identity: DesktopIdentityRecord,
  now: number
): DesktopContextResponse {
  return {
    cloud: buildDesktopCloudSummary(identity, now),
    organizations: identity.organizations,
    capabilities: desktopCapabilities(now)
  }
}

export function buildDesktopSessionResponse(input: {
  tokens: KeycloakTokens
  identity: DesktopIdentityRecord
  now: number
}): DesktopSessionResponse {
  return {
    accessToken: input.tokens.accessToken,
    refreshToken: input.tokens.refreshToken,
    expiresAt: input.now + input.tokens.expiresIn * 1000,
    ...buildDesktopContextResponse(input.identity, input.now)
  }
}
