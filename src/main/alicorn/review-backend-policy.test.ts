import { describe, expect, it } from 'vitest'
import { evaluateReviewBackend } from './review-backend-policy'

const authors = (...backends: string[]): ReadonlySet<string> => new Set(backends)

describe('evaluateReviewBackend', () => {
  it('allows a reviewer on a backend that authored nothing', () => {
    expect(
      evaluateReviewBackend({
        reviewerBackend: 'codex',
        authorBackends: authors('claude'),
        enforce: true,
        bypassRequested: false
      })
    ).toEqual({ allowed: true, bypassed: false })
  })

  it('refuses a reviewer on the author backend when enforcing', () => {
    const verdict = evaluateReviewBackend({
      reviewerBackend: 'codex',
      authorBackends: authors('codex'),
      enforce: true,
      bypassRequested: false
    })

    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toContain('--allow-same-backend-review')
    expect(verdict.allowed === false && verdict.reason).toContain('"codex"')
  })

  it('allows an explicit bypass and records it', () => {
    expect(
      evaluateReviewBackend({
        reviewerBackend: 'codex',
        authorBackends: authors('codex'),
        enforce: true,
        bypassRequested: true
      })
    ).toEqual({ allowed: true, bypassed: true })
  })

  it('still records a bypass when the policy is off', () => {
    // Policy off is not the same as no conflict: the run report has to say the
    // reviewer ran on the author's backend, or accept rate drifts up while
    // quality drifts down.
    expect(
      evaluateReviewBackend({
        reviewerBackend: 'codex',
        authorBackends: authors('codex'),
        enforce: false,
        bypassRequested: false
      })
    ).toEqual({ allowed: true, bypassed: true })
  })

  it('reports no bypass when the policy is off and there is no conflict', () => {
    expect(
      evaluateReviewBackend({
        reviewerBackend: 'grok',
        authorBackends: authors('claude', 'codex'),
        enforce: false,
        bypassRequested: false
      })
    ).toEqual({ allowed: true, bypassed: false })
  })

  it('allows a reviewer when nothing has authored yet', () => {
    expect(
      evaluateReviewBackend({
        reviewerBackend: 'claude',
        authorBackends: authors(),
        enforce: true,
        bypassRequested: false
      })
    ).toEqual({ allowed: true, bypassed: false })
  })
})
