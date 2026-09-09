/**
 * How long a ratchet that reads the whole `src` tree is allowed to take.
 *
 * Why it is not the 30s default: these tests walk and read every source file, and several of them
 * run concurrently with the rest of the suite. On a loaded machine one full-tree pass has been
 * measured at 75s — so the default does not fail them for being wrong, it fails them for being
 * busy. A ratchet that reports a false finding trains people to re-run until green, which is how a
 * real finding gets ignored; run 7 lost a triage pass to exactly this.
 *
 * This is a bound on I/O, not a licence to be slow: a ratchet that genuinely exceeds it is doing
 * more than reading the tree and should say so.
 */
export const SOURCE_TREE_RATCHET_TIMEOUT_MS = 180_000
