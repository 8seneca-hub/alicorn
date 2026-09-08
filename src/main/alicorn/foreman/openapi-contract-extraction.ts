import { clampShape, type ContractEntry } from './contract-registry'

/**
 * Extracts one ~200-token entry per operation from an OpenAPI document.
 *
 * Deliberately not a validator and not a resolver. It reads the shapes a worker has to build
 * against — method, path, parameters, request body, response codes — and names everything else by
 * `$ref`. A dialect it does not understand costs the run one imprecise entry, never a crash, so
 * every read below is defensive.
 */

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'] as const

/** Inline object shapes are summarised, not transcribed: past this many fields the entry stops paying. */
const INLINE_FIELDS_MAX = 12
/** How deep an inline schema is walked before it is named rather than described. */
const INLINE_DEPTH_MAX = 2
/** A document with more operations than this is summarised up to the cap and the rest is reported. */
export const OPENAPI_OPERATIONS_MAX = 150

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** `#/components/schemas/RefundRequest` → `RefundRequest`; anything else keeps its last segment. */
function refName(ref: string): string {
  const segments = ref.split('/').filter(Boolean)
  return segments.at(-1) ?? ref
}

/**
 * A schema rendered as the smallest thing a worker can build against.
 *
 * A `$ref` becomes the type's name — that is the point of the registry, since the named schema gets
 * its own entry. An inline object becomes `{field: type, optional?: type}`; a scalar becomes its
 * type; anything unrecognised becomes `unknown`, never a guess.
 */
export function describeSchema(schema: unknown, depth = 0): string {
  const node = asObject(schema)
  if (!node) {
    return 'unknown'
  }
  const ref = asString(node['$ref'])
  if (ref) {
    return refName(ref)
  }
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = node[key]
    if (Array.isArray(branches) && branches.length > 0) {
      const joiner = key === 'allOf' ? ' & ' : ' | '
      return branches.map((branch) => describeSchema(branch, depth + 1)).join(joiner)
    }
  }
  if (Array.isArray(node['enum'])) {
    return node['enum'].map((value) => JSON.stringify(value)).join(' | ')
  }
  const type = asString(node['type'])
  if (type === 'array') {
    return `${describeSchema(node['items'], depth + 1)}[]`
  }
  const properties = asObject(node['properties'])
  if (properties) {
    if (depth >= INLINE_DEPTH_MAX) {
      return 'object'
    }
    const required = new Set(
      (Array.isArray(node['required']) ? node['required'] : []).filter(
        (name): name is string => typeof name === 'string'
      )
    )
    const names = Object.keys(properties)
    const shown = names
      .slice(0, INLINE_FIELDS_MAX)
      .map(
        (name) =>
          `${name}${required.has(name) ? '' : '?'}: ${describeSchema(properties[name], depth + 1)}`
      )
    const rest = names.length - shown.length
    return `{${shown.join(', ')}${rest > 0 ? `, +${rest} more` : ''}}`
  }
  return type || 'object'
}

function describeParameters(parameters: unknown): string[] {
  if (!Array.isArray(parameters)) {
    return []
  }
  const byLocation = new Map<string, string[]>()
  for (const raw of parameters) {
    const parameter = asObject(raw)
    if (!parameter) {
      continue
    }
    const name = asString(parameter['name'])
    if (!name) {
      continue
    }
    // A `$ref`'d parameter is not resolved — naming it is honest and costs one word.
    const location = asString(parameter['in']) || (asString(parameter['$ref']) ? 'ref' : 'param')
    const optional = parameter['required'] === true ? '' : '?'
    const type = 'schema' in parameter ? describeSchema(parameter['schema'], 1) : 'string'
    const bucket = byLocation.get(location)
    const rendered = `${name}${optional}: ${type}`
    if (bucket) {
      bucket.push(rendered)
    } else {
      byLocation.set(location, [rendered])
    }
  }
  return [...byLocation.entries()].map(([location, items]) => `${location} ${items.join(', ')}`)
}

function describeBody(operation: Json): string | null {
  const body = asObject(operation['requestBody'])
  if (!body) {
    return null
  }
  const ref = asString(body['$ref'])
  if (ref) {
    return `body ${refName(ref)}`
  }
  const content = asObject(body['content'])
  if (!content) {
    return 'body unknown'
  }
  const [mediaType, media] = Object.entries(content)[0] ?? []
  const shape = describeSchema(asObject(media)?.['schema'])
  const required = body['required'] === true ? '' : '?'
  return `body${required} ${mediaType === 'application/json' ? '' : `${mediaType ?? ''} `}${shape}`.replace(
    /\s+/g,
    ' '
  )
}

function describeResponses(operation: Json): string {
  const responses = asObject(operation['responses'])
  if (!responses) {
    return ''
  }
  const rendered = Object.entries(responses).map(([status, raw]) => {
    const response = asObject(raw)
    const content = asObject(response?.['content'])
    const media = content ? Object.values(content)[0] : undefined
    const schema = asObject(media)?.['schema']
    return schema === undefined ? status : `${status} ${describeSchema(schema)}`
  })
  return rendered.length > 0 ? `→ ${rendered.join(', ')}` : ''
}

