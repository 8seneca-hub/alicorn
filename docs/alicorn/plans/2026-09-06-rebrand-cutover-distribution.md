# Rebrand, Cutover & Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Alicorn as its own product: app identity, the `alicorn` CLI with a one-release `orca` shim, a skill corpus with zero bare `orca ` invocations enforced by CI, `ALICORN_*` environment variables with a versioned hook reinstall across local/WSL/SSH hosts, re-translated catalogs, every backend endpoint off `alicorn.8seneca.com`, signed and notarised installers, and the upstream cut recorded in `UPSTREAM_BASE`.

**Architecture:** Mechanical, CI-enforced renames staged so that every intermediate commit still builds and updates still reach installed clients. Four seams carry most of the work: `config/electron-builder.config.cjs` (identity), `src/shared/orca-cli-command-name.ts` + `src/main/runtime/orchestration/cli-command.ts` (CLI name), `src/shared/agent-hook-endpoint-file.ts` + the per-backend hook services (env names, already versioned by `ORCA_AGENT_HOOK_VERSION`), and the five `PRODUCTION_*_URL` constants (endpoints). Two new gates keep it honest: `verify:rebrand-cli-gate` (skill corpus) and `verify:rebrand-env-gate` (no `ORCA_*` outside the compat shim). The upstream cut is the last commit of the plan.

**Tech Stack:** electron-builder (`config/electron-builder.config.cjs`), Node 24 scripts under `config/scripts/*.mjs` (vitest/`node --test`), the existing localisation tooling, GitHub Actions (`release-mac-build.yml`, `windows-signing-rehearsal.yml`), SignPath (Windows signing), Apple notarytool, Terraform (`cloud/infra/terraform`).

**Spec:** `docs/alicorn/ROADMAP.md` v0.1 (Rebrand, Localisation, Backend cutover, Distribution) + *Risks*; `docs/alicorn/PROJECT-BRIEF.md` §10 (fork posture), §11.5 (cut point); `CLAUDE.md` → *Fork posture*, *Naming while the rebrand is pending*; research `research/rebrand-cutover-distribution.md` (local scratch). Plane: R1–R5, L1, BC1, BC2, DS1–DS3 (module *Rebrand, cutover & distribution*, owner Huy).

## Global Constraints

- **Rename all 963 `ORCA_*` identifiers at once, never piecemeal** (CLAUDE.md) — one commit for `src/`+`config/`+`.github/`, with a compat shim that re-exports `ORCA_*` from `ALICORN_*` for one release. `ORCA_RELAY_*` (the inherited relay stack) renames in BC1, not R4.
- **A surviving bare `orca ` invocation in the skill corpus fails the build** (ROADMAP risk *Missed CLI call site*): `verify:rebrand-cli-gate` is zero-tolerance once R3 lands, wired into the `lint` chain after `verify:skill-bundle-manifest`.
- **Update continuity is a wire contract**: `appId`, Windows `publisherName`, and the update feed are checked by installed clients; each changes only with a compatibility window (dual feed, staged rollout) — `docs/reference/remote-wire-compatibility.md` applies in spirit.
- **Keep** `docs/reference/*.md` (24 files), the ratchets (`src/shared/child-process/child-process-import-boundary.test.ts` pin 158 shrink-only; `config/scripts/check-runtime-electron-ratchet.mjs`), MIT `LICENSE` + a new `NOTICE`.
- Platform rules from AGENTS.md: Windows child processes via `runProcess`/`spawnProcess`; WSL argv via `buildWslExecArgs`; no new `-ExecutionPolicy Bypass`/`-EncodedCommand`; glibc floor 2.31 (already enforced by `verify-linux-glibc-floor.cjs`).
- Localisation by tooling: `node config/scripts/localize-renderer-strings.mjs`, `pnpm run sync:localization-catalog`, `verify:localization-*` green.
- Linux binary stays `alicorn-ide` (as `orca-ide` was): Ubuntu's GNOME Orca owns `/usr/bin/orca`; Alicorn has no such clash, but `-ide` keeps the AppImage/deb/rpm naming pattern stable.
- No AI attribution in commits.

## Decisions made in this plan (state, don't relitigate)

