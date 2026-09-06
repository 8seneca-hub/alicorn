import { asRecord, asString, fetchAllPages, type PlaneRecord } from './plane-record-pages'
import { planeRequest, projectPath, type PlaneClient } from './plane-request'
import { withIssueSegment } from './plane-issue-endpoint'

export type PlaneComment = {
  id: string
  /** Plane stores comment bodies as HTML; the CLI renders them as text. */
  commentHtml: string
  actorId: string | null
  createdAt: string
  updatedAt: string
}

function mapPlaneComment(record: PlaneRecord): PlaneComment | null {
  const id = asString(record.id)
  if (!id) {
    return null
  }
  const createdAt = asString(record.created_at) ?? ''
  return {
    id,
    commentHtml: asString(record.comment_html) ?? '',
    actorId: asString(record.actor) ?? null,
    createdAt,
    updatedAt: asString(record.updated_at) ?? createdAt
  }
}

function commentsPath(
  client: PlaneClient,
  projectId: string,
  issueId: string,
  segment: string
): string {
  return projectPath(
    client.workspaceSlug,
    projectId,
    `${segment}/${encodeURIComponent(issueId)}/comments/`
  )
}

export async function listIssueComments(
  client: PlaneClient,
  projectId: string,
  issueId: string
): Promise<PlaneComment[]> {
  const records = await withIssueSegment(client, (segment) =>
    fetchAllPages<unknown>(client, commentsPath(client, projectId, issueId, segment))
  )
  return records
    .map((record) => mapPlaneComment(asRecord(record)))
    .filter((comment): comment is PlaneComment => comment !== null)
}

// Plane accepts `comment_html`; markdown from the CLI is wrapped in a paragraph
// rather than converted, because a half-done conversion reads worse on the board
// than the source text does.
export async function addIssueComment(
  client: PlaneClient,
  projectId: string,
  issueId: string,
  body: string
): Promise<PlaneComment | null> {
  const record = await withIssueSegment(client, (segment) =>
    planeRequest<unknown>(client, commentsPath(client, projectId, issueId, segment), {
      method: 'POST',
      body: JSON.stringify({ comment_html: markdownToHtmlParagraphs(body) })
    })
  )
  return mapPlaneComment(asRecord(record))
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function markdownToHtmlParagraphs(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
  return paragraphs.join('') || '<p></p>'
}
