// Hand-mirrored from cloud/packages/control-plane-contract/src/project.ts.
// Field names must stay identical — the desktop does not import the contract package, so a
// rename there is a silent break here.

/**
 * Where the project came from, when it was imported rather than typed.
 *
 * Its *issues* are deliberately not copied — Alicorn's board is a private working surface, and a
 * mirrored tracker is two places for one ticket to drift. The link is what lets a task reach one
 * issue on demand, where it is still current.
 */
export type ProjectSource = {
  provider: 'plane' | 'linear' | 'jira'
  /** The provider's own project id, which its API takes. */
  boardId: string
  /** The short key the provider shows in issue ids — `ALC` in `ALC-11`. */
  identifier: string
  url: string | null
}

export type ProjectInput = {
  name: string
  /** Prefixes every task id in the project — PAY-142. Uppercase, 2-10 characters. */
  key: string
  /** What the project is for, in prose. Carried into every brief. */
  context: string
  /** Alicorn repo ids. A repository belongs to at most one project. */
  repoIds: string[]
  source: ProjectSource | null
}

export type Project = ProjectInput & {
  id: string
  tenantId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}
