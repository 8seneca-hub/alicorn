import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalNumberFlag, getOptionalStringFlag, getRequiredStringFlag } from '../../flags'
import { planeHtmlToText } from './issue-text'

type PlaneIssuePayload = {
  id: string
  readableId: string
  name: string
  descriptionHtml: string
  priority: string
  stateId: string | null
  projectId: string
  webUrl?: string
  updatedAt: string
}

type PlaneCommentPayload = {
  id: string
  commentHtml: string
  actorId: string | null
  createdAt: string
}

function issueScopeFlags(flags: Map<string, string | boolean>): Record<string, string> {
  const project = getOptionalStringFlag(flags, 'project')
  const connection = getOptionalStringFlag(flags, 'connection')
  return {
    ...(project ? { projectId: project } : {}),
    ...(connection ? { connectionId: connection } : {})
  }
}

function describeIssue(issue: PlaneIssuePayload): string {
  const lines = [`${issue.readableId}  ${issue.name}`]
  if (issue.webUrl) {
    lines.push(issue.webUrl)
  }
  lines.push(`priority: ${issue.priority}    updated: ${issue.updatedAt}`)
  const body = planeHtmlToText(issue.descriptionHtml)
  if (body) {
    lines.push('', body)
  }
  return lines.join('\n')
}

export const PLANE_HANDLERS: Record<string, CommandHandler> = {
  'plane issue': async ({ flags, client, json }) => {
    const result = await client.call<{ issue: PlaneIssuePayload; comments: PlaneCommentPayload[] }>(
      'plane.issue',
      { reference: getRequiredStringFlag(flags, 'id'), ...issueScopeFlags(flags) }
    )
    printResult(result, json, ({ issue, comments }) => {
      const parts = [describeIssue(issue)]
      if (comments.length > 0) {
        parts.push(
          '',
          `comments (${comments.length}):`,
          ...comments.map(
            (comment) =>
              `  ${comment.createdAt}  ${planeHtmlToText(comment.commentHtml) || '(empty)'}`
          )
        )
      }
      return parts.join('\n')
    })
  },

  'plane search': async ({ flags, client, json }) => {
    const state = getOptionalStringFlag(flags, 'state')
    const query = getOptionalStringFlag(flags, 'query')
    const limit = getOptionalNumberFlag(flags, 'limit')
    const connection = getOptionalStringFlag(flags, 'connection')
    const result = await client.call<PlaneIssuePayload[]>('plane.search', {
      projectId: getRequiredStringFlag(flags, 'project'),
      ...(state ? { stateGroup: state } : {}),
      ...(query ? { query } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(connection ? { connectionId: connection } : {})
    })
    printResult(result, json, (issues) =>
      issues.length === 0
        ? 'No matching Plane issues.'
        : issues.map((issue) => `${issue.readableId}  ${issue.name}`).join('\n')
    )
  },

  'plane comment': async ({ flags, client, json }) => {
    const result = await client.call<PlaneCommentPayload | null>('plane.comment', {
      reference: getRequiredStringFlag(flags, 'id'),
      body: getRequiredStringFlag(flags, 'body'),
      ...issueScopeFlags(flags)
    })
    printResult(result, json, () => 'Comment added.')
  },

  'plane state': async ({ flags, client, json }) => {
    const result = await client.call<{ issue: PlaneIssuePayload | null; stateName: string }>(
      'plane.setState',
      {
        reference: getRequiredStringFlag(flags, 'id'),
        stateName: getRequiredStringFlag(flags, 'to'),
        ...issueScopeFlags(flags)
      }
    )
    printResult(
      result,
      json,
      (value) => `${value.issue?.readableId ?? 'Issue'} moved to ${value.stateName}.`
    )
  }
}
