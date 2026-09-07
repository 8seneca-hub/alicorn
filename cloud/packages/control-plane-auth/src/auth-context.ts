export type AuthContext = { tenantId: string; actor: string; userId: string | null }
export type ControlPlaneAuthEnv = { Variables: { auth: AuthContext } }
