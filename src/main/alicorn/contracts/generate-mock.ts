/**
 * A deterministic example value for a JSON Schema (CR2, Decision 5).
 *
 * Deterministic and dependency-free on purpose: a mock a worker can diff between runs is worth more
 * than a realistic one, and a faker dependency would be a permanent supply-chain cost for a
 * placeholder. It is not a validator — an unrecognised schema yields null rather than a throw,
 * because a mock is a convenience and must never be the thing that fails a run.
 */

type Json = Record<string, unknown>

/** Deep enough for a nested resource, shallow enough that a recursive `$ref` terminates. */
const DEPTH_MAX = 6

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

function formatExample(format: string): string | null {
  switch (format) {
    case 'date-time':
      return '2026-01-01T00:00:00.000Z'
    case 'date':
      return '2026-01-01'
    case 'time':
      return '00:00:00'
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000'
    case 'email':
      return 'someone@example.com'
    case 'uri':
    case 'url':
      return 'https://example.com'
    case 'hostname':
      return 'example.com'
    case 'ipv4':
      return '192.0.2.1'
    default:
      return null
  }
}

function numberExample(schema: Json, integer: boolean): number {
  const minimum = typeof schema['minimum'] === 'number' ? schema['minimum'] : undefined
  const maximum = typeof schema['maximum'] === 'number' ? schema['maximum'] : undefined
  const value = minimum ?? (maximum !== undefined ? Math.min(0, maximum) : integer ? 1 : 1.5)
  return integer ? Math.ceil(value) : value
}

function stringExample(schema: Json): string {
  const format = typeof schema['format'] === 'string' ? formatExample(schema['format']) : null
  if (format) {
    return format
  }
  const minLength = typeof schema['minLength'] === 'number' ? schema['minLength'] : 0
  const base = 'string'
  return base.length >= minLength ? base : base.padEnd(minLength, 'x')
}

/** `#/components/schemas/Refund` → the schema, when the caller supplied the document it points into. */
function resolveRef(ref: string, root: Json | undefined): unknown {
  if (!root || !ref.startsWith('#/')) {
    return undefined
  }
  let node: unknown = root
  for (const raw of ref.slice(2).split('/')) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    const parent = asObject(node)
    if (!parent) {
      return undefined
    }
    node = parent[segment]
  }
  return node
}

export type GenerateMockOptions = {
  /** The document `$ref`s point into. Without it a `$ref` yields null rather than a wrong shape. */
  root?: unknown
}

export function generateMock(schema: unknown, options: GenerateMockOptions = {}): unknown {
  return build(schema, asObject(options.root) ?? undefined, 0)
}

function build(schema: unknown, root: Json | undefined, depth: number): unknown {
  const node = asObject(schema)
  if (!node || depth > DEPTH_MAX) {
    return null
  }
  // An authored example beats anything derived from the types around it.
  if ('example' in node) {
    return node['example']
  }
  if ('default' in node) {
    return node['default']
  }
  if ('const' in node) {
    return node['const']
  }
  if (Array.isArray(node['enum']) && node['enum'].length > 0) {
    return node['enum'][0]
  }

  const ref = typeof node['$ref'] === 'string' ? node['$ref'] : null
  if (ref) {
    const resolved = resolveRef(ref, root)
    return resolved === undefined ? null : build(resolved, root, depth + 1)
  }

  // `allOf` is the one combinator worth merging: it is how a schema says "this and also that".
  if (Array.isArray(node['allOf'])) {
    const merged: Json = {}
    for (const part of node['allOf']) {
      const value = build(part, root, depth + 1)
      const object = asObject(value)
      if (object) {
        Object.assign(merged, object)
      }
    }
    return merged
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = node[key]
    // First branch, not a random one: a mock that changes between runs is not a mock.
    if (Array.isArray(branches) && branches.length > 0) {
      return build(branches[0], root, depth + 1)
    }
  }

  const declared = node['type']
  const type = Array.isArray(declared) ? declared[0] : declared
  switch (type) {
    case 'object':
      break
    case 'array': {
      const items = node['items']
      return items === undefined ? [] : [build(items, root, depth + 1)]
    }
    case 'string':
      return stringExample(node)
    case 'integer':
      return numberExample(node, true)
    case 'number':
      return numberExample(node, false)
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      // No `type`, but `properties` says what it is — the shape most OpenAPI documents actually use.
      if (!asObject(node['properties'])) {
        return null
      }
  }

  const properties = asObject(node['properties'])
  if (!properties) {
    return {}
  }
  const value: Json = {}
  for (const [name, child] of Object.entries(properties)) {
    value[name] = build(child, root, depth + 1)
  }
  return value
}
