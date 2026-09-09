import { describe, expect, it } from 'vitest'
import { MemberInputSchema } from './member.js'
import { MemberSkillRefInputSchema, SkillInputSchema, SkillVersionInputSchema } from './skill.js'
import { RequiredChecksSchema } from './required-check.js'

describe('member skill refs', () => {
  it('normalises a bare string to follow-latest — the pre-catalog shape still parses', () => {
    expect(MemberSkillRefInputSchema.parse('threat-model')).toEqual({ name: 'threat-model', versionId: null })
    expect(MemberSkillRefInputSchema.parse({ name: 'threat-model' })).toEqual({
      name: 'threat-model',
      versionId: null
    })
    expect(MemberSkillRefInputSchema.parse({ name: 'threat-model', versionId: 'v3' })).toEqual({
      name: 'threat-model',
      versionId: 'v3'
    })
  })

  it('rejects two pins of the same skill on one member, whichever shape they arrive in', () => {
    const member = {
      name: 'm',
      role: 'reviewer',
      backend: 'codex',
      workspaceKind: 'worktree',
      permissionMode: 'ask'
    }
    expect(MemberInputSchema.safeParse({ ...member, skills: ['a', { name: 'a', versionId: 'v1' }] }).success).toBe(
      false
    )
    expect(MemberInputSchema.safeParse({ ...member, skills: ['a', 'b'] }).success).toBe(true)
  })
})

describe('skill input', () => {
  it('pairs scope with projectId in both directions', () => {
    expect(SkillInputSchema.safeParse({ name: 'a' }).success).toBe(true)
    expect(SkillInputSchema.safeParse({ scope: 'project', projectId: 'r', name: 'a' }).success).toBe(true)
    expect(SkillInputSchema.safeParse({ scope: 'project', name: 'a' }).success).toBe(false)
    expect(SkillInputSchema.safeParse({ scope: 'org', projectId: 'r', name: 'a' }).success).toBe(false)
  })

  it('requires a name, and a sha256 digest on a published version', () => {
    expect(SkillInputSchema.safeParse({ name: '  ' }).success).toBe(false)
    expect(SkillVersionInputSchema.safeParse({ versionId: 'v1', digest: 'short' }).success).toBe(false)
    expect(SkillVersionInputSchema.parse({ versionId: 'v1', digest: 'a'.repeat(64) }).manifest).toEqual({})
  })
})

describe('required checks', () => {
  it('accepts a skill check alongside the existing kinds, and rejects an unknown one', () => {
    expect(
      RequiredChecksSchema.parse([
        { kind: 'skill', skillId: 'skl_1' },
        { kind: 'contract_acknowledged' }
      ])
    ).toEqual([{ kind: 'skill', skillId: 'skl_1' }, { kind: 'contract_acknowledged' }])
    expect(RequiredChecksSchema.safeParse([{ kind: 'skill' }]).success).toBe(false)
    expect(RequiredChecksSchema.safeParse([{ kind: 'vibes' }]).success).toBe(false)
  })
})
