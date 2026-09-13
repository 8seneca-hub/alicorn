/**
 * Every PM tool an import can read, behind one shape.
 *
 * A project names its own provider, so two projects in the same org can sit on different trackers —
 * which is the normal case once a team has inherited one codebase and started another.
 *
 * The shape is deliberately the smallest thing the import needs: what boards exist, what each is
 * called, its short key, and what it is for. Everything else about a provider stays in that
 * provider's own client.
 */
import type { ProjectSource } from '../../../../../shared/alicorn/projects'

/** A failure code, not copy: the dialog decides how to say it, and a locale must not change it. */
const PROVIDER_UNAVAILABLE = 'provider_unavailable'

export const PM_PROVIDERS = ['plane', 'linear', 'jira'] as const
export type PmProvider = (typeof PM_PROVIDERS)[number]

export const PM_PROVIDER_LABELS: Record<PmProvider, string> = {
  plane: 'Plane',
  linear: 'Linear',
  jira: 'Jira'
}

export type PmBoard = {
  id: string
  name: string
  /** The short key the tracker shows in issue ids — `ALC` in `ALC-11`. Empty when it has none. */
  identifier: string
  /** What the board is for, as the tracker holds it. May be HTML (Plane) or plain text. */
  description: string
  /** True when the description arrived as HTML and needs stripping before it is read as prose. */
  descriptionIsHtml: boolean
}

export type PmBoardListing = { ok: true; boards: PmBoard[] } | { ok: false; error: string }

/**
 * Whether the provider can list the issues *of one board*.
 *
 * Plane's client takes a project id; Linear's and Jira's list by assignee or site and have no
 * per-board query yet. Saying so is better than listing a workspace's issues and calling them the
 * board's — the picker would look like it worked and hand back the wrong ticket.
 */
export function canListBoardIssues(source: ProjectSource | null): boolean {
  return source?.provider === 'plane'
}

async function connected(provider: PmProvider): Promise<boolean> {
  const api = window.api
  try {
    if (provider === 'plane') {
      return (await api?.plane?.status())?.connected === true
    }
    if (provider === 'linear') {
      return (await api?.linear?.status())?.connected === true
    }
    return (await api?.jira?.status())?.connected === true
  } catch {
    return false
  }
}

export async function isPmProviderConnected(provider: PmProvider): Promise<boolean> {
  return connected(provider)
}

export async function listPmBoards(provider: PmProvider): Promise<PmBoardListing> {
  try {
    if (provider === 'plane') {
      const listed = await window.api?.plane?.listProjects()
      if (!listed) {
        return { ok: false, error: PROVIDER_UNAVAILABLE }
      }
      return listed.ok
        ? {
            ok: true,
            boards: listed.value.map((project) => ({
              id: project.id,
              name: project.name,
              identifier: project.identifier,
              description: project.description ?? '',
              descriptionIsHtml: true
            }))
          }
        : { ok: false, error: listed.error }
    }
    if (provider === 'linear') {
      const listed = await window.api?.linear?.listProjects({ limit: 100 })
      return {
        ok: true,
        boards: (listed?.items ?? []).map((project) => ({
          id: project.id,
          // Linear projects have no issue prefix — its teams do — so the key is left to be typed.
          name: project.name,
          identifier: '',
          description: project.description ?? '',
          descriptionIsHtml: false
        }))
      }
    }
    const projects = await window.api?.jira?.listProjects()
    return {
      ok: true,
      boards: (projects ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        identifier: project.key,
        description: '',
        descriptionIsHtml: false
      }))
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}
