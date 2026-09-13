// Hand-mirrored from cloud/packages/control-plane-contract/src/project.ts.
// Field names must stay identical — the desktop does not import the contract package, so a
// rename there is a silent break here.

export type ProjectInput = {
  name: string
  /** Prefixes every task id in the project — PAY-142. Uppercase, 2-10 characters. */
  key: string
  /** Alicorn repo ids. A repository belongs to at most one project. */
  repoIds: string[]
}

export type Project = ProjectInput & {
  id: string
  tenantId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}
