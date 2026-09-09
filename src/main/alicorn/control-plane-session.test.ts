import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFreshOrcaCloudSession } from '../orca-profiles/profile-cloud-session-refresh'
import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import {
  isAlicornBearerConfigured,
  readAlicornBearer,
  resolveAlicornAuthMode
} from './control-plane-session'

vi.mock('../orca-profiles/profile-index-store', () => ({
  ensureActiveOrcaProfile: vi.fn()
}))
vi.mock('../orca-profiles/profile-cloud-session-refresh', () => ({
  readFreshOrcaCloudSession: vi.fn()
}))
vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: vi.fn()
}))

const TOKEN = 'local-dev-token-0123456789'
const SESSION_TOKEN = 'keycloak-access-token-abcdef'
const USER_DATA = '/tmp/alicorn-profile'

// The keycloak block a dev sources from cloud/dev/compose/desktop.keycloak.env.example.
const KEYCLOAK_ENV: NodeJS.ProcessEnv = {
  ALICORN_AUTH_MODE: 'keycloak',
  ALICORN_CLOUD_API_URL: 'http://127.0.0.1:8081',
  ALICORN_CLOUD_CLIENT_ID: 'alicorn-desktop'
}

type ActiveProfile = ReturnType<typeof ensureActiveOrcaProfile>
type FreshSession = Awaited<ReturnType<typeof readFreshOrcaCloudSession>>

function profile(orgId: string | undefined, id = 'profile-1'): ActiveProfile {
  return {
    profile: { id, cloud: orgId === undefined ? undefined : { activeOrgId: orgId } }
  } as unknown as ActiveProfile
}

function signedInAs(orgId: string, id = 'profile-1'): void {
  vi.mocked(ensureActiveOrcaProfile).mockReturnValue(profile(orgId, id))
  vi.mocked(readFreshOrcaCloudSession).mockResolvedValue({
    status: 'found',
    session: { accessToken: SESSION_TOKEN }
  } as unknown as FreshSession)
}

beforeEach(() => {
  vi.mocked(ensureActiveOrcaProfile).mockReset()
  vi.mocked(readFreshOrcaCloudSession).mockReset()
  vi.mocked(getProfileUserDataPath).mockReset().mockReturnValue(USER_DATA)
})

describe('resolveAlicornAuthMode', () => {
  it('honours an explicit mode over whatever credentials happen to be around', () => {
    expect(resolveAlicornAuthMode({ ALICORN_AUTH_MODE: 'keycloak' })).toBe('keycloak')
    expect(
      resolveAlicornAuthMode({ ALICORN_AUTH_MODE: 'keycloak', ALICORN_LOCAL_API_TOKEN: TOKEN })
    ).toBe('keycloak')
    expect(resolveAlicornAuthMode({ ALICORN_AUTH_MODE: ' local ' })).toBe('local')
  })

  it('falls back to the shared token, so tier-1 setups keep working undeclared', () => {
    expect(resolveAlicornAuthMode({ ALICORN_LOCAL_API_TOKEN: TOKEN })).toBe('local')
    expect(resolveAlicornAuthMode({})).toBe('keycloak')
    // An unrecognised value is not a third mode; it is a typo, and the token still decides.
    expect(
      resolveAlicornAuthMode({ ALICORN_AUTH_MODE: 'kc', ALICORN_LOCAL_API_TOKEN: TOKEN })
    ).toBe('local')
  })
})

describe('readAlicornBearer — local mode', () => {
  it('reads the token and tenant from the environment', async () => {
    await expect(
      readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: TOKEN, ALICORN_TENANT_ID: 'tenant-1' })
    ).resolves.toEqual({ accessToken: TOKEN, orgId: 'tenant-1' })
  })

  it('defaults the org to local when no tenant is set', async () => {
    expect((await readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: TOKEN }))?.orgId).toBe('local')
    expect(
      (await readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: TOKEN, ALICORN_TENANT_ID: '  ' }))?.orgId
    ).toBe('local')
  })

  it('rejects a token too short to be a real credential', async () => {
    // A 5-char value is a placeholder or a truncated paste; failing here reads
    // as "not configured" instead of an unexplained 401 later.
    await expect(readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: 'short' })).resolves.toBeNull()
  })

  it('returns null when the token is missing or blank', async () => {
    await expect(readAlicornBearer({})).resolves.toBeNull()
    await expect(readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: '   ' })).resolves.toBeNull()
  })

  it('trims the token so a copied newline does not reach the header', async () => {
    expect(
      (await readAlicornBearer({ ALICORN_LOCAL_API_TOKEN: `  ${TOKEN}\n` }))?.accessToken
    ).toBe(TOKEN)
  })

  it('never reaches for a signed-in session', async () => {
    await readAlicornBearer({ ALICORN_AUTH_MODE: 'local', ALICORN_LOCAL_API_TOKEN: TOKEN })
    await readAlicornBearer({ ALICORN_AUTH_MODE: 'local' })
    expect(ensureActiveOrcaProfile).not.toHaveBeenCalled()
    expect(readFreshOrcaCloudSession).not.toHaveBeenCalled()
  })
})

