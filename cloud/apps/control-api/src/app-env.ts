// Why: Task 4's auth middleware sets `c.set('auth', …)` against this typed env.
export type AuthContext = { tenantId: string; actor: string }
export type ControlApiEnv = { Variables: { auth: AuthContext } }
