# Alicorn — Design System (MASTER)

Reconciled from two sources, in this precedence order:

1. **Orca's existing system** — `src/renderer/src/assets/main.css` + `docs/STYLEGUIDE.md`.
   `AGENTS.md` makes this mandatory for any UI work in the repo.
2. **ui-ux-pro-max** — product type `Developer Tool / IDE`, dashboard style
   `Real-Time Monitor + Terminal`.

Where they disagree, Orca wins on **identity** (colour, type) and the skill wins on
**behaviour** (liveness, accessibility). Reasons are recorded per decision, because a
rebrand that diverges from Orca's tokens pays for it in migration cost — every
divergent token is a component that has to be re-themed by hand.

---

## ADOPTED from ui-ux-pro-max

### 1. `Real-Time Monitoring` as the governing dashboard style — the big one

The skill classifies this product's dashboard as **Real-Time Monitor + Terminal**, and
that is a better frame than "team chat columns". A team view where four agents are
working is a *monitoring surface*: the operator's job is to see, at a glance, which
member is live, which is blocked, and which needs them.

Concretely adopted:

| Skill rule | Applied as |
|---|---|
| Live status indicators (pulsing) | `.dot--run` pulses; static dot read as "stopped" |
| Connection status shown | Persistent sync indicator in the rail, not only on Board |
| Critical alerts prominent | `needs you` promoted above transcript body |
| Status indicator animation | Guarded by `prefers-reduced-motion` |

### 2. Semantic alert triad

The skill's `critical (red) / warning (orange) / normal (green)` maps cleanly onto tokens
Orca **already has**, so this costs nothing and changes no identity:

| Skill role | Alicorn token | Orca origin |
|---|---|---|
| normal / live | `--status-live` | `--status-success` `#86efac` |
| warning / needs you | `--status-attention` | `--agent-question` `#f97316` |
| critical | `--status-critical` | `--destructive` `#ff6568` |

### 3. Accessibility rules — all four were real defects in the v1 prototype

- `color-not-only` (**High**) — status was conveyed by dot colour alone. Now every status
  carries **shape + text**: filled+pulsing (live), ring (needs you), hollow (idle).
- `focus-states` (**Critical**) — only `.input` had a focus ring. Now every interactive
  element does, at 2px.
- `nav-label-icon` (**High**) — the rail was icon-only with `title` tooltips, which are
  hover-only and invisible to touch and to screen readers. Labels are now always visible.
- `cursor-pointer` — applied to every clickable element.

### 4. Data-dense discipline

Reinforces what Orca already does: 11/12/13/14px scale, tight rows, no decorative padding.

---

## REJECTED from ui-ux-pro-max — with reasons

### 1. Typeface: **Inter** → keep **Geist**

`STYLEGUIDE.md` is explicit: *"Always reach for `Geist` for sans, never `Inter` or system
sans."* Geist ships in the repo as a single variable woff2. Switching to Inter would
contradict a written project rule and re-flow every existing screen for no gain — the
skill picks Inter as a safe generic default, which `artifact-design` separately names as
an AI-design tell.

### 2. Palette: **slate** → keep **true neutral**

The skill proposes `#0F172A` bg / `#1E293B` card / `#475569` border — a blue-biased slate.
Orca uses true neutral `#0a0a0a` / `#171717` / `rgb(255 255 255 / 0.07)`.

Rejected because a blue-tinted ground **competes with the accent sitting on top of it**.
Now that the brand itself is blue, a slate ground would put blue chrome on a blue field and
flatten the one accent the product has. A true-neutral ground keeps the accent and every
status hue maximally separable — which is the whole job of a monitoring surface. Also note the
skill's `#475569` border is far heavier than Orca's 7% white hairline and would read as
a much boxier product.

### 3. Accent: **green `#22C55E`** → **blue `#4f8cff` / `#1447e6`**

Green is rejected because it is **already load-bearing**: `--workspace-status-review: #16a34a`
and `--status-success: #86efac`. Brand-green would make chrome indistinguishable from
"this passed review" — in a UI whose whole job is showing agent state, that is a functional
defect, not a taste call.

Blue is not a new colour either: main.css already ships `--sidebar-primary: #1447e6` in dark
as the sidebar's own active/primary tone. The skill's own database independently returns the
same modern pattern twice — *"Monochrome + blue accent"* and *"Neutral grey + link blue"*.

Contrast, measured against `--background` `#0a0a0a`:

| Pair | Ratio | Result |
|---|---|---|
| `--brand #4f8cff` on ground | 6.1:1 | WCAG AA normal text |
| `#fff` on `--brand-strong #1447e6` | 6.8:1 | WCAG AA |

**Violet was wrong, and not only because of taste.** v1 promoted `--ai-action-accent` to the
brand — but Orca reserves violet to mean "this was done by AI", so the brand competed with an
existing meaning. Worse, violet was *simultaneously* the brand and the Designer role hue, so
brand chrome and member identity used the same pixel colour. Violet is now left alone,
carrying only its Orca meaning.

### 3b. Colour discipline: monochrome plus one blue

v1 gave each of six roles its own hue — six decorative colours in front of the three that
actually signal something. Member avatars are now **monochrome**; initials identify the
member. Colour is spent only on status:

| Meaning | Token | Form |
|---|---|---|
| working now | `--status-live` | filled dot, pulsing |
| blocked on a person | `--status-attention` | ring |
| nothing to do | `--status-idle` | hollow |
| automation running | `--brand` | blue |

The rule this buys: **on this surface, a coloured pixel always means something needs
attention.** That is worth more on a monitoring UI than a role rainbow.

### 4. Pattern: `Real-Time / Operations Landing` → not applicable

The generator's first answer was a **landing-page** pattern (hero, metrics, CTA). Alicorn
is an application interface, not a marketing page. Discarded as a domain mismatch.

---

## Tokens

Ground, type, radius and elevation are unchanged — see
`tokens/tokens.css`, which carries per-value provenance. This release **adds** only:

> **Shipped 2026-09-07.** These five live in `src/renderer/src/assets/main.css` (`:root` and
> `.dark`), with the three colours also exposed through `@theme inline` as `--color-status-*`.
> `tokens/tokens.css` under `prototype/` stays reference-only — read it for provenance, never
> import it. `main-css-tokens.test.ts` asserts all five exist in both blocks and that no
> pre-existing token line moved.

```css
--status-live:      var(--status-success);   /* normal    */
--status-attention: var(--agent-question);   /* warning   */
--status-critical:  var(--destructive);      /* critical  */
--focus-ring: 2px;                            /* a11y priority 1 */
--motion-fast: 150ms;                         /* skill: 150-300ms */
```

## Deviations held deliberately

| Rule | Status | Why |
|---|---|---|
| `touch-target-size` 44×44 | Not applied | Desktop pointer app. Orca's own rows are 26–32px; forcing 44px would halve the information density this product depends on. |
| `mobile-first` / 375px | Not applied | Electron desktop. Mobile is a separate companion app. |
| Light mode | Deferred | Tokens carry the light set; only dark was designed and measured. |
