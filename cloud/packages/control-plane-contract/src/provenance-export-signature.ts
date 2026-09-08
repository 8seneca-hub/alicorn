import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject
} from 'node:crypto'
import { canonicalJsonBytes, canonicalJsonStringify } from './canonical-json.js'

/**
 * What the signature covers, exactly: the RFC 8785 canonical bytes of the whole export document —
 * every step, every gate decision, every agreement, the rendered Markdown, the tenant and the
 * server-clock export timestamp. Not a summary, not a digest of a subset. Change one byte anywhere
 * in the document and the canonical bytes change, so the signature no longer verifies.
 *
 * The wire shape is a JWS (RFC 7515) with a detached payload: `protected` and `signature` are
 * base64url exactly as JWS defines them, and the signed input is `protected + '.' +
 * base64url(canonical(document))`. `provenanceExportCompactJws` re-attaches the payload so a
 * Markdown export can stand alone as a single verifiable string.
 *
 * ES256 (ECDSA P-256 + SHA-256) because that is what the estate already verifies — the relay's
 * token verifier is `algorithms: ['ES256']` against a JWKS — so an auditor's verifier and I5's
 * relay tokens use one algorithm and one key format.
 */
export const PROVENANCE_EXPORT_JWS_TYPE = 'application/alicorn-provenance-export+json'
export const PROVENANCE_EXPORT_ALGORITHM = 'ES256'

export type ProvenanceExportSignature = {
  algorithm: typeof PROVENANCE_EXPORT_ALGORITHM
  /** RFC 7638 JWK thumbprint of the signing key unless the operator pinned one. */
  keyId: string
  /** base64url JWS protected header. Signed, so it cannot be edited after the fact. */
  protected: string
  /** base64url ECDSA signature, raw `r || s` (64 bytes) as JWS requires — not DER. */
  signature: string
  /** base64url SHA-256 of the canonical payload. A convenience for logs; never trusted on verify. */
  payloadSha256: string
}

export type ProvenanceExportSigningKey = {
  keyId: string
  privateKey: KeyObject
  publicJwk: ProvenanceExportPublicJwk
}

export type ProvenanceExportPublicJwk = {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
  kid: string
  alg: typeof PROVENANCE_EXPORT_ALGORITHM
  use: 'sig'
}

export type ProvenanceExportVerificationKey = { keyId: string; publicKey: KeyObject }

export type ProvenanceExportVerification =
  | { ok: true; keyId: string }
  | { ok: false; reason: ProvenanceExportVerificationFailure }

export type ProvenanceExportVerificationFailure =
  | 'malformed_signature'
  | 'unsupported_algorithm'
  | 'unknown_key'
  | 'bad_signature'

function base64url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes as never).toString('base64url')
}

/**
 * Loads the signing key from a PEM. Never logs, never returns, and never stringifies the private
 * half — the only thing that leaves here is the public JWK and the key id.
 */
export function readProvenanceExportSigningKey(
  pem: string,
  options: { keyId?: string } = {}
): ProvenanceExportSigningKey {
  const privateKey = createPrivateKey(pem)
  if (privateKey.asymmetricKeyType !== 'ec') {
    throw new Error('provenance export signing key: expected an EC private key')
  }
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as {
    kty?: string
    crv?: string
    x?: string
    y?: string
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('provenance export signing key: ES256 requires curve P-256')
  }
  const keyId = options.keyId ?? jwkThumbprint({ crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y })
  return {
    keyId,
    privateKey,
    publicJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: jwk.x,
      y: jwk.y,
      kid: keyId,
      alg: PROVENANCE_EXPORT_ALGORITHM,
      use: 'sig'
    }
  }
}

/** RFC 7638. Deterministic, so an operator who rotates the PEM does not have to invent a key id. */
export function jwkThumbprint(jwk: { crv: string; kty: string; x: string; y: string }): string {
  const required = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
  return base64url(createHash('sha256').update(canonicalJsonStringify(required)).digest())
}

export function provenanceExportJwks(keys: readonly ProvenanceExportSigningKey[]): {
  keys: ProvenanceExportPublicJwk[]
} {
  return { keys: keys.map((key) => key.publicJwk) }
}

export function verificationKeyFromJwk(jwk: ProvenanceExportPublicJwk): ProvenanceExportVerificationKey {
  return {
    keyId: jwk.kid,
    publicKey: createPublicKey({ key: jwk as never, format: 'jwk' })
  }
}