describe('readAlicornBearer — keycloak mode', () => {
  it('presents the session token and the profile org', async () => {
    signedInAs('org-1')

    await expect(readAlicornBearer(KEYCLOAK_ENV, USER_DATA)).resolves.toEqual({
      accessToken: SESSION_TOKEN,
      orgId: 'org-1'
    })
  })

  it('takes the org from the session, not from ALICORN_TENANT_ID', async () => {
    // The disagreement the control plane answers with 403: an env-named org the token cannot
    // prove. It must never reach the header, whatever the local-mode block left in the shell.
    signedInAs('org-1')

    await expect(
      readAlicornBearer({ ...KEYCLOAK_ENV, ALICORN_TENANT_ID: 'other-org' }, USER_DATA)
    ).resolves.toEqual({ accessToken: SESSION_TOKEN, orgId: 'org-1' })
  })

  it('does not fall back to the shared token when the session is missing', async () => {
    vi.mocked(ensureActiveOrcaProfile).mockReturnValue(profile('org-1'))
    vi.mocked(readFreshOrcaCloudSession).mockResolvedValue({
      status: 'reconnect-required'
    } as unknown as FreshSession)

    await expect(
      readAlicornBearer({ ...KEYCLOAK_ENV, ALICORN_LOCAL_API_TOKEN: TOKEN }, USER_DATA)
    ).resolves.toBeNull()
  })

  it('returns null when the profile is not linked to a cloud org', async () => {
    vi.mocked(ensureActiveOrcaProfile).mockReturnValue(profile(undefined))

    await expect(readAlicornBearer(KEYCLOAK_ENV, USER_DATA)).resolves.toBeNull()
    expect(readFreshOrcaCloudSession).not.toHaveBeenCalled()
  })

  it('returns null when the org changed under the refresh', async () => {
    // A token minted for org-2 alongside a header naming org-1 is the exact mismatch the
    // server rejects; refusing here is what stops the desktop from asking for it.
    signedInAs('org-1')
    vi.mocked(ensureActiveOrcaProfile)
      .mockReturnValueOnce(profile('org-1'))
      .mockReturnValueOnce(profile('org-2'))

    await expect(readAlicornBearer(KEYCLOAK_ENV, USER_DATA)).resolves.toBeNull()
  })

  it('returns null when the active profile changed under the refresh', async () => {
    signedInAs('org-1')
    vi.mocked(ensureActiveOrcaProfile)
      .mockReturnValueOnce(profile('org-1', 'profile-1'))
      .mockReturnValueOnce(profile('org-1', 'profile-2'))

    await expect(readAlicornBearer(KEYCLOAK_ENV, USER_DATA)).resolves.toBeNull()
  })

  it('returns null without touching the profile store when sign-in is unconfigured', async () => {
    await expect(readAlicornBearer({ ALICORN_AUTH_MODE: 'keycloak' })).resolves.toBeNull()
    expect(ensureActiveOrcaProfile).not.toHaveBeenCalled()
    expect(getProfileUserDataPath).not.toHaveBeenCalled()
  })

  it('resolves the profile path itself when the caller supplies none', async () => {
    signedInAs('org-1')

    await readAlicornBearer(KEYCLOAK_ENV)

    expect(getProfileUserDataPath).toHaveBeenCalled()
    expect(ensureActiveOrcaProfile).toHaveBeenCalledWith(USER_DATA)
    expect(readFreshOrcaCloudSession).toHaveBeenCalledWith(
      expect.objectContaining({ apiBaseUrl: 'http://127.0.0.1:8081' }),
      expect.anything(),
      USER_DATA
    )
  })
})

describe('isAlicornBearerConfigured', () => {
  it('answers the build-level question in each mode', () => {
    expect(isAlicornBearerConfigured({ ALICORN_LOCAL_API_TOKEN: TOKEN })).toBe(true)
    expect(isAlicornBearerConfigured({ ALICORN_LOCAL_API_TOKEN: 'short' })).toBe(false)
    expect(isAlicornBearerConfigured(KEYCLOAK_ENV)).toBe(true)
    expect(isAlicornBearerConfigured({ ALICORN_AUTH_MODE: 'keycloak' })).toBe(false)
  })

  it('does not read the session store — startup cannot afford the I/O', () => {
    isAlicornBearerConfigured(KEYCLOAK_ENV)
    expect(ensureActiveOrcaProfile).not.toHaveBeenCalled()
    expect(readFreshOrcaCloudSession).not.toHaveBeenCalled()
  })
})
