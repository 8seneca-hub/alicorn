export type AlicornBearer = {
  accessToken: string
  orgId: string
}

// A token this short is a placeholder or a truncated paste, not a credential;
// rejecting it here turns a confusing 401 into "not configured".
const MIN_ACCESS_TOKEN_LENGTH = 16

const DEFAULT_ORG_ID = 'local'

// Why a function and not two constants: the Keycloak plan (I4) replaces this
// body with the Orca Cloud session lookup and nothing else in the desktop
// changes — this is the single swap point for identity.
export function readAlicornBearer(env: NodeJS.ProcessEnv): AlicornBearer | null {
  const accessToken = env.ALICORN_LOCAL_API_TOKEN?.trim()
  if (!accessToken || accessToken.length < MIN_ACCESS_TOKEN_LENGTH) {
    return null
  }
  return {
    accessToken,
    orgId: env.ALICORN_TENANT_ID?.trim() || DEFAULT_ORG_ID
  }
}
