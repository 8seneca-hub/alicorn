import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { main } from './localize-renderer-strings.mjs'

const COMPONENT = `import React from 'react'

export function Card(): React.JSX.Element {
  return (
    <>
      <Badge label="sidebar" />
      <Heading title="Workspace board" />
    </>
  )
}
`

async function scratchRoot(allowlist) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localize-allowlist-'))
  const componentDir = path.join(root, 'src', 'renderer', 'src', 'components', 'sidebar')
  await fs.mkdir(componentDir, { recursive: true })
  await fs.writeFile(path.join(componentDir, 'Card.tsx'), COMPONENT)

  const localesDir = path.join(root, 'src', 'renderer', 'src', 'i18n', 'locales')
  await fs.mkdir(localesDir, { recursive: true })
  await fs.writeFile(path.join(localesDir, 'en.json'), '{}\n')

  await fs.mkdir(path.join(root, 'config'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'config', 'localization-coverage-allowlist.json'),
    JSON.stringify(allowlist, null, 2)
  )
  return { root, componentPath: path.join(componentDir, 'Card.tsx') }
}

// Why this exists: `label` is name-allowlisted as user-visible, but on some components it is a
// variant discriminator typed 'sidebar' | 'source-control'. Wrapping it in translate() fails
// typecheck and would pick the wrong variant in every non-English locale. The coverage audit
// already skips reviewed exclusions; the writer has to read the same file or it rewrites exactly
// what the audit was told to leave alone.
describe('localize-renderer-strings allowlist', () => {
  it('leaves an allowlisted candidate untouched', async () => {
    const { root, componentPath } = await scratchRoot([
      {
        filePath: 'src/renderer/src/components/sidebar/Card.tsx',
        kind: 'jsx-attribute:label',
        text: 'sidebar',
        dynamic: false,
        count: 1
      }
    ])

    await main(root)

    const source = await fs.readFile(componentPath, 'utf8')
    expect(source).toMatch(/label="sidebar"/)
    expect(source).not.toMatch(/translate\([^)]*'sidebar'/)
  })

  it('still localizes candidates that are not allowlisted', async () => {
    const { root, componentPath } = await scratchRoot([])

    await main(root)

    const source = await fs.readFile(componentPath, 'utf8')
    expect(source).toMatch(/translate\(/)
    expect(source).toMatch(/Workspace board/)
  })

  it('localizes everything when the allowlist file is absent', async () => {
    const { root, componentPath } = await scratchRoot([])
    await fs.rm(path.join(root, 'config', 'localization-coverage-allowlist.json'))

    await main(root)

    expect(await fs.readFile(componentPath, 'utf8')).toMatch(/translate\(/)
  })
})
