import { readdirSync, readFileSync, existsSync } from 'node:fs'
const files = readdirSync('dist').filter((f) => f.endsWith('.html'))
const pages = new Set(files.map((f) => `/${f.replace('.html', '')}`))
pages.add('/') // index
const ids = {}
for (const f of files) {
  ids[`/${f.replace('.html', '')}`] = new Set(
    [...readFileSync(`dist/${f}`, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  )
}
ids['/'] = ids['/index']
let bad = 0,
  checked = 0
for (const f of files) {
  const html = readFileSync(`dist/${f}`, 'utf8')
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1]
    if (/^(https?:|mailto:|tel:)/.test(href)) {
      continue
    }
    checked++
    const [path, hash] = href.split('#')
    if (path.startsWith('/assets/')) {
      if (!existsSync(`dist${path}`)) {
        console.log(`  MISSING ASSET  ${f} → ${href}`)
        bad++
      }
      continue
    }
    const target = path === '' ? `/${f.replace('.html', '')}` : path.replace(/\/$/, '') || '/'
    if (!pages.has(target)) {
      console.log(`  DEAD LINK      ${f} → ${href}`)
      bad++
      continue
    }
    if (hash && !ids[target]?.has(hash)) {
      console.log(`  DEAD ANCHOR    ${f} → ${href}`)
      bad++
    }
  }
}
console.log(`\n${checked} internal links checked across ${files.length} pages`)
console.log(bad ? `${bad} BROKEN` : 'all resolve')
process.exit(bad ? 1 : 0)
