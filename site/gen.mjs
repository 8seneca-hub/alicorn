import { oklch, contrast } from './color.mjs'
// Reduce chroma until the colour is renderable in sRGB. Hue and lightness are the
// design decision; chroma is the one that has to give.
function fit(L, C, H) {
  let c = C
  while (c > 0 && !oklch(L, c, H).inGamut) {
    c = +(c - 0.002).toFixed(4)
  }
  return { ...oklch(L, c, H), L, C: c, H, clamped: c < C }
}
const H_N = 264,
  H_A = 73,
  H_D = 22
const N = [
  [1, 0.145, 0.004],
  [2, 0.178, 0.005],
  [3, 0.213, 0.006],
  [4, 0.243, 0.007],
  [5, 0.271, 0.008],
  [6, 0.305, 0.009],
  [7, 0.349, 0.01],
  [8, 0.424, 0.011],
  [9, 0.551, 0.01],
  [10, 0.611, 0.009],
  [11, 0.742, 0.007],
  [12, 0.955, 0.003]
]
const A = [
  [3, 0.272, 0.052],
  [6, 0.392, 0.096],
  [9, 0.774, 0.162],
  [11, 0.842, 0.132]
]
const D = [
  [3, 0.262, 0.062],
  [6, 0.386, 0.112],
  [9, 0.64, 0.212],
  [11, 0.752, 0.158]
]
const mk = (steps, H) => Object.fromEntries(steps.map(([s, L, C]) => [s, fit(L, C, H)]))
const n = mk(N, H_N),
  a = mk(A, H_A),
  d = mk(D, H_D)
const show = (name, ramp) => {
  console.log(`── ${name} ──`)
  for (const s of Object.keys(ramp)) {
    const v = ramp[s]
    console.log(
      `  ${String(s).padStart(2)}  ${v.hex}  oklch(${v.L} ${v.C} ${v.H})${v.clamped ? '  [chroma clamped to gamut]' : ''}`
    )
  }
}
show('neutral', n)
show('amber', a)
show('red', d)
const pairs = [
  ['text-primary  n12 / page n1', n[12], n[1], 4.5],
  ['text-secondary n11 / page n1', n[11], n[1], 4.5],
  ['text-tertiary n10 / page n1', n[10], n[1], 4.5],
  ['text-primary  n12 / surface n3', n[12], n[3], 4.5],
  ['text-secondary n11 / surface n3', n[11], n[3], 4.5],
  ['on-solid n1 / solid n12', n[1], n[12], 4.5],
  ['focus-ring n11 / page n1', n[11], n[1], 3],
  ['border n7 / page n1', n[7], n[1], 1],
  ['attention a11 / page n1', a[11], n[1], 4.5],
  ['attention a11 / amber a3', a[11], a[3], 4.5],
  ['attention solid a9 / page n1', a[9], n[1], 3],
  ['on-attention n1 / a9', n[1], a[9], 4.5],
  ['danger d11 / page n1', d[11], n[1], 4.5],
  ['danger solid d9 / page n1', d[9], n[1], 3]
]
console.log('\n── measured contrast (WCAG 2.1, computed from the declared tokens) ──')
let fail = 0
for (const [label, fg, bg, min] of pairs) {
  const r = contrast(fg.rgb, bg.rgb),
    ok = r >= min
  if (!ok) {
    fail++
  }
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2).padStart(6)}:1  min ${String(min).padEnd(3)} ${label}`
  )
}
console.log(fail ? `\n${fail} FAILING` : '\nall measured pairs pass')
import { writeFileSync } from 'node:fs'
writeFileSync('ramps.json', JSON.stringify({ neutral: n, amber: a, red: d }, null, 1))
