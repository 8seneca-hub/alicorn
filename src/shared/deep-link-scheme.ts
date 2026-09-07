/**
 * Custom URL schemes Alicorn answers to.
 *
 * `alicorn://` is ours; `orca://` is the pre-rename scheme, still accepted
 * because links live in QR codes, chat history and installed mobile apps long
 * after a release. Parsers take both. Emitters are decided case by case — see
 * `pairing.ts` for the one that must still emit the legacy scheme.
 */
export const DEEP_LINK_SCHEME = 'alicorn'

/** Removed one release after the rebrand ships; see the rebrand plan, R2/R6. */
export const LEGACY_DEEP_LINK_SCHEME = 'orca'

const ACCEPTED_PROTOCOLS: readonly string[] = [
  `${DEEP_LINK_SCHEME}:`,
  `${LEGACY_DEEP_LINK_SCHEME}:`
]

/** @param protocol a `URL.protocol`, i.e. including the trailing colon. */
export function isAcceptedDeepLinkProtocol(protocol: string): boolean {
  return ACCEPTED_PROTOCOLS.includes(protocol.toLowerCase())
}

/** True when `value` starts with a scheme we answer to, before it is parsed as a URL. */
export function hasAcceptedDeepLinkPrefix(value: string): boolean {
  const lowered = value.toLowerCase()
  return ACCEPTED_PROTOCOLS.some((protocol) => lowered.startsWith(`${protocol}//`))
}
