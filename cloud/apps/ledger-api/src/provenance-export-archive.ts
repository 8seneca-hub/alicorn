import type { ProvenanceExportArchiveResult } from '@alicorn-cloud/control-plane-contract'

/**
 * The retention seam. PV2 owes an auditor a copy that outlives the branch, and that copy belongs in
 * an object store — but this estate has no object store for product data yet (the only bucket in
 * `cloud/` is the relay fence broker's GCS mutation lease, which is coordination state, not an
 * archive). So the destination is a port with no adapter: nothing is written, and the response says
 * so in `archive.reason`.
 *
 * An export that silently writes nowhere is worse than one that says it cannot, so there is
 * deliberately no filesystem fallback here — a local disk under one replica would read as retention
 * and not be it.
 *
 * To land the adapter: implement `put` against the bucket, inject it as `deps.exportArchive`, and
 * key objects with `provenanceExportObjectKey`. Nothing else in this file needs to change.
 */
export type ProvenanceExportArchive = {
  put(input: {
    key: string
    body: Uint8Array
    contentType: string
    tenantId: string
  }): Promise<{ uri: string }>
}

export async function archiveProvenanceExport(
  archive: ProvenanceExportArchive | undefined,
  input: { key: string; body: Uint8Array; contentType: string; tenantId: string }
): Promise<ProvenanceExportArchiveResult> {
  if (!archive) {
    return { stored: false, reason: 'not_configured' }
  }
  try {
    const { uri } = await archive.put(input)
    return { stored: true, uri }
  } catch (error) {
    // Why serve the export anyway: the signature is what makes the artefact trustworthy, and it is
    // already computed. Retention failing is an operator problem, reported, not a 500 for the caller.
    console.error('[alicorn-ledger-api] provenance export archive failed', {
      key: input.key,
      error: error instanceof Error ? error.message : String(error)
    })
    return { stored: false, reason: 'failed' }
  }
}
