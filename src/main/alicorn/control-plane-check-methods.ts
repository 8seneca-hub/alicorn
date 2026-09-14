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
  /**
   * The project's required checks, plus the named stage's own. Both are admin-authored, and the
   * answer is their union — a stage may require more than the project, never less.
   */
  getRequiredChecks: (projectId: string, stageKey?: string) => Promise<RequiredCheck[]>
  /** Whole-set replace: the API stores the list, so a partial write would drop the rest. */
  setRequiredChecks: (projectId: string, checks: RequiredCheck[]) => Promise<RequiredCheck[]>
  getProtectedPaths: (projectId: string) => Promise<ProtectedPath[]>
}

export function createControlPlaneCheckMethods(
  readJson: ReadJson,
  projectPath: (projectId: string) => string
): ControlPlaneCheckMethods {
  return {
    getRequiredChecks: async (projectId, stageKey) => {
      // A paired host older than this ignores the parameter and answers the project's list, which
      // is the pre-stage behaviour rather than a failure.
      const query = stageKey ? `?${new URLSearchParams({ stageKey }).toString()}` : ''
      const body = await readJson<{ checks: RequiredCheck[] }>(
        'control',
        `${projectPath(projectId)}/required-checks${query}`
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
