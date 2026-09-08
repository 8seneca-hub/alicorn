import { z } from 'zod'

// Why: the desktop is a public PKCE client, so the code exchange and every refresh happen
// server-to-server from here. Nothing in this file may log a token or a form body.

export type KeycloakTokens = {
  accessToken: string
  refreshToken: string
  idToken?: string
  expiresIn: number
}

export class KeycloakTokenError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string
  ) {
    super(`keycloak_token_${errorCode}`)
    this.name = 'KeycloakTokenError'
  }
}

export type KeycloakTokenClient = {
  exchangeCode(args: { code: string; codeVerifier: string; redirectUri: string }): Promise<KeycloakTokens>
  refresh(args: { refreshToken: string }): Promise<KeycloakTokens>
  logout(args: { refreshToken: string }): Promise<void>
}

const TOKEN_TIMEOUT_MS = 15_000

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive()
})

const ErrorBodySchema = z.object({ error: z.string().min(1) })

export function createKeycloakTokenClient(input: {
  issuer: string
  clientId: string
  fetch?: typeof fetch
}): KeycloakTokenClient {
  const doFetch = input.fetch ?? fetch
  const tokenUrl = `${input.issuer}/protocol/openid-connect/token`
  const logoutUrl = `${input.issuer}/protocol/openid-connect/logout`

  async function post(url: string, form: Record<string, string>): Promise<Response> {
    return doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      // Why: following a redirect would re-send the code verifier or a refresh token to another origin.
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    })
  }

  async function grant(form: Record<string, string>): Promise<KeycloakTokens> {
    const response = await post(tokenUrl, form)
    if (!response.ok) {
      throw new KeycloakTokenError(response.status, await readErrorCode(response))
    }
    const parsed = TokenResponseSchema.safeParse(await readJson(response))
    if (!parsed.success) {
      throw new KeycloakTokenError(response.status, 'malformed_token_response')
    }
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      idToken: parsed.data.id_token,
      expiresIn: parsed.data.expires_in
    }
  }

  return {
    exchangeCode: (args) =>
      grant({
        grant_type: 'authorization_code',
        client_id: input.clientId,
        code: args.code,
        redirect_uri: args.redirectUri,
        code_verifier: args.codeVerifier
      }),
    refresh: (args) =>
      grant({
        grant_type: 'refresh_token',
        client_id: input.clientId,
        refresh_token: args.refreshToken
      }),
    async logout(args) {
      // Why: a sign-out the IdP rejects must not keep the desktop signed in locally, so the
      // caller treats logout as best effort; a transport failure is the one thing worth raising.
      const response = await post(logoutUrl, {
        client_id: input.clientId,
        refresh_token: args.refreshToken
      })
      response.body?.cancel().catch(() => undefined)
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function readErrorCode(response: Response): Promise<string> {
  const parsed = ErrorBodySchema.safeParse(await readJson(response))
  // Why: Keycloak's `error_description` can quote the submitted code; only the stable code travels.
  return parsed.success ? parsed.data.error : 'token_request_failed'
}
