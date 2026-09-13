/**
 * Where the Alicorn shell is pointing.
 *
 * The scope decides the sidebar — that is the whole point of the rail, and the defect it fixes:
 * no screen shows a project's name while editing something that is not a project's to hold. So
 * the route carries its scope explicitly rather than inferring one from whatever is selected.
 */

export const PROJECT_SECTIONS = [
  'tasks',
  'board',
  'inbox',
  'members',
  'workflow',
  'checks',
  'mcp',
  'settings'
] as const
export type ProjectSection = (typeof PROJECT_SECTIONS)[number]

/** Opening a project lands on its work, not on a dashboard about it. */
export const DEFAULT_PROJECT_SECTION: ProjectSection = 'tasks'

export const ORG_SECTIONS = ['members', 'workflows', 'autonomy'] as const
export type OrgSection = (typeof ORG_SECTIONS)[number]

export type AlicornRoute =
  | { scope: 'projects'; projectId: null }
  | {
      scope: 'projects'
      projectId: string
      section: ProjectSection
      /** A task open inside the section it was opened from, so closing it returns there. */
      taskId?: string | null
    }
  | { scope: 'org'; section: OrgSection }
  | { scope: 'inbox' }

export const ALICORN_HOME: AlicornRoute = { scope: 'projects', projectId: null }

/** The rail's four destinations, which is a smaller set than the routes they land on. */
export type AlicornRailTarget = 'projects' | 'org' | 'inbox'

export function railTargetOf(route: AlicornRoute): AlicornRailTarget {
  return route.scope === 'projects' ? 'projects' : route.scope
}

export function isProjectRoute(route: AlicornRoute): route is {
  scope: 'projects'
  projectId: string
  section: ProjectSection
  taskId?: string | null
} {
  return route.scope === 'projects' && route.projectId !== null
}