1. **Mobile is out of scope for R1** (`mobile/app.json`, `OrcaLogo.tsx` keep Orca identity); tracked as a follow-up Plane issue *R6 — Mobile rebrand* created by Task 1.
2. **Windows signing stays on SignPath** (the shipped mechanism), under an Alicorn SignPath project; the Plane item's "EV certificate" wording is corrected in DS2's issue by Task 1. `publisherName` changes only when the new SignPath identity is live, and only together with a full release (update verification reads it).
3. **Update feed cutover uses a dual-feed window**: the new repo publishes releases; the old `stablyai/orca`-named feed is mirrored for two releases; `updater-prerelease-feed.ts`'s `TAG_HREF_RE` accepts both owners during the window.
4. **`appId` changes once, in the first Alicorn release, together with a new update channel**: macOS Squirrel treats a changed bundle id as a new app, so the release notes and the last Orca-branded build point users at the new installer (no silent migration is possible).
5. **`LICENSE` keeps the existing copyright line ("Lovecast Inc.") unchanged** (upstream's notice must survive); `NOTICE` names Alicorn / 8seneca and lists the fork origin and date. Legal entity to be confirmed by Huy — the plan flags it; do not invent one.
6. **CLI compat shim = a second `bin` entry `orca` that prints a one-line deprecation notice to stderr and execs the same entry**; `getOrcaCliCommandNameForPlatform` becomes `getAlicornCliCommandNameForPlatform` returning `alicorn`/`alicorn-ide`/`alicorn.cmd`; `OrchestrationCliCommand = 'alicorn' | 'alicorn-ide' | 'orca' | 'orca-ide'` for one release (old handles are read from persisted state).
7. **Env rename = codemod + shim**: `ALICORN_*` everywhere in source; `src/shared/alicorn-env-compat.ts` reads `process.env.ORCA_X ?? process.env.ALICORN_X` at the *process-boundary readers* only (hook endpoint file parsing, PTY env injection, CLI identity env) for one release; hook scripts emit both names for one release; `ORCA_AGENT_HOOK_VERSION` → `ALICORN_AGENT_HOOK_VERSION` with value bumped so old-name scripts are detected and reinstalled.
8. **Stale-translation audit is new tooling** (`audit-stale-translations.mjs`) keyed on an English-source hash stored beside each key in a sidecar `locales/.source-hashes.json` written by `sync:localization-catalog`.
9. **Upstream cut (`UPSTREAM_BASE`) is the last commit** of this plan, after `verify:rebrand-cli-gate` and `verify:rebrand-env-gate` are green in CI — that is the brief's definition of the cut point.

## File structure (new or heavily modified)

```
config/electron-builder.config.cjs            identity, publish block, publisherName (staged)
config/scripts/verify-rebrand-cli-gate.mjs     + .test.mjs — zero bare `orca ` in the skill corpus
config/scripts/verify-rebrand-env-gate.mjs     + .test.mjs — no ORCA_* outside src/shared/alicorn-env-compat.ts + cloud relay
config/scripts/rename-orca-env.mjs             codemod (one-shot; kept for the record)
config/scripts/audit-stale-translations.mjs    + .test.mjs
src/shared/alicorn-cli-command-name.ts         (renamed from orca-cli-command-name.ts)
src/shared/alicorn-env-compat.ts               readAlicornEnv(name) — ORCA_ fallback for one release
src/main/runtime/orchestration/cli-command.ts  widened union
src/cli/index.ts + src/cli/orca-compat-shim.ts deprecation shim
src/main/cli/**                                install/registration renames, LEGACY_* constants
src/main/hooks/hook-reinstall-sweep.ts         versioned reinstall across local/WSL/SSH + unreachable-host report
NOTICE, UPSTREAM_BASE
```

---

### Task 1 (bookkeeping): Correct the Plane items and record decisions

**Files:** none in the repo (Plane only) — the executor uses the Plane REST API (`https://projects.8seneca.com/api/v1/workspaces/8seneca/projects/2a53f690-4738-4491-b803-bbdf0a6e0cda/…`, header `X-API-Key`, `User-Agent: curl/8.7.1`) with the key the project owner provides.
- [ ] Rename DS2 to "Distribution — Windows code signing on SignPath (Alicorn project) + publisherName cutover"; comment with decision 2.
- [ ] Create *R6 — Mobile rebrand (app.json name/slug/scheme/bundle ids, OrcaLogo)* in module *Rebrand, cutover & distribution*, label `v0.1`, state Backlog; comment on R1 that mobile is excluded (decision 1).
- [ ] Comment on R5: "cut is the last commit of the rebrand plan; requires both rebrand gates green in CI".

---

### Task 2 (R3-gate): `verify:rebrand-cli-gate` with a shrink-only baseline

**Files:** Create `config/scripts/verify-rebrand-cli-gate.mjs`, `config/scripts/verify-rebrand-cli-gate.test.mjs`, `config/rebrand-cli-baseline.txt`; Modify `package.json` (`"verify:rebrand-cli-gate": "node config/scripts/verify-rebrand-cli-gate.mjs"`, appended to `lint` after `verify:skill-bundle-manifest`).

**Interfaces:**
```js
// Pure, exported for tests
export const BARE_ORCA_INVOCATION = /(^|[^A-Za-z0-9_\/-])orca(?:-dev)? [a-z]/
export function findBareOrcaInvocations(files) // [{ path, line, text }]  — files: Map<path, content>
export function compareAgainstBaseline(findings, baseline) // { newFindings, allowedCount, baselineCount }
// main(): scans skills/**, skill-guides/**, skill-stubs/**, src/cli/bundled-skill-guides.ts; exits 1 if newFindings.length > 0 OR findings.length > baselineCount (shrink-only, like check-runtime-electron-ratchet.mjs); prints the top offending files
```
- [x] **Step 1: Failing tests** — regex matches `orca orchestration send`, `  orca status`, `$(orca …)`, not `orca-ide`, `/usr/local/bin/orca`, `alicorn orca-shim`, `GNOME Orca`; baseline compare flags new file entries and a grown count.
- [x] **Step 2: Implement**; seed `config/rebrand-cli-baseline.txt` — **324** findings across 19 files, not the 428 the research recorded; the number is generated by `--write`, so take it from the file, not from here. Tests are vitest, matching every other `config/scripts/*.test.mjs`, not `node --test`.
- [x] **Step 3: Verify** `pnpm run verify:rebrand-cli-gate` passes; injecting `orca status` into `skill-guides/orca-cli.md` fails with the file:line; blanking an existing call site passes at 323/324.
- [x] **Step 4: Commit** `ci: rebrand CLI gate — bare orca invocations may only decrease`.

---

### Task 3 (R1): Product identity

**Files:** Modify `config/electron-builder.config.cjs` (`appId 'com.8seneca.alicorn'`, `productName 'Alicorn'`, `protocols [{ name: 'Alicorn', schemes: ['alicorn'] }]`, `win.executableName 'Alicorn'`, `linux.executableName 'alicorn-ide'`, `StartupWMClass 'alicorn'`, deb/rpm `packageName 'alicorn-ide'`, `extendInfo` usage strings "Alicorn allows …", `publish.owner '8seneca-hub'`, `repo 'alicorn'` (dev channels `alicorn-hourly` etc.)); `resources/icon-source/**` + `bash resources/icon-source/generate.sh` → `resources/build/icon.{icns,ico,png}`; `resources/app-icons/` (replace); deep-link literals `orca://` → `alicorn://` in `src/renderer/src/web/web-pairing.ts`, `WebConnect.tsx`, `AddRemoteHostFields.tsx`, `RuntimeHostAccessForm.tsx`, `src/shared/skill-share-link.ts` + their ~15 tests (parse both schemes for one release: `alicorn://` primary, `orca://` accepted); Create `NOTICE`.
**Icons are blocked, `appId` needs its own commit, and the pairing scheme cannot flip yet.** Three corrections found while executing:

- **`appId` is a compat surface, not a string.** `com.stablyai.orca` is mirrored in
  `src/shared/local-build-compatibility-contract.{json,ts}` (from which `ORCA_APP_ID` is derived and
  local builds are validated), asserted three times in
  `config/scripts/electron-builder-mac-channel-config.test.mjs`, prefixed by the helper ids in
  `dev-electron-bundle-identity.mjs` / `build-computer-macos.mjs` / `build-notification-status-macos.mjs`,
  matched as a macOS **preferences domain** in `src/main/macos-press-and-hold-default.ts`, and listed
  as a **TCC bundle id** in `src/main/macos-tcc-prompt-watch.ts`. An upgrading user's preferences and
  TCC grants live under the old id, so the rename has to keep recognising it. That is its own commit
  with its own tests; the identity commit changes everything except `appId`.
- **Icons need Alicorn artwork that does not exist.** `resources/icon-source/generate.sh` compiles
  `icon.icon` (an Icon Composer project) with `xcrun actool`; re-running it today just re-emits the
  Orca mark. `resources/app-icons/` holds `orca-blue.png` and `orca-watercolor.png`. Icons and
  `resources/app-icons/` are therefore split out of this task and wait on design.
- **`encodePairingOffer` must keep emitting `orca://`.** Decision 1 puts mobile out of scope for R1,
  but `mobile/app.json` registers `"scheme": "orca"` and `mobile/src/transport/pairing.ts` parses
  only that. Minting `alicorn://pair?code=…` would hand desktop users a QR code no installed phone
  can open. Parsers take both schemes now; the emitter flips with **R6 (mobile rebrand)**, and
  `pairing.test.ts` pins it so the flip is deliberate.

- [x] **Step 1:** grep for `setAsDefaultProtocolClient` in `src/**`, `config/**`, `*.cjs|*.mjs` and the Info.plist template — **no matches anywhere in `src/` or `config/`**, confirming research: scheme registration is entirely declarative through electron-builder's `protocols` block. `config/nsis/orca-installer-hooks.nsh` registers file extensions only, not URL schemes, so it needs no change.
- [x] **Step 2:** tests: `web-pairing.test.ts` and `pairing.test.ts` accept both schemes (and pin the legacy emitter); `skill-share-link.test.ts` created — there was none. `electron-builder-config.test.mjs` **already existed** (435 lines) — the identity assertions are appended to it, not a new file. It cannot execute on a machine without the Windows-only optional deps (`windows-native-registry`), which the config resolves at module load; that is pre-existing and unrelated to this change, so the new assertions were verified by lint/parse here and run in CI. Both schemes live in one place, `src/shared/deep-link-scheme.ts`, so the legacy one is deleted from a single file next release.
- [x] **Step 3 (partial):** `productName`, executable names, `StartupWMClass`, deb/rpm package names, publish target + dev channels, macOS permission strings, protocol schemes and `NOTICE` done; **`appId` and icons deferred** (see above). `NOTICE` keeps the entity name as an explicit `LEGAL ENTITY NAME TO BE CONFIRMED` marker and the fork point as an `UPSTREAM_BASE` marker rather than inventing either:
  ```
  Alicorn — an agent development environment.
  Copyright (c) 2026 8seneca (entity name to be confirmed — see Plane R1).
  This product is a fork of Orca (https://github.com/stablyai/orca), licensed under the MIT License;
  the original copyright notice is retained in LICENSE. Forked at <UPSTREAM_BASE tag/SHA, filled by Task 13>.
  ```
- [ ] **Step 4:** `pnpm run build:mac` (unsigned local) packages; `plutil -p dist/mac*/Alicorn.app/Contents/Info.plist | grep -E 'CFBundleIdentifier|CFBundleURLSchemes'` shows the new id and both schemes. **Not run** — deferred with the icon work, since a package built on the Orca mark proves nothing about identity. Renderer/shared suites are green.
- [x] **Step 5: Commit** `feat(rebrand): Alicorn product identity, dual protocol schemes, NOTICE`.
- [x] **Step 6: `appId` cutover** — done. `src/shared/app-bundle-id.ts` now holds `APP_BUNDLE_ID` and `LEGACY_APP_BUNDLE_ID`; the preferences matcher and the TCC responsible-identifier set accept both families, everything that *declares* our identity uses the new one only. The surface was wider than the step listed: also `src/main/startup/dev-instance-identity.ts` (Windows AppUserModelID), `src/main/ipc/notification-system-settings-link.ts` (the System Settings deep link), and `src/main/computer/macos-computer-use-permissions.ts` (the helper-id fallback, which has to match what `build-computer-macos.mjs` stamps).

  **Two consequences to put in the release notes, not to fix in code:**

  - **macOS safeStorage secrets do not survive the rename.** Electron derives the Keychain service name from CFBundleName (`"<appName> Safe Storage"`), so `productName: 'Alicorn'` moves it and every stored secret becomes unreachable — the same hazard `dev-instance-identity.ts` documents for dev branches. It cannot be migrated silently, for the same reason decision 4 gives for `appId`: this is a new app to macOS. Users re-enter credentials once, and the release notes must say so.
  - **The Orca-branded `defaults` domain and TCC grants are read, never written.** `isAppPreferencesDomain` and `APP_RESPONSIBLE_IDENTIFIERS` accept the legacy family so an upgrading user's press-and-hold choice is not overwritten and their TCC prompts stay attributed. Both retire when Orca upgrades stop being supported.

  **Deliberately left on Orca:** `BASE_APP_NAME` in `dev-instance-identity.ts`. It names the *dev* Keychain item, and changing it orphans every team member's dev secrets for a cosmetic gain while the rest of the rebrand is still in flight. Flip it with R2.
- [x] **Step 7 (new): non-artwork remainder** — done. The identity commit left three
  packaged surfaces on Orca and the config suite red; both are fixed here.

  - `linux.maintainer` was still `'stablyai'` — it is the `Maintainer:` field apt and dnf
    print. Now `'8seneca'`.
  - `package.json` `description` / `homepage` / `author` are **packaged metadata**, not
    repo bookkeeping: electron-builder copies `description` into the `.desktop` `Comment`
    and the deb/rpm description, `homepage` into `Homepage:`/`URL`, and `author` is the
    fallback maintainer. Renamed. `name` and `bin` are deliberately untouched — they are
    the CLI's and move with **R2**.
  - `config/nsis/orca-installer-hooks.nsh` wrote the ProgID `Orca.Markdown` into the
    Windows registry. Now `Alicorn.Markdown`. The legacy ProgID is **not** cleaned up, and
    that is the correct behaviour: `appId` moved, so NSIS treats Alicorn as a different
    product and never runs Orca's uninstaller — an Orca install can still be present and
    still own `Orca.Markdown`, and deleting it would strip a live app's "Open with" entry.
  - **The config suite was red on `main`, 12 failures, all of them stale Orca assertions
    the identity commit did not update**: `electron-builder-config.test.mjs` (StartupWMClass,
    rpm packageName), `electron-builder-mac-channel-config.test.mjs` and
    `verify-dev-channel-packaging.test.mjs` (`publish.repo` for stable/hourly/daily/adhoc).
    Fixed to the shipped identity. Artifact **file** names (`orca-macos-${arch}.dmg`,
    `orca-windows-setup.exe`, `orca-linux.AppImage`, `orca-ide_*`) are deliberately left
    alone — `findInstallerAssetName` in `src/shared/release-channel.ts`, the release-asset
    check and the Casks read them back, so they move with **BC2**, not with identity.
  - `verify:rebrand-cli-gate` was in `pnpm lint` but never added to `.github/workflows/pr.yml`,
    so `pr-workflow-lint-parity.test.mjs` failed and the gate never ran on a PR. Added.

- [ ] **Step 8 (was step 7): icons and wordmark — BLOCKED on artwork, nothing else.**

  No Alicorn artwork exists in the repo. Nothing here was improvised; the whole pipeline
  regenerates from **one SVG**. `resources/logo.svg` and
  `resources/icon-source/icon.icon/Assets/logo.svg` are byte-identical today
  (`c753624…`), so a single replacement drives both the app icon and the in-app mark.

  | Drop this in | Format / size | Feeds |
  |---|---|---|
  | `resources/icon-source/icon.icon/Assets/logo.svg` | SVG, square-safe inside Icon Composer's safe area | `generate.sh` → every OS icon below |
  | `resources/logo.svg` | same file, byte-identical | `OrcaLogoSettingsIcon` (Settings rail) |
  | `resources/app-icons/alicorn-blue.png` | PNG 1024×1024, alpha | Settings → App Icon "blue"; macOS dock override (`asarUnpack`) |
  | `resources/app-icons/alicorn-watercolor.png` | PNG 1024×1024, alpha | Settings → App Icon "watercolor"; macOS dock override |
  | `resources/icon-dev.png` | PNG 256×256, alpha | dev-instance dock icon |
  | `resources/tray/alicorn-menu-barTemplate.png` | PNG **22×14**, black + alpha only (macOS template image) | menu-bar tray |
  | `resources/tray/alicorn-menu-barTemplate@2x.png` | PNG **44×28**, black + alpha only | menu-bar tray, retina |

  Generated by `bash resources/icon-source/generate.sh` (needs Xcode `actool`, ImageMagick
  and Node) — do not hand-author these:

  | Generated | Format | Consumed by |
  |---|---|---|
  | `resources/build/icon.icns` | icns, 10 slots 16²→512²@2x; the four small slots are trimmed | `mac.icon` **and** `linux.icon` (electron-builder expands it into hicolor PNGs) |
  | `resources/build/icon.ico` | multi-size ICO, 6 frames to 256×256, trimmed and re-squared by `config/scripts/trim-windows-icon-source.mjs` | Windows — picked up implicitly from `directories.buildResources` |
  | `resources/build/icon.png` | PNG 1024×1024 | electron-builder fallback |
  | `resources/icon.png` | PNG 256×256 | Settings → App Icon "classic"; in-app icon |

  Renaming `orca-blue.png` / `orca-watercolor.png` / `orca-menu-barTemplate*.png` also
  touches their importers: `src/main/app-icon.ts`, `src/main/tray/system-tray.ts`,
  `src/renderer/src/components/settings/AppIconSelector.tsx` and the three `.test.ts`
  siblings that `vi.mock` those exact specifiers.

  The **wordmark** is drawn three times, not once: `resources/logo.svg` plus two hand-inlined
  copies of the same path at viewBox `0 0 318.60232 202.66667` — `OrcaLogo` in
  `src/renderer/src/components/stats/share-card-utils.tsx` and the local `OrcaLogo` in
  `src/renderer/src/components/mobile/slides/HomeSlide.tsx`. All three change together.

  Then the deferred check from step 4: `pnpm run build:mac` (unsigned local) and
  `plutil -p dist/mac*/Alicorn.app/Contents/Info.plist | grep -E 'CFBundleIdentifier|CFBundleURLSchemes'`.

**Still Orca-branded after R1, on purpose — with the owner.** Recorded so none of it is
found again by accident:

| Surface | Why not R1 | Owner |
|---|---|---|
| `BASE_APP_NAME = 'Orca'` (`src/main/startup/dev-instance-identity.ts`) | Drives the prod window title and app menu, **and** `app.setName` → `~/Library/Application Support/Orca` and the safeStorage Keychain item. Flipping it orphans every existing user's settings, sessions and secrets — it needs a data migration, not a string edit. | R2 (already decided in step 6) |
| "Orca Computer Use.app" — display name, bundle directory, `NSAccessibilityUsageDescription` | The bundle **id** is already `com.8seneca.alicorn.computer-use`, but the name the TCC prompt shows is not. ~24 files, including the Swift package `OrcaComputerUseMacOS`, `src/cli/handlers/computer.ts` and the skill corpus — it crosses R2 and R3, so a piecemeal rename here would split it. | R2 + R3 |
| `%LOCALAPPDATA%\Orca\daemon-host`, `~/.orca`, the `Orca` logs directory | Same class as `BASE_APP_NAME`: data paths, not identity strings. | R2 |
| `orca-macos-${arch}.dmg`, `orca-windows-setup.exe`, `orca-linux.AppImage`, `orca-ide_*` and the two `Casks/` | Read back by `findInstallerAssetName`, `verify-release-required-assets` and Homebrew. Renaming them without the feed is a broken updater. | BC2 / DS |

---

### Task 4 (R2): `alicorn` CLI with an `orca` compatibility shim

**Files:** Modify `package.json` `bin` → `{ "alicorn": "./out/cli/index.js", "orca": "./out/cli/orca-compat-shim.js", "alicorn-dev": "./config/scripts/alicorn-dev.mjs" }` (rename `orca-dev.mjs`); rename `src/shared/orca-cli-command-name.ts` → `alicorn-cli-command-name.ts` (`getAlicornCliCommandNameForPlatform(platform): 'alicorn-ide' | 'alicorn.cmd' | 'alicorn'`; keep a deprecated alias export `getOrcaCliCommandNameForPlatform` for one release); `src/main/runtime/orchestration/cli-command.ts` union → `'alicorn' | 'alicorn-ide' | 'orca' | 'orca-ide'` with `isLegacyOrchestrationCliCommand()`; `src/main/cli/cli-install-constants.ts` (`DEFAULT_MAC_COMMAND_PATH '/usr/local/bin/alicorn'`, `LEGACY_MAC_COMMAND_PATH '/usr/local/bin/orca'`, `DEV_COMMAND_NAME 'alicorn-dev'`, `LEGACY_LINUX_COMMAND_NAME 'orca-ide'`); `src/main/cli/cli-installer.ts` installs `alicorn` and a symlink/shim `orca` → same target, uninstall removes both; `wsl-cli-scripts.ts` + `wsl-cli-installer.ts` (launcher `alicorn-ide`, marker `# Alicorn managed WSL CLI`, legacy marker still detected for replace/uninstall); `src/main/ssh/ssh-remote-cli-*` passthrough; `CliSection.tsx`/`WslCliRegistration.tsx` copy; Create `src/cli/orca-compat-shim.ts`:
  ```ts
  // Why: one release of `orca …` still working keeps hooks and skills that were installed before the rename alive.
  process.stderr.write('orca is now alicorn; the `orca` command is removed in the next release.\n')
  await import('./index.js')
  ```
- [ ] **Step 1: Failing tests** — `cli-command-name-parity.test.ts` (existing) extended for the new names; `cli-installer.test.ts` expects both binaries installed and removed; `wsl-cli-installer.test.ts` expects the new marker and legacy detection; `orca-compat-shim.test.ts` asserts the stderr notice and delegation (mock `import`).
- [ ] **Step 2:** implement; `pnpm run build:cli`; run `out/cli/index.js --help` and `out/cli/orca-compat-shim.js --help` (notice on stderr, same output).
- [ ] **Step 3:** `pnpm tc:node && pnpm tc:cli`, `pnpm test src/main/cli src/shared/alicorn-cli-command-name.test.ts src/cli`.
- [ ] **Step 4: Commit** `feat(rebrand): alicorn CLI with a one-release orca compatibility shim`.

---

### Task 5 (R3): Skill corpus rewrite

**Files:** Modify `skill-guides/**` (282 call sites), `skills/**` (14), `skill-stubs/**` (4); regenerate `src/cli/bundled-skill-guides.ts` (`pnpm run generate:bundled-skill-guides`) and `resources/skills/*` (`pnpm run generate:skill-bundle-manifest`); `config/scripts/generate-bundled-skill-guides.mjs` `CANONICAL_GUIDE_NAMES` → `alicorn-cli`, `alicorn-emulator`, `alicorn-emulator-android`, `alicorn-linear`, `alicorn-per-workspace-env` with `GUIDE_ALIASES` entries `orca-cli → alicorn-cli` etc. (additive, never removed); `config/rebrand-cli-baseline.txt` → empty.
- [ ] **Step 1:** codemod `node config/scripts/rewrite-skill-corpus-cli.mjs` (new, one-shot, tested on a fixture: replaces `BARE_ORCA_INVOCATION` matches with `alicorn ` preserving the leading char; skips code fences that are shell *output* — none expected) over the three dirs; hand-review the diff for prose that says "Orca" as the product (keep) vs commands (rename).
- [ ] **Step 2:** regenerate the bundle + manifest; `pnpm run verify:bundled-skill-guides && pnpm run verify:skill-bundle-manifest`.
- [ ] **Step 3:** empty the baseline; `pnpm run verify:rebrand-cli-gate` green with `baselineCount 0` → the gate is now zero-tolerance.
- [ ] **Step 4: Commit** `feat(rebrand): skill corpus invokes alicorn; guide aliases for orca-* names; CLI gate zero-tolerance`.

---

### Task 6 (R4-gate + shim): Env compat layer and `verify:rebrand-env-gate`

**Files:** Create `src/shared/alicorn-env-compat.ts` + test, `config/scripts/verify-rebrand-env-gate.mjs` + test, `config/rebrand-env-baseline.txt`; `package.json` script + `lint` chain.
```ts
// alicorn-env-compat.ts
export function readAlicornEnv(env: NodeJS.ProcessEnv, name: `ALICORN_${string}`): string | undefined {
  // Why: hooks and PTYs started by the previous release still export ORCA_*; read both for one release.
  return env[name] ?? env[name.replace(/^ALICORN_/, 'ORCA_')]
}
export function withLegacyEnvAliases(env: Record<string, string>): Record<string, string> // adds ORCA_X = ALICORN_X for every ALICORN_ key (for env we *export* to child processes this release)
```
Gate: scans `src/**/*.{ts,tsx,mjs,cjs}`, `config/**`, `.github/**`, `cloud/apps/{control-api,ledger-api}/**`, `cloud/packages/**` for `\bORCA_[A-Z0-9_]+`; allowlist: `src/shared/alicorn-env-compat.ts`, `cloud/apps/relay*/**`, `cloud/infra/**`, `.github/workflows/cloud-*.yml` (relay stack — BC1); shrink-only baseline seeded with today's findings.
- [ ] Tests for both; gate green with baseline; commit `ci: rebrand env gate and ALICORN_/ORCA_ compat readers`.

---

### Task 7 (R4): `ORCA_*` → `ALICORN_*` codemod, hook version bump

**Files:** Create `config/scripts/rename-orca-env.mjs` (one-shot; tested on a fixture); Modify ~all files with `ORCA_*` identifiers outside the allowlist (963 identifiers; the top 30 in the research); `src/shared/agent-hook-endpoint-file.ts` (parse `ALICORN_AGENT_HOOK_VERSION`, accept `ORCA_AGENT_HOOK_VERSION` via `readAlicornEnv`; bump the version *value* — find the current constant and add 1 — so old-name endpoint files are treated as outdated); every per-backend hook script writer in `src/main/{claude,codex,cursor,gemini,grok,devin,droid,copilot,command-code}/*hook*.ts` emits `ALICORN_*` **and** `ORCA_*` (via `withLegacyEnvAliases`) this release; `src/main/pty/wsl-orca-env.ts` → `wsl-alicorn-env.ts`; `src/relay/agent-hook-endpoint-coordinates.ts`; `config/rebrand-env-baseline.txt` → empty.
- [x] **Step 1:** run the codemod (`--check` first, prints counts per dir); review template-literal prefixes (`ORCA_WEB_CLIENT__`, `ORCA_REMOTE_PLATFORM__`) by hand.
- [x] **Step 2:** failing tests updated first for the hook endpoint file (old-name file parses; new-name file parses; version mismatch → reinstall required), then implement.
- [x] **Step 3:** `pnpm tc && pnpm test` (full suite — this touches everything; expect ~15 min); `pnpm run verify:rebrand-env-gate` with an empty baseline → zero-tolerance; `pnpm lint`.
  **As built:** the baseline is 2 rows, not empty. `secrets.ORCA_POSTHOG_WRITE_KEY` names a GitHub *secret store* entry that only a human renames in repository settings, and a missing secret resolves to the empty string with no error. Both spellings are read (`ALICORN_… || ORCA_…`) until then. Those two rows are baselined rather than allowlisted: exempting the whole workflow file would blind a 1300-line file to a genuinely new name — R3's lesson from run 6.
- [x] **Step 4: Commit** `feat(rebrand): ALICORN_* environment (all 963 identifiers) with one-release ORCA_* aliases`.

---

### Task 8 (R4): Versioned hook reinstall across hosts + unreachable-host report

**Files:** Create `src/main/hooks/hook-reinstall-sweep.ts` + test; Modify the startup path that installs hooks today (`src/main/startup/*` — locate where each backend's `hook-service.ts` `ensureInstalled` is invoked), SSH hook installers (`src/main/ssh/*hook*`, WSL installers), renderer notice surface (a toast via the existing hook-status channel).
```ts
export type HookReinstallHost = { kind: 'local' } | { kind: 'wsl'; distro: string } | { kind: 'ssh'; connectionId: string }
export type HookReinstallOutcome = { host: HookReinstallHost; status: 'reinstalled' | 'current' | 'unreachable'; detail?: string }
export async function sweepHookReinstall(input: { hosts: HookReinstallHost[]; expectedVersion: number; probe: (h) => Promise<number | null /* installed version, null = unreachable */>; install: (h) => Promise<void> }): Promise<HookReinstallOutcome[]>
```
Model on `src/main/ssh/ssh-relay-versioned-install.ts` (immutable version dir + `.install-complete` marker + lock). Unreachable hosts are reported, never assumed done (ROADMAP risk *Stale hooks after the env rename*); verdict vocabulary stays `live`/`unverifiable`/`exited` for SSH liveness (`docs/reference/ssh-execution-boundary.md`).
- [ ] Tests: current → no install; older → install; probe null → `unreachable` with detail; install throws → `unreachable`; startup surfaces the list. Commit `feat(rebrand): versioned hook reinstall across local, WSL and SSH hosts with an unreachable-host report`.

---

### Task 9 (L1): Localisation — brand strings and a stale-translation audit

**Files:** Modify `src/renderer/src/i18n/locales/{en,es,fr,ja,ko,zh}.json` (≈3680 "Orca"-bearing values; product name → Alicorn; **command names** already changed by Task 4/5 where they appear in copy), `config/scripts/locale-brand-mistranslations.mjs` (Alicorn set; inverted check for lingering `Orca` forms); Create `config/scripts/audit-stale-translations.mjs` + test, `src/renderer/src/i18n/locales/.source-hashes.json` (written by `sync:localization-catalog`; `sha1(en value)` per key); `package.json` `verify:localization-stale` in the `lint` chain.
- [ ] Stale audit: a key whose current `en` hash ≠ the stored hash while a locale value is unchanged since the stored snapshot → reported; `--fix` snapshots hashes after re-translation. Tests on a fixture catalog.
- [ ] Re-translate: run the existing pipeline (`sync:localization-catalog`) for the English change, then translate per locale (the team's translation workflow; the audit lists exactly which keys). `verify:localization-coverage`, `verify:localization-catalog`, `verify:localization-stale` green.
- [ ] Commit `feat(rebrand): Alicorn in all catalogs; stale-translation audit`.

---

### Task 10 (BC2): Backend endpoints off alicorn.8seneca.com

**Files:** Modify `src/main/orca-profiles/profile-cloud-auth-config.ts` (`PRODUCTION_API_BASE_URL 'https://login.alicorn.8seneca.com'` — placeholder host to be confirmed by Huy; `PRODUCTION_CLIENT_ID 'alicorn-desktop'`; `PRODUCTION_RELAY_DIRECTOR_URL`), `artifact-cloud-config.ts` (`PRODUCTION_ARTIFACTS_API_URL` + the hostname allowlist), `plugin-kill-list-service.ts`, `feedback.ts`, `telemetry.ts` (`PRIVACY_URL`), `updater/updater-release-feed.ts` + `updater-prerelease-feed.ts` (`ATOM_FEED_URL`, `RELEASES_DOWNLOAD_BASE`; `TAG_HREF_RE` accepts `stablyai/orca` **and** `8seneca-hub/alicorn` for two releases — decision 3), electron-builder `publish` block (Task 3 already set owner/repo).
- [ ] Failing tests per file (each has a `.test.ts` sibling): new production defaults; allowlist accepts the new host and rejects `alicorn.8seneca.com`; feed regex parses both owners. Implement. `pnpm test src/main/updater src/main/orca-profiles/profile-cloud-auth-config.test.ts src/main/artifact-cloud-config.test.ts …`.
- [ ] Dual-feed mechanics documented in `docs/alicorn/RELEASE-CUTOVER.md` (new, short): order of operations for the first Alicorn release (publish to the new repo; mirror the release to the old repo's feed for two releases; last Orca-branded build's notes link the new installer).
- [ ] Commit `feat(rebrand): production endpoints on Alicorn hosts; dual update feed for two releases`.

---

### Task 11 (DS1–DS3): Distribution

**Files:** `.github/workflows/release-mac-build.yml` (Alicorn Apple Team secrets: `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`/`CSC_KEY_PASSWORD` — names unchanged, values re-issued by Huy), `config/electron-builder.config.cjs` `extendInfo` copy (Task 3) and `win.signtoolOptions.publisherName` → the Alicorn SignPath identity (**only in the release that goes out with the new SignPath project — decision 2**), `.github/workflows/windows-signing-rehearsal.yml` (Alicorn SignPath org/project/policy slugs from secrets), `deb`/`rpm` names (Task 3).
- [ ] DS1: run `release-mac-build.yml` on a branch with the new secrets → notarised, stapled `.dmg`; `spctl -a -vv` accepts.
- [ ] DS2: run `windows-signing-rehearsal.yml` → signed installer; `Get-AuthenticodeSignature` subject = the new identity; `verifyUpdateCodeSignature` path exercised once against `publisherName`.
- [ ] DS3: `pnpm run build:linux` → `afterPack` glibc gate passes for `alicorn-ide` packages (no code change expected; confirm and record).
- [ ] Commit `ci(rebrand): Alicorn signing and notarisation identities` (values live in secrets, not in the repo).

---

### Task 12 (BC1): Relay on Alicorn infrastructure

**Files:** `cloud/infra/terraform/environments/{staging,production}.tfvars` (new `project_id`, `name_prefix 'alicorn-cloud'`, `github_repo 'alicorn'`, `auth_base_url`, `relay_base_url`), `backend/*.hcl` (new state bucket), `relay-dns.tf` (new domain mapping), `cloud/apps/relay-ops/src/environment-config.ts` (parsing mirrors), `ORCA_RELAY_*` → `ALICORN_RELAY_*` across `cloud/apps/relay*/**`, `cloud/README.md`, `.github/workflows/cloud-*.yml`; remove the relay allowlist from `verify-rebrand-env-gate` afterwards.
- [ ] `terraform plan` against staging in the new project (Huy runs `pnpm infra:plan` with credentials); relay suite green with `ALICORN_RELAY_TEST_POSTGRES_URL`; `cloud-verify.yml` green; env gate zero-tolerance everywhere.
- [ ] Commit `feat(relay): Alicorn infrastructure and ALICORN_RELAY_* configuration`.

---

### Task 13 (R5): The upstream cut

**Files:** Create `UPSTREAM_BASE` (`tag=<upstream release tag>\nsha=<40-hex>\ndate=<YYYY-MM-DD>\npolicy=cherry-pick-only`), `docs/alicorn/UPSTREAM.md` (how to add the `upstream` remote — local only, never committed — and the cherry-pick procedure: security fixes and platform bugs, one PR each, `docs/reference` notes and ratchets updated with them); fill the `NOTICE` fork line (Task 3).
- [ ] Precondition check (record in the commit body): `pnpm run verify:rebrand-cli-gate` and `verify:rebrand-env-gate` green with **empty** baselines in CI on `main`; `pnpm run check:runtime-electron-ratchet` and `pnpm test src/shared/child-process/child-process-import-boundary.test.ts` green; all 24 `docs/reference/*.md` present.
- [ ] `git fetch upstream` (`git remote add upstream https://github.com/stablyai/orca.git` locally) and record the last merged tag/SHA (`git merge-base upstream/main HEAD`).
- [ ] Commit `chore: upstream cut — record UPSTREAM_BASE, cherry-pick policy` and comment on Plane R5 with the tag + SHA.

---

## Self-review

- **Spec coverage.** R1 (Task 3), R2 (4), R3 (2, 5), R4 (6, 7, 8), R5 (13), L1 (9), BC1 (12), BC2 (10), DS1–DS3 (11); bookkeeping (1). ROADMAP risks *EV certificate lead time* (decision 2 — SignPath instead; still start now), *Stale hooks* (Task 8), *Missed CLI call site* (Task 2/5). CLAUDE.md fork posture: cut last, hazard notes and ratchets kept, MIT attribution (NOTICE).
- **Placeholders.** Hosts (`login.alicorn.8seneca.com`) and the legal entity are explicitly "to be confirmed by Huy" and flagged in Plane, not invented silently; everything else names files, functions, tests, commands.
- **Type consistency.** `readAlicornEnv`/`withLegacyEnvAliases` (Task 6) are what Task 7's hook writers and Task 8's probes use; `getAlicornCliCommandNameForPlatform` (Task 4) is what Task 5's rewritten guides assume; `OrchestrationCliCommand` widened union is read by `resolveTerminalOrchestrationCliCommand` unchanged.
- **Order.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Tasks 9–12 are independent of each other after 7.
