/**
 * RFC 8785 (JCS) canonical JSON. A signature is only useful if the bytes it covers can be
 * reproduced: an auditor who parses an export, stores it, and serialises it again must land on the
 * same bytes, or verification fails on a round-trip that changed nothing.
 *
 * The two rules that do the work: object keys are sorted by UTF-16 code unit, and there is no
 * insignificant whitespace. Numbers and string escapes are left to `JSON.stringify`, whose output
 * is ECMAScript `Number::toString` and RFC 8785's escape set already.
 */
export function canonicalJsonStringify(value: unknown): string {
  return serialize(value, [])
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJsonStringify(value))
}

function path(trail: readonly string[]): string {
  return trail.length === 0 ? '<root>' : trail.join('.')
}

function serialize(value: unknown, trail: readonly string[]): string {
  if (value === null) {
    return 'null'
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      // Why throw rather than emit `null` the way JSON.stringify does: a NaN silently becoming null
      // would be signed as a real value, and the reader could never tell.
      if (!Number.isFinite(value)) {
        throw new Error(`canonical json: non-finite number at ${path(trail)}`)
      }
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      throw new Error(`canonical json: unserialisable ${typeof value} at ${path(trail)}`)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => serializeArrayEntry(entry, [...trail, String(index)])).join(',')}]`
  }
  if (value instanceof Date) {
    throw new Error(`canonical json: Date at ${path(trail)} — format it as a string first`)
  }
  const record = value as Record<string, unknown>
  const members: string[] = []
  // Sort by UTF-16 code unit, which is what a plain `<` comparison on JS strings already does.
  for (const key of Object.keys(record).sort()) {
    const entry = record[key]
    if (entry === undefined) {
      continue
    }
    members.push(`${JSON.stringify(key)}:${serialize(entry, [...trail, key])}`)
  }
  return `{${members.join(',')}}`
}

/** A hole or an `undefined` in an array is `null` in JSON — there is no key to drop. */
function serializeArrayEntry(entry: unknown, trail: readonly string[]): string {
  return entry === undefined ? 'null' : serialize(entry, trail)
}
