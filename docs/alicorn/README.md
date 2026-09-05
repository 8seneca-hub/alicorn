# Alicorn

Planning documents for the Alicorn product built on this codebase.

| Document | What it covers |
| --- | --- |
| [ROADMAP.md](ROADMAP.md) | Four releases with scope, exit criteria, critical path, team shape and risks |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, identity, data model, the autonomy policy and the API surface |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Deployment models, runtime, CI/CD, observability, capacity, backup and security |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | Colour, type and motion decisions, with the reasoning behind each |
| [prototype/](prototype/) | Interactive HTML prototype — 15 screens across the app, sign-in and landing flows |

## Prototype

Static HTML, no build step and no dependencies.

- `prototype/html/review.html` — tabbed shell over every flow
- `prototype/alicorn.html` — single-file version of the same thing

Verified with the `pica` design flow: `verify-html` and `flow-check` both at zero findings
across 15 screens and 20 links.

## Marketing site

Separate repository — it has its own build and its own hosting, and does not belong in this
monorepo.

## Why these are tracked

`.gitignore` ignores `docs/**` by design, because most planning docs here are local-only.
`docs/alicorn/` is allow-listed alongside the other durable locations so this set stays in
version control.
