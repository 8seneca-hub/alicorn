/**
 * The project-scoped criteria a member is judged against: required checks and protected paths.
 *
 * Split from `control-plane-client` for length. Grouped rather than scattered because they share
 * one property worth stating in one place — every one of them is authored by an admin, never by
 * the member the criterion judges, which is why nothing here is reachable from a worker session.
 */
import type { RequiredCheck } from '../../shared/alicorn/members'
import type { ProtectedPath } from '../../shared/alicorn/protected-paths'

type ReadJson = <T>(service: 'control' | 'ledger', path: string, init?: RequestInit) => Promise<T>

export type ControlPlaneCheckMethods = {
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  /** Whole-set replace: the API stores the list, so a partial write would drop the rest. */
  setRequiredChecks: (projectId: string, checks: RequiredCheck[]) => Promise<RequiredCheck[]>
  getProtectedPaths: (projectId: string) => Promise<ProtectedPath[]>
}

export function createControlPlaneCheckMethods(
  readJson: ReadJson,
  projectPath: (projectId: string) => string
): ControlPlaneCheckMethods {
  return {
    getRequiredChecks: async (projectId) => {
      const body = await readJson<{ checks: RequiredCheck[] }>(
        'control',
        `${projectPath(projectId)}/required-checks`
      )
      return body.checks ?? []
    },

    setRequiredChecks: async (projectId, checks) => {
      const body = await readJson<{ checks: RequiredCheck[] }>(
        'control',
        `${projectPath(projectId)}/required-checks`,
        { method: 'PUT', body: JSON.stringify({ checks }) }
      )
      return body.checks ?? []
    },

    getProtectedPaths: async (projectId) => {
      const body = await readJson<{ paths: ProtectedPath[] }>(
        'control',
        `${projectPath(projectId)}/protected-paths`
      )
      return body.paths ?? []
    }
  }
}
