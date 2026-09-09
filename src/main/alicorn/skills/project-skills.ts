import type { DiscoveredSkill } from '../../../shared/skills'

/**
 * PS1 Decision 2: project skills are not uploaded. They are the repo-committed dirs Orca already
 * discovers (`<repo>/.claude/skills`, `.agents/skills`) — reviewed like code, in the same PR as the
 * work. `sourceKind === 'repo'` is exactly that set; `home`, `bundled` and `plugin` belong to the
 * machine, not the project.
 */
export function projectSkillNames(discovered: readonly DiscoveredSkill[]): string[] {
  return [...new Set(discovered.filter((s) => s.sourceKind === 'repo').map((s) => s.name))].sort()
}
