import { defineConfig } from 'vitest/config'
// Why: Postgres tests share one database; keep them serial like the relay's `relay-postgres` project.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], fileParallelism: false, testTimeout: 15_000, hookTimeout: 15_000 } })
