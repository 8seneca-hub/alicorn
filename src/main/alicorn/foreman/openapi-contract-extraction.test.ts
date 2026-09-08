import { describe, expect, it } from 'vitest'
import { CONTRACT_ENTRY_MAX_CHARS } from './contract-registry'
import { describeSchema, extractOpenApiContracts } from './openapi-contract-extraction'

const REFUNDS = {
  openapi: '3.1.0',
  paths: {
    '/refunds/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        parameters: [{ name: 'expand', in: 'query', schema: { type: 'boolean' } }],
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Refund' } } }
          },
          '404': {}
        }
      }
    },
    '/refunds/partial': {
      post: {
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PartialRefundRequest' } }
          }
        },
        responses: {
          '201': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Refund' } } }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      Refund: {
        type: 'object',
        required: ['id', 'amount'],
        properties: {
          id: { type: 'string' },
          amount: { type: 'integer' },
          state: { $ref: '#/components/schemas/RefundState' }
        }
      },
      RefundState: { type: 'string', enum: ['pending', 'settled'] },
      PartialRefundRequest: {
        type: 'object',
        required: ['amount'],
        properties: { amount: { type: 'integer' }, reason: { type: 'string' } }
      },
      // Never referenced from a path; the run's registry has no business carrying it.
      InternalAuditRow: { type: 'object', properties: { at: { type: 'string' } } }
    }
  }
}

function extract() {
  return extractOpenApiContracts(REFUNDS, { documentPath: 'openapi.yaml', repo: 'api' })
}

describe('extractOpenApiContracts', () => {
  it('makes one entry per operation, named the way a worker would cite it', () => {
    const names = extract()
      .entries.filter((entry) => entry.kind === 'endpoint')
      .map((entry) => entry.name)
    expect(names).toEqual(['GET /refunds/{id}', 'POST /refunds/partial'])
  })

  it('folds path-level and operation-level parameters into one shape', () => {
    const get = extract().entries.find((entry) => entry.name === 'GET /refunds/{id}')
    expect(get?.shape).toBe('path id: string; query expand?: boolean; → 200 Refund, 404')
  })

  it('names the request body by its schema rather than inlining it', () => {
    const post = extract().entries.find((entry) => entry.name === 'POST /refunds/partial')
    expect(post?.shape).toBe('body PartialRefundRequest; → 201 Refund')
  })

  it('cites a JSON Pointer a reader can follow back into the document', () => {
    const post = extract().entries.find((entry) => entry.name === 'POST /refunds/partial')
    expect(post?.source).toBe('openapi.yaml#/paths/~1refunds~1partial/post')
    expect(post?.provenance).toBe('extracted')
  })

  // The registry's claim is that it is small: the catalogue at large is not the run's business.
  it('extracts referenced schemas transitively and leaves unreferenced ones out', () => {
    const schemas = extract()
      .entries.filter((entry) => entry.kind === 'schema')
      .map((entry) => entry.name)
      .sort()
    expect(schemas).toEqual(['PartialRefundRequest', 'Refund', 'RefundState'])
  })

  it('describes a referenced schema as fields, marking the optional ones', () => {
    const refund = extract().entries.find((entry) => entry.name === 'Refund')
    expect(refund?.shape).toBe('{id: string, amount: integer, state?: RefundState}')
  })

  it('keeps every entry inside the per-entry token ceiling', () => {
    for (const entry of extract().entries) {
      expect(entry.shape.length).toBeLessThanOrEqual(CONTRACT_ENTRY_MAX_CHARS)
    }
  })

  it('stops at the operation ceiling and says how many it left out', () => {
    const extracted = extractOpenApiContracts(REFUNDS, {
      documentPath: 'openapi.yaml',
      maxOperations: 1
    })
    expect(extracted.entries.filter((entry) => entry.kind === 'endpoint')).toHaveLength(1)
    expect(extracted.omitted).toBe(1)
  })

  // A dialect it cannot read costs one imprecise entry, never a crash.
  it('yields nothing for a document with no paths', () => {
    expect(extractOpenApiContracts({ openapi: '3.1.0' }, { documentPath: 'openapi.yaml' })).toEqual(
      {
        entries: [],
        omitted: 0
      }
    )
    expect(extractOpenApiContracts(null, { documentPath: 'x.yaml' }).entries).toEqual([])
    expect(extractOpenApiContracts('not a document', { documentPath: 'x.yaml' }).entries).toEqual(
      []
    )
  })
})

describe('describeSchema', () => {
  it('names a $ref rather than resolving it', () => {
    expect(describeSchema({ $ref: '#/components/schemas/Refund' })).toBe('Refund')
  })

  it('renders an enum as a union', () => {
    expect(describeSchema({ enum: ['a', 'b'] })).toBe('"a" | "b"')
  })

  it('renders arrays and composition', () => {
    expect(describeSchema({ type: 'array', items: { type: 'string' } })).toBe('string[]')
    expect(describeSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toBe(
      'string | number'
    )
  })

  it('stops describing an inline object past the depth limit', () => {
    const deep = {
      type: 'object',
      properties: {
        a: { type: 'object', properties: { b: { type: 'object', properties: { c: {} } } } }
      }
    }
    expect(describeSchema(deep)).toBe('{a?: {b?: object}}')
  })

  it('summarises rather than transcribes a wide object', () => {
    const wide = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [`f${index}`, { type: 'string' }])
      )
    }
    expect(describeSchema(wide)).toContain('+8 more')
  })

  it('says unknown rather than guessing', () => {
    expect(describeSchema(undefined)).toBe('unknown')
  })
})
