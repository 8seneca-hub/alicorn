# Alicorn marketing site

Static HTML. No framework, no dependencies, no install step — `build.mjs` assembles pages from
`layout.html` plus the fragments in `pages/`, so navigation and footer cannot drift between pages.

```bash
pnpm --dir site build    # → site/dist
pnpm --dir site check    # build, then verify every internal link and anchor resolves
pnpm --dir site dev      # build and serve on :8899
```

## Layout

| Path | What |
| --- | --- |
| `pages/*.html` | Page content only. A leading HTML comment carries `title:` and `desc:`. |
| `layout.html` | The shell — head, nav, footer. Edited once, applied everywhere. |
| `assets/system.css` | Design system: the three colour ramps and the semantic tier. |
| `assets/site.css` | Marketing components — hero, stat band, pipeline, pricing. |
| `assets/motion.js` | Scroll reveals and counters. |
| `assets/mark.svg` | The brand mark. |
| `build.mjs` | Assembles `dist/`. |
| `linkcheck.mjs` | Fails on a dead internal link or anchor. |
| `color.mjs`, `gen.mjs` | Generate the ramps and **measure** every contrast pair. |

## Design system

Three ramps and nothing else: one neutral, one amber, one red. Primitives are named by hue
(`--neutral-11`) and are never used in a component; semantic tokens name a role
(`--color-text-secondary`) and are the only tier components reference.

The product spends colour exclusively on status, so there is no separate accent hue — the accent
role is the top of the neutral ramp. **Amber means a human is required, and nothing else uses it.**
Red is destructive and failed states only.

Every colour is `oklch()`, and every contrast pair is computed rather than estimated:

```bash
pnpm --dir site colors
```

That prints each ramp and measures fourteen foreground/background pairs against their WCAG
threshold. It fails loudly on a colour outside the sRGB gamut. Re-run it after changing any token.

## Deploying

Vercel project with **root directory `site`**. `vercel.json` sets the build command and output
directory; `cleanUrls` serves `/pricing` from `pages/pricing.html`, and `404.html` is served for
unmatched routes.