/** JSON Pointer escaping, so `/refunds/{id}` survives as a citable source. */
function pointer(documentPath: string, path: string, method: string): string {
  return `${documentPath}#/paths/${path.replace(/~/g, '~0').replace(/\//g, '~1')}/${method}`
}

function operationEntry(
  documentPath: string,
  repo: string,
  path: string,
  method: string,
  operation: Json,
  sharedParameters: unknown
): ContractEntry {
  const parameters = describeParameters([
    ...(Array.isArray(sharedParameters) ? sharedParameters : []),
    ...(Array.isArray(operation['parameters']) ? operation['parameters'] : [])
  ])
  const body = describeBody(operation)
  const shape = [...parameters, ...(body ? [body] : []), describeResponses(operation)]
    .filter(Boolean)
    .join('; ')
  return {
    repo,
    kind: 'endpoint',
    name: `${method.toUpperCase()} ${path}`,
    shape: clampShape(shape || 'no parameters, no documented response'),
    provenance: 'extracted',
    source: pointer(documentPath, path, method),
    breaking: false
  }
}

const SCHEMA_REF_PREFIX = '#/components/schemas/'

/** Named schemas reachable from the operations; the catalogue at large is not the run's business. */
export const OPENAPI_SCHEMAS_MAX = 100

function collectSchemaRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSchemaRefs(item, into)
    }
    return
  }
  const node = asObject(value)
  if (!node) {
    return
  }
  const ref = asString(node['$ref'])
  if (ref.startsWith(SCHEMA_REF_PREFIX)) {
    into.add(refName(ref))
  }
  for (const child of Object.values(node)) {
    collectSchemaRefs(child, into)
  }
}

/**
 * One entry per named schema an operation actually mentions, followed transitively.
 *
 * Referenced-only, because a repo's component catalogue is usually far larger than the surface any
 * one run touches, and the registry's whole claim is that it is small.
 */
function referencedSchemaEntries(
  document: unknown,
  paths: Json,
  options: { documentPath: string; repo: string; maxSchemas: number }
): ContractEntry[] {
  const schemas = asObject(asObject(asObject(document)?.['components'])?.['schemas'])
  if (!schemas) {
    return []
  }
  const pending = new Set<string>()
  collectSchemaRefs(paths, pending)

  const entries: ContractEntry[] = []
  const seen = new Set<string>()
  while (pending.size > 0 && entries.length < options.maxSchemas) {
    const name = pending.values().next().value as string
    pending.delete(name)
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    const schema = schemas[name]
    if (schema === undefined) {
      continue
    }
    const nested = new Set<string>()
    collectSchemaRefs(schema, nested)
    for (const child of nested) {
      if (!seen.has(child)) {
        pending.add(child)
      }
    }
    entries.push({
      repo: options.repo,
      kind: 'schema',
      name,
      shape: clampShape(describeSchema(schema)),
      provenance: 'extracted',
      source: `${options.documentPath}#${SCHEMA_REF_PREFIX.slice(1)}${name}`,
      breaking: false
    })
  }
  return entries
}

export type OpenApiExtraction = {
  entries: ContractEntry[]
  /** Operations past `OPENAPI_OPERATIONS_MAX`; the caller says so rather than pretending. */
  omitted: number
}

/**
 * Turns a parsed OpenAPI document into registry entries.
 *
 * Takes the already-parsed value rather than text so JSON and YAML share one code path; the caller
 * owns the parse. A document with no `paths` yields nothing, which the scan turns into a gap.
 */
export function extractOpenApiContracts(
  document: unknown,
  options: {
    documentPath: string
    repo?: string
    maxOperations?: number
    maxSchemas?: number
  }
): OpenApiExtraction {
  const paths = asObject(asObject(document)?.['paths'])
  if (!paths) {
    return { entries: [], omitted: 0 }
  }
  const max = options.maxOperations ?? OPENAPI_OPERATIONS_MAX
  const entries: ContractEntry[] = []
  let omitted = 0

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = asObject(rawItem)
    if (!item) {
      continue
    }
    for (const method of HTTP_METHODS) {
      const operation = asObject(item[method])
      if (!operation) {
        continue
      }
      if (entries.length >= max) {
        omitted++
        continue
      }
      entries.push(
        operationEntry(
          options.documentPath,
          options.repo ?? '',
          path,
          method,
          operation,
          item['parameters']
        )
      )
    }
  }
  entries.push(
    ...referencedSchemaEntries(document, paths, {
      documentPath: options.documentPath,
      repo: options.repo ?? '',
      maxSchemas: options.maxSchemas ?? OPENAPI_SCHEMAS_MAX
    })
  )
  return { entries, omitted }
}
