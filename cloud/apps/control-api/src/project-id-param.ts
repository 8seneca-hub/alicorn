// Why: projectId is Orca's opaque project/repo id — accept any non-empty string within a sane bound.
export function isValidProjectId(projectId: string): boolean {
  return projectId.length >= 1 && projectId.length <= 200
}
