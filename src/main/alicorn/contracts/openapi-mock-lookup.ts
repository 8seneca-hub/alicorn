/**
 * Finds the JSON Schema behind a Contract Registry entry's name, in the document it was extracted
 * from.
 *
 * The registry stores a ~200-token *description* of a shape, not the schema — that ceiling is its
 * whole economic claim. So a mock goes back to the document rather than to the entry, which also
 * means the mock is generated from what the repo says today, never from a stale registry row.
 */

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']

export type OpenApiMockTarget = {
  /** `components/schemas/Refund` or `paths//refunds/{id}/get/200` — what was actually mocked. */
  source: string
  schema: unknown
}

function successResponseSchema(operation: Json): { status: string; schema: unknown } | null {
  const responses = asObject(operation['responses'])
  if (!responses) {
    return null
  }
  const statuses = Object.keys(responses)
  // A 2xx first, because the mock a caller wants is the one they build their happy path against.
  const chosen = statuses.find((status) => /^2\d\d$/.test(status)) ?? statuses[0]
  if (!chosen) {
    return null
  }
  const content = asObject(asObject(responses[chosen])?.['content'])
  const media = content ? Object.values(content)[0] : undefined
  const schema = asObject(media)?.['schema']
  return schema === undefined ? null : { status: chosen, schema }
}

/**
 * `name` is a registry entry name: a component schema name, or `GET /refunds/{id}`.
 *
 * Case-insensitive on the method only — a path and a schema name are both case-sensitive in
 * OpenAPI, and matching them loosely would silently mock the wrong thing.
 */
export function findOpenApiMockTarget(document: unknown, name: string): OpenApiMockTarget | null {
  const root = asObject(document)
  if (!root) {
    return null
  }
  const wanted = name.trim()

  const schemas = asObject(asObject(root['components'])?.['schemas'])
  if (schemas && wanted in schemas) {
    return { source: `components/schemas/${wanted}`, schema: schemas[wanted] }
  }

  const match = /^([A-Za-z]+)\s+(\S.*)$/.exec(wanted)
  const paths = asObject(root['paths'])
  if (!match || !paths) {
    return null
  }
  const method = match[1]!.toLowerCase()
  const path = match[2]!
  if (!HTTP_METHODS.includes(method)) {
    return null
  }
  const operation = asObject(asObject(paths[path])?.[method])
  if (!operation) {
    return null
  }
  const response = successResponseSchema(operation)
  if (response) {
    return { source: `paths/${path}/${method}/${response.status}`, schema: response.schema }
  }
  // No documented response: the request body is the next most useful thing to build against.
  const content = asObject(asObject(operation['requestBody'])?.['content'])
  const media = content ? Object.values(content)[0] : undefined
  const body = asObject(media)?.['schema']
  return body === undefined ? null : { source: `paths/${path}/${method}/requestBody`, schema: body }
}
