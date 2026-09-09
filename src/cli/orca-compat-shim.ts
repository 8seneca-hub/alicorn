#!/usr/bin/env node
// Why: `orca` is on users' PATH and inside their scripts, hooks and shell history. One
// release of it still working is what makes the rename to `alicorn` non-breaking.
process.stderr.write('orca is now alicorn; the `orca` command is removed in the next release.\n')

// Why the dynamic import and the explicit main() call: a static import is hoisted above the
// notice, and index.js only self-starts when it is `require.main` — which is this file.
void import('./index.js')
  .then(async ({ main }) => main())
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
