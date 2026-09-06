const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/
export function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`invalid_identifier:${name}`)
  return name
}
// Why: CREATE POLICY has no IF NOT EXISTS; the DO block makes schema apply idempotent.
export function tenantRlsPolicySql(table: string): string {
  const t = assertIdentifier(table)
  const policy = `${t}_tenant_isolation`
  return `
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = '${t}' AND policyname = '${policy}') THEN
    EXECUTE $code$CREATE POLICY ${policy} ON ${t} USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true))$code$;
  END IF;
END $$;`
}
