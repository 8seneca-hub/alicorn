export type AlicornControlPlaneUrls = {
  controlApiUrl: string
  ledgerApiUrl: string
}

function normalizeUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }
  return trimmed.replace(/\/+$/, '')
}

// Why a function and not two constants: the base URLs are read per call, so a
// dev can repoint the desktop at another stack without a rebuild.
export function getAlicornControlPlaneUrls(env: NodeJS.ProcessEnv): AlicornControlPlaneUrls | null {
  const controlApiUrl = normalizeUrl(env.ALICORN_CONTROL_API_URL)
  if (!controlApiUrl) {
    return null
  }
  // The two services share a host in the local stack, so the ledger URL is
  // optional and falls back rather than forcing both to be set.
  const ledgerApiUrl = normalizeUrl(env.ALICORN_LEDGER_API_URL) ?? controlApiUrl
  return { controlApiUrl, ledgerApiUrl }
}