function protectedHeader(keyId: string): string {
  return base64url(
    canonicalJsonStringify({
      alg: PROVENANCE_EXPORT_ALGORITHM,
      kid: keyId,
      typ: PROVENANCE_EXPORT_JWS_TYPE
    })
  )
}

function signingInput(protectedB64: string, payloadB64: string): Buffer {
  return Buffer.from(`${protectedB64}.${payloadB64}`, 'ascii')
}

export function signProvenanceExport(
  document: unknown,
  key: ProvenanceExportSigningKey
): ProvenanceExportSignature {
  const payload = canonicalJsonBytes(document)
  const payloadB64 = base64url(payload)
  const protectedB64 = protectedHeader(key.keyId)
  const signature = cryptoSign('sha256', signingInput(protectedB64, payloadB64), {
    key: key.privateKey,
    dsaEncoding: 'ieee-p1363'
  })
  return {
    algorithm: PROVENANCE_EXPORT_ALGORITHM,
    keyId: key.keyId,
    protected: protectedB64,
    signature: base64url(signature),
    payloadSha256: base64url(createHash('sha256').update(payload).digest())
  }
}

/**
 * Verifies a document against a detached signature. The document is re-canonicalised here rather
 * than trusted as received, which is the property that makes a round-trip through a store, a
 * pretty-printer or a different key order verify unchanged.
 */
export function verifyProvenanceExport(
  document: unknown,
  signature: ProvenanceExportSignature,
  keys: readonly ProvenanceExportVerificationKey[]
): ProvenanceExportVerification {
  if (signature.algorithm !== PROVENANCE_EXPORT_ALGORITHM) {
    return { ok: false, reason: 'unsupported_algorithm' }
  }
  const header = decodeProtectedHeader(signature.protected)
  // Why check the header too: it is inside the signed input, so a mismatch means either tampering
  // or a producer bug, and "alg" is the field an attacker would most like to talk us out of.
  if (!header || header.alg !== PROVENANCE_EXPORT_ALGORITHM || header.kid !== signature.keyId) {
    return { ok: false, reason: 'malformed_signature' }
  }
  const key = keys.find((candidate) => candidate.keyId === signature.keyId)
  if (!key) {
    return { ok: false, reason: 'unknown_key' }
  }
  let raw: Buffer
  try {
    raw = Buffer.from(signature.signature, 'base64url')
  } catch {
    return { ok: false, reason: 'malformed_signature' }
  }
  if (raw.length !== 64) {
    return { ok: false, reason: 'malformed_signature' }
  }
  const payloadB64 = base64url(canonicalJsonBytes(document))
  const verified = cryptoVerify(
    'sha256',
    signingInput(signature.protected, payloadB64),
    { key: key.publicKey, dsaEncoding: 'ieee-p1363' },
    raw
  )
  return verified ? { ok: true, keyId: signature.keyId } : { ok: false, reason: 'bad_signature' }
}

/** The same signature with the payload attached, so a Markdown export verifies without a second file. */
export function provenanceExportCompactJws(
  document: unknown,
  signature: ProvenanceExportSignature
): string {
  return `${signature.protected}.${base64url(canonicalJsonBytes(document))}.${signature.signature}`
}

export type ProvenanceExportCompactVerification =
  | { ok: true; keyId: string; document: unknown }
  | { ok: false; reason: ProvenanceExportVerificationFailure }

export function verifyProvenanceExportCompactJws(
  jws: string,
  keys: readonly ProvenanceExportVerificationKey[]
): ProvenanceExportCompactVerification {
  const [protectedB64, payloadB64, signatureB64, ...rest] = jws.split('.')
  if (!protectedB64 || !payloadB64 || !signatureB64 || rest.length > 0) {
    return { ok: false, reason: 'malformed_signature' }
  }
  const header = decodeProtectedHeader(protectedB64)
  if (!header || header.alg !== PROVENANCE_EXPORT_ALGORITHM || !header.kid) {
    return { ok: false, reason: 'malformed_signature' }
  }
  let document: unknown
  try {
    document = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed_signature' }
  }
  const result = verifyProvenanceExport(
    document,
    {
      algorithm: PROVENANCE_EXPORT_ALGORITHM,
      keyId: header.kid,
      protected: protectedB64,
      signature: signatureB64,
      payloadSha256: ''
    },
    keys
  )
  return result.ok ? { ok: true, keyId: result.keyId, document } : result
}

function decodeProtectedHeader(value: string): { alg?: string; kid?: string; typ?: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as { alg?: string; kid?: string }) : null
  } catch {
    return null
  }
}
