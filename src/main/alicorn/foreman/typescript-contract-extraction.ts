import { clampShape, type ContractEntry } from './contract-registry'

/**
 * Extracts exported type declarations from a TypeScript source file.
 *
 * A bounded scanner, not a parser. Loading the TypeScript compiler into the Electron main process to
 * read a handful of `export interface` blocks costs more than the whole feature saves, and the
 * registry's success condition is "small and accurate for the common shape", not "handles every
 * dialect". What it does not understand it skips; it never invents an entry.
 *
 * Known and accepted blind spots: a declaration inside a block comment or a template literal is
 * still matched, and a brace inside a string literal inside a type is counted. Both are rare in the
 * shared-contract files this runs against, and both cost one imprecise entry rather than a wrong
 * one — the source column names the file and line, so a reader can check.
 */

const DECLARATION = /^export\s+(?:declare\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm

/** Past this a file is not a shared-contract file, it is a module; the caller records the omission. */
export const TYPESCRIPT_DECLARATIONS_MAX = 60

/** Guards against a generated `.d.ts` that is megabytes of one declaration per line. */
export const TYPESCRIPT_SOURCE_MAX_BYTES = 256 * 1024

/**
 * End of an `interface`/`enum` body: the matching close brace.
 *
 * Returns the source end index, or null when the braces never balance — a truncated file yields no
 * entry rather than one that runs to EOF.
 */
function endOfBracedBody(source: string, from: number): number | null {
  const open = source.indexOf('{', from)
  if (open === -1) {
    return null
  }
  let depth = 0
  for (let index = open; index < source.length; index++) {
    const character = source[index]
    if (character === '{') {
      depth++
    } else if (character === '}') {
      depth--
      if (depth === 0) {
        return index + 1
      }
    }
  }
  return null
}

// A line break inside an alias is a continuation when either side of it is an operator — which is
// how every formatter writes a union of more than three members, the shape most worth extracting.
const CONTINUES_BEFORE = new Set(['=', '|', '&', ',', '<', '(', '[', '{', ':', '?', 'extends'])
const CONTINUES_AFTER = new Set(['|', '&', ')', ']', '}', '>', '?', ':', '=', ','])

function continuesAcrossNewline(source: string, index: number): boolean {
  const before = source.slice(0, index).trimEnd()
  const last = before.at(-1) ?? ''
  const after = source.slice(index).trimStart()
  return (
    CONTINUES_BEFORE.has(last) || before.endsWith('extends') || CONTINUES_AFTER.has(after[0] ?? '')
  )
}

/**
 * End of a `type X = …` alias: the first `;` or terminating newline at bracket depth zero.
 *
 * Depth-aware so a multi-line object or generic is captured whole, and continuation-aware so a
 * union broken across lines is one entry rather than the word `type X =`. `=>` is not a closing
 * angle bracket, which is the one place naive depth counting reads a function type as unbalanced.
 */
function endOfAlias(source: string, from: number): number {
  let depth = 0
  for (let index = from; index < source.length; index++) {
    const character = source[index]!
    if ('{([<'.includes(character)) {
      depth++
    } else if ('})]'.includes(character)) {
      depth--
    } else if (character === '>') {
      if (source[index - 1] !== '=') {
        depth--
      }
    } else if (character === ';' && depth <= 0) {
      return index
    } else if (character === '\n' && depth <= 0 && !continuesAcrossNewline(source, index)) {
      return index
    }
  }
  return source.length
}

function lineOf(source: string, index: number): number {
  let line = 1
  for (let position = 0; position < index; position++) {
    if (source[position] === '\n') {
      line++
    }
  }
  return line
}

export type TypeScriptExtraction = {
  entries: ContractEntry[]
  /** Declarations past `TYPESCRIPT_DECLARATIONS_MAX`, or a file over the byte ceiling. */
  omitted: number
}

/**
 * Turns one TypeScript source into registry entries, one per exported type declaration.
 *
 * `sourcePath` is what the entry cites, so pass the path as a reader would type it — repo-relative,
 * not absolute.
 */
export function extractTypeScriptContracts(
  source: string,
  options: { sourcePath: string; repo?: string; maxDeclarations?: number }
): TypeScriptExtraction {
  if (source.length > TYPESCRIPT_SOURCE_MAX_BYTES) {
    return { entries: [], omitted: 1 }
  }
  const max = options.maxDeclarations ?? TYPESCRIPT_DECLARATIONS_MAX
  const entries: ContractEntry[] = []
  let omitted = 0

  DECLARATION.lastIndex = 0
  for (let match = DECLARATION.exec(source); match; match = DECLARATION.exec(source)) {
    const [, kind, name] = match
    if (entries.length >= max) {
      omitted++
      continue
    }
    const start = match.index
    const end =
      kind === 'type' ? endOfAlias(source, start) : endOfBracedBody(source, start + match[0].length)
    if (end === null) {
      continue
    }
    entries.push({
      repo: options.repo ?? '',
      kind: kind!,
      name: name!,
      shape: clampShape(source.slice(start, end).replace(/^export\s+(?:declare\s+)?/, '')),
      provenance: 'extracted',
      source: `${options.sourcePath}:${lineOf(source, start)}`,
      breaking: false
    })
    DECLARATION.lastIndex = Math.max(DECLARATION.lastIndex, end)
  }
  return { entries, omitted }
}
