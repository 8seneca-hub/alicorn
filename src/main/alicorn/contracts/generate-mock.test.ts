import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateMock } from './generate-mock'
import { findOpenApiMockTarget } from './openapi-mock-lookup'
import { mockContractFromWorktree } from './mock-from-worktree'

describe('generateMock', () => {
  it('gives one example value per property, typed by the schema', () => {
    expect(
      generateMock({
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          amount: { type: 'integer', minimum: 5 },
          rate: { type: 'number' },
          settled: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          state: { enum: ['charged', 'refunded'] }
        }
      })
    ).toEqual({
      id: '00000000-0000-4000-8000-000000000000',
      amount: 5,
      rate: 1.5,
      settled: true,
      tags: ['string'],
      state: 'charged'
    })
  })

  it('prefers an authored example, then a default', () => {
    expect(generateMock({ type: 'string', example: 'ref_1' })).toBe('ref_1')
    expect(generateMock({ type: 'integer', default: 42 })).toBe(42)
  })

  it('is deterministic across calls', () => {
    const schema = { type: 'object', properties: { at: { type: 'string', format: 'date-time' } } }
    expect(generateMock(schema)).toEqual(generateMock(schema))
  })

  it('follows a $ref into the document it was given', () => {
    const root = {
      components: {
        schemas: { Money: { type: 'object', properties: { cents: { type: 'integer' } } } }
      }
    }
    expect(generateMock({ $ref: '#/components/schemas/Money' }, { root })).toEqual({ cents: 1 })
  })

  it('yields null for a $ref it cannot resolve rather than inventing a shape', () => {
    expect(generateMock({ $ref: '#/components/schemas/Missing' })).toBeNull()
  })

  it('terminates on a self-referential schema', () => {
    const root = {
      components: {
        schemas: {
          Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } }
        }
      }
    }
    expect(() => generateMock({ $ref: '#/components/schemas/Node' }, { root })).not.toThrow()
  })

  it('merges allOf and takes the first branch of oneOf', () => {
    expect(
      generateMock({
        allOf: [
          { type: 'object', properties: { a: { type: 'integer' } } },
          { type: 'object', properties: { b: { type: 'boolean' } } }
        ]
      })
    ).toEqual({ a: 1, b: true })
    expect(generateMock({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('string')
  })
})

const DOCUMENT = {
  openapi: '3.0.0',
  paths: {
    '/refunds/{id}': {
      get: {
        responses: {
          '404': { description: 'gone' },
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Refund' } }
            }
          }
        }
      },
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { note: { type: 'string' } } }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      Refund: { type: 'object', properties: { id: { type: 'string' }, cents: { type: 'integer' } } }
    }
  }
}

describe('findOpenApiMockTarget', () => {
  it('finds a component schema by name', () => {
    expect(findOpenApiMockTarget(DOCUMENT, 'Refund')?.source).toBe('components/schemas/Refund')
  })

  it('prefers the 2xx response of an operation over an earlier error response', () => {
    const target = findOpenApiMockTarget(DOCUMENT, 'GET /refunds/{id}')
    expect(target?.source).toBe('paths//refunds/{id}/get/200')
  })

  it('falls back to the request body when nothing is documented as a response', () => {
    expect(findOpenApiMockTarget(DOCUMENT, 'post /refunds/{id}')?.source).toBe(
      'paths//refunds/{id}/post/requestBody'
    )
  })

  it('returns null for a name that is neither a schema nor an operation', () => {
    expect(findOpenApiMockTarget(DOCUMENT, 'Nope')).toBeNull()
    expect(findOpenApiMockTarget(DOCUMENT, 'GET /nope')).toBeNull()
  })
})

describe('mockContractFromWorktree', () => {
  it('mocks an endpoint from the worktree’s own OpenAPI document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alicorn-mock-'))
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'openapi.json'), JSON.stringify(DOCUMENT), 'utf8')

    const mock = await mockContractFromWorktree(root, 'GET /refunds/{id}')
    expect(mock).toEqual({
      document: 'docs/openapi.json',
      source: 'paths//refunds/{id}/get/200',
      value: { id: 'string', cents: 1 }
    })
  })

  it('returns null when no document names the contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alicorn-mock-'))
    expect(await mockContractFromWorktree(root, 'Refund')).toBeNull()
  })
})
