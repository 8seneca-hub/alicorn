# Rebrand, cutover & distribution — research notes

Plane items: R1–R5, L1, BC1, BC2, DS1–DS3 (v0.1, owner Huy). Read-only research; all paths
relative to repo root unless noted. Commands were run from
`/Users/huy/Workspaces/8seneca/alicorn/.claude/worktrees/alicorn-tier-1`.

## 1. Inventory

| Area | Count | Command |
|---|---|---|
| Bare `orca ` invocations in skill corpus | **428** | `grep -rEo "(^\|[^a-zA-Z_/-])orca [a-z]" skills skill-guides skill-stubs src/cli/bundled-skill-guides.ts \| wc -l` |
| — by directory | skills:14, skill-guides:282, skill-stubs:4, `src/cli/bundled-skill-guides.ts`:128 | same pattern, one dir at a time |
| Distinct `ORCA_[A-Z0-9_]+` identifiers | **963** | `grep -rhoE "ORCA_[A-Z0-9_]+" src cloud mobile config .github \| sort -u \| wc -l` |
| `onorca.dev` / `stably` references in `src`+`cloud` `.ts` | **1675** | `grep -rn "onorca\|stably" src cloud --include=*.ts \| wc -l` (includes bundle-id-shaped test fixtures like `stablyai.orca.helper`, not all are URLs — see §7) |
| Locale catalog entries containing "Orca" | en 713, es 570, fr 673, ja 558, ko 584, zh 582 (**≈3680 total**, one string can hit multiple catalogs) | `grep -c "Orca" src/renderer/src/i18n/locales/<lang>.json` |
| Locale catalog file sizes | en 889KB, es 824KB, fr 948KB, ja 948KB, ko 865KB, zh 754KB | `ls -la src/renderer/src/i18n/locales/` |
| Mobile i18n catalogs | **none found** — `mobile/` has no `locales/*.json`; branding lives directly in `mobile/app.json` and components (`OrcaLogo.tsx`) | `find mobile -iname "*.json" -path "*locale*"` (empty) |

Top 30 `ORCA_*` identifiers by occurrence count (same command as above, `sort \| uniq -c \| sort -rn \| head -30`):
`ORCA_PANE_KEY`(355), `ORCA_USER_DATA_PATH`(301), `ORCA_AGENT_HOOK_PORT`(243), `ORCA_CODEX_HOME`(241),
`ORCA_AGENT_HOOK_TOKEN`(227), `ORCA_TERMINAL_HANDLE`(221), `ORCA_TAB_ID`(174), `ORCA_AGENT_HOOK_ENDPOINT`(173),
`ORCA_WORKTREE_ID`(160), `ORCA_RELAY_ADMIN_ID_TOKEN`(149), `ORCA_WEB_CLIENT__`(137, a template-literal
prefix — grep can't see the interpolated suffix), `ORCA_ORIG_ZDOTDIR`(121), `ORCA_REMOTE_PLATFORM__`(113,
same template-prefix caveat), `ORCA_ROOT_PATH`(104), `ORCA_SHELL_FEATURES`(103), `ORCA_BROWSER_BLANK_URL`(101),
`ORCA_WORKTREE_PATH`(97), `ORCA_AGENT_LAUNCH_TOKEN`(97), `ORCA_OMP_STATUS_EXTENSION`(89), `ORCA_HISTFILE`(83),
`ORCA_CODEX_LAUNCH_PREFLIGHT`(80), `ORCA_OPENCODE_CONFIG_DIR`(73), `ORCA_AGENT_HOOK_VERSION`(71),
`ORCA_AGENT_HOOK_ENV`(70), `ORCA_E2E_FORWARD_APP_LOGS`(54), `ORCA_E2E_WEB_CLIENT`(51),
`ORCA_PI_SOURCE_AGENT_DIR`(46), `ORCA_PI_PREFILL`(45), `ORCA_PI_CODING_AGENT_DIR`(45), `ORCA_MIMOCODE_HOME`(45).

## 2. Existing code map

### App identity (R1)
- `config/electron-builder.config.cjs` is the *only* source of packaging identity — `package.json`
  has no `build` key at all. Key literals: `appId = 'com.stablyai.orca'` (:65), `productName: 'Orca'`
  (:152), `protocols: [{ name: 'Orca', schemes: ['orca'] }]` (:153), `win.executableName: 'Orca'`
  (:392, Windows publisherName pinned to `'SignPath Foundation'`, :406 — see DS2), `linux.executableName:
  'orca-ide'` (:547, deliberately not `orca` — Ubuntu's GNOME Orca a11y tool owns `/usr/bin/orca`),
  `StartupWMClass: 'orca'` (:555), `deb`/`rpm` `packageName: 'orca-ide'` (:585, :608), `publish: {
  provider: 'github', owner: 'stablyai', repo: devChannelRepo ?? 'orca' }` (:632-637), dev-channel
  repos `orca-hourly`/`orca-daily`/`orca-adhoc` (:58-64). A code comment (:23-25) warns dev-channel
  builds must keep the **same** bundle id and signing identity as release or Squirrel.Mac/macOS treat
  every build as a new app — renaming `appId` is an update-continuity break, not a cosmetic edit.
- Icons: `resources/build/icon.{icns,ico,png}` (builder-consumed), source in
  `resources/icon-source/icon.icon/` + `generate.sh` (`build:icons`). Also
  `resources/{icon,icon-dev}.png`, `resources/app-icons/{orca-blue,orca-watercolor}.png`,
  `resources/minimax-icon.svg` — look like unused alternates; confirm before assuming dead.
- Protocol scheme `orca://` is used for **mobile pairing deep links**, not just OS registration:
  `src/renderer/src/web/web-pairing.ts` parses `orca://pair?code=...`/`orca://pair#...`;
  `WebConnect.tsx`, `AddRemoteHostFields.tsx`, `RuntimeHostAccessForm.tsx` show it as placeholder
  copy; `skill-share-link.test.ts` parses `orca://skills/share/...`. **No `setAsDefaultProtocolClient`
  call site found in `src/`** — OS registration appears purely electron-builder-declarative; confirm
  with a broader search before assuming the scheme rename is config-only. ~15 test files hardcode the
  literal and must move with it.
- `LICENSE` copyright reads **"Copyright (c) 2026 Lovecast Inc."** (not "stablyai") — confirm the
  authoritative entity before writing `NOTICE` (none exists yet).
- No dedicated wordmark component; `src/renderer/src/components/status-bar/icons.tsx` is the closest
  renderer icon asset. Most user-facing product-name strings route through i18n `translate()`, not
  hardcoded JSX — confirm per-component during implementation.
- Mobile has its **own** identity, not enumerated in the Plane items: `mobile/app.json` — `name:
  "Orca"`, `slug: "orca-mobile"`, `scheme: "orca"`, `bundleIdentifier`/`package:
  "com.stably.orca.mobile"`. Flagged as an open question (§5).

### CLI naming (R2)
- `package.json` `bin`: `{"orca": "./out/cli/index.js", "orca-dev": "./config/scripts/orca-dev.mjs"}`.
- Platform-specific binary name is centralized in one seam: `src/shared/orca-cli-command-name.ts` →
  `getOrcaCliCommandNameForPlatform(platform)` returns `'orca-ide'` (linux), `'orca.cmd'` (win32),
  `'orca'` (else) — the natural place to add a compat-shim return value.
- `OrchestrationCliCommand` (`src/main/runtime/orchestration/cli-command.ts:5`) is a **closed union**
  `'orca' | 'orca-ide'` returned by `resolveTerminalOrchestrationCliCommand()`; a small (26-line),
  well-isolated file — widen the union or replace the literals.
- `src/main/cli/cli-install-constants.ts`: `DEFAULT_MAC_COMMAND_PATH = '/usr/local/bin/orca'`,
  `DEV_COMMAND_NAME = 'orca-dev'`, `LEGACY_LINUX_COMMAND_NAME = 'orca'` — the `LEGACY_` prefix is an
  existing precedent for keeping an old name around during a transition; reuse it for the compat shim.
- `src/main/cli/` (≈40 files) owns cross-platform install/registration: `cli-installer.ts`
  (orchestrator), `wsl-cli-installer.ts`+`wsl-cli-scripts.ts` (builds the WSL bash launcher + a
  PowerShell bridge, both stamped with a `# Orca managed WSL CLI ...` marker comment used to
  detect/replace a prior install), `windows-user-path-registry.ts`, `linux-terminal-orca-cli-shim.ts`,
  `linux-bare-orca-dispatcher.ts`, `appimage-*` (AppImages aren't on PATH by default),
  `cli-installer-contracts.ts`.
- `src/main/pty/wsl-orca-env.ts` injects `ORCA_*` env vars into WSL PTY sessions — the WSL side of
  R4, distinct from the R2 binary rename.
- `CliSection.tsx`/`WslCliRegistration.tsx` (`src/renderer/src/components/settings/`) are the Settings
  UI panels for install/uninstall/repair; strings route through i18n.
- `ORCA_TERMINAL_HANDLE`/`ORCA_PANE_KEY`: stamped onto every spawned terminal/PTY so agent hooks can
  attribute events to a tab/pane. Read in `src/renderer/src/components/terminal-pane/**`,
  `src/shared/agent-status-identity.ts`, `orchestration-compatibility-evidence.ts`; written in
  `launch-worktree-background-terminals.ts`, `pane-manager-pane-creation.ts`. Nested child-agent CLIs
  inherit these from the parent shell — renaming without a transition window breaks any hook script
  still grepping for the old name mid-flight.

### Skill corpus & verification scripts (R3)
- 428 bare-`orca` call sites (see §1); `skill-guides/` (282, canonical guide bodies) dominates.
  `src/cli/bundled-skill-guides.ts` (128) looks generated/round-tripped from `skill-guides/` —
  confirm before hand-editing.
- `config/scripts/generate-bundled-skill-guides.mjs` (`--write`/`--check` via
  `generate:`/`verify:bundled-skill-guides`) owns `CANONICAL_GUIDE_NAMES` (`'orca-cli'`,
  `'orca-emulator'`, `'orca-emulator-android'`, `'orca-linear'`, `'orca-per-workspace-env'` — the
  *topic names* themselves are branded, distinct from invocation text inside bodies) and a
  `GUIDE_ALIASES` map explicitly built for renames ("add entries for renames, but never remove
  them") — the exact mechanism for `orca-cli → alicorn-cli` aliasing without breaking older installed
  stubs. `STUB_TOPICS` + `skill-stubs/<topic>.md` is the hybrid discovery-stub projection.
- `config/scripts/generate-skill-bundle-manifest.mjs` produces three schema-versioned,
  content-addressed artifacts under `resources/skills/` (`current-manifest.json` v2,
  `snapshot-registry.json` v1, `release-mapping.json` v1) — a rename just needs a regen, no
  special-casing.
- **Where `verify:rebrand-cli-gate` plugs in**: `package.json`'s `lint` chain is a flat `&&`-chain:
  `oxlint → audit:code-quality:{native,type-aware} → check:reliability-gates →
  check:{max-lines,ts-nocheck,runtime-electron}-ratchet → verify:bundled-skill-guides →
  verify:skill-bundle-manifest → verify:localization-{catalog,runtime-catalog,extraction,coverage}`.
  Append `pnpm run verify:rebrand-cli-gate` (new `config/scripts/verify-rebrand-cli-gate.mjs`) right
  after the skill-guide/manifest verifies, since it operates on the same trees. Model it on
  `check-runtime-electron-ratchet.mjs`'s baseline-file pattern if the gate must land before R3's
  rewrite is 100% complete; otherwise a hard zero-tolerance `grep -c` matches the plan's literal ask.

### Env vars & hooks (R4)
- 963 distinct `ORCA_*` identifiers (§1). A hook-protocol **version already exists**:
  `ORCA_AGENT_HOOK_VERSION` (71 occurrences, written by every per-backend hook script under
  `src/main/{claude,codex,cursor,gemini,grok,devin,droid,copilot,command-code}/`) is read back by
  `src/shared/agent-hook-endpoint-file.ts` (`parseAgentHookEndpointFile` throws if missing) and
  `agent-hook-listener/endpoint-publication.ts`; the relay's copy
  (`src/relay/agent-hook-endpoint-coordinates.ts:55`) sets it from `ORCA_HOOK_PROTOCOL_VERSION`.
  **This is the reuse target for R4's "hook version" requirement** — the plumbing exists; renaming
  needs (a) the env-var name changed everywhere referenced, (b) a decision on whether the *value*
  also bumps to signal old- vs. new-name scripts to older/newer builds.
- Hook installers per backend: `src/main/<backend>/hook-service.ts` (+ backend variants — `codex-hook-*.ts`
  is largest: trust-grant/promotion/rebase/cleanup, WSL install, remote install). Shared plumbing:
  `agent-hook-endpoint-file.ts` (format `{port, token, env, version}`, files `endpoint.env`/`.cmd`),
  `agent-hook-listener.ts`, `agent-hook-relay.ts`, `managed-agent-hook-targets.ts`,
  `hook-command-source-policy.ts`.
- **No existing "startup check that reports unreachable hosts" for hook status found** under
  `src/main/ssh/` — only unrelated network-error classification and SSH liveness-verdict language
  (`live`/`unverifiable`/`exited` per `docs/reference/ssh-execution-boundary.md`) turned up. Likely
  **new work**; confirm with a broader search before scoping as an extension.
- Reuse candidate for *how* to do versioned reinstall: `src/main/ssh/ssh-relay-versioned-install.ts`
  already implements immutable `(version+content-hash)` install dirs (VS Code
  `~/.vscode-server/bin/<commit>/`-style) with an install-lock and a `.install-complete` marker, and
  `readLocalFullVersion()` fails loudly rather than silently reusing a stale generation. Strongest
  structural precedent for R4's cross-host versioned hook reinstall.

### Upstream tracking (R5)
- `git remote -v` → only `origin https://github.com/8seneca-hub/alicorn.git`; no `upstream` remote —
  cherry-picking from stablyai/orca needs one added first.
- No `UPSTREAM_BASE` (or any `UPSTREAM*`) file exists at repo root — new work.
- `docs/reference/*.md` — 24 files (`admin-agent-skill-sharing.md` … `xterm-patch-regeneration.md`,
  full alphabetical list omitted for space; `find docs/reference -maxdepth 1 -type f` reproduces it).
  Per CLAUDE.md, all must survive the cut, along with their ratchet tests.
- The child_process ratchet AGENTS.md refers to is
  **`src/shared/child-process/child-process-import-boundary.test.ts`** — reads allowlist
  `__fixtures__/child-process-import-allowlist.txt`, compares against pinned `DIRECT_IMPORTER_PIN =
  158` ("may only ever be DECREASED"). A second, differently-scoped ratchet
  (`config/scripts/check-runtime-electron-ratchet.mjs`, baseline `config/runtime-electron-baseline.txt`,
  esbuild-based Electron-import reachability) is the same baseline-file shape — useful as a second
  model for R3's CI gate.

### Localisation (L1)
- Catalogs: `src/renderer/src/i18n/locales/{en,es,fr,ja,ko,zh}.json` (sizes/counts in §1), plus
  `en-runtime-required.json` (generated by `verify:localization-runtime-catalog` →
  `generate-runtime-required-english-catalog.mjs`).
- `config/scripts/localize-renderer-strings.mjs` is the "write plain English, run this" tool —
  extracts candidates via `collectLocalizationCandidates()` (from `audit-localization-coverage.mjs`),
  generates a stable `auto.<file-segment>.<sha1>` key, wires in `translate()`.
- `audit-localization-coverage.mjs` (`verify:localization-coverage`) audits *coverage* (untranslated
  strings), not *staleness* (translated value whose English source changed) — **no existing script
  does staleness**; L1's "stale-translation audit" looks like new work. The per-locale
  `locale-*-{key,value}-overrides.mjs`/`locale-*-phrase-fixes.mjs` family (~15 files) is the existing
  patch mechanism a rebrand's overrides would slot into.
- **Directly reusable for the brand-name half of L1**: `config/scripts/locale-brand-mistranslations.mjs`
  maintains a `BRAND_MISTRANSLATIONS` map per locale that reverts machine-mistranslations of `Orca`
  back to Latin (e.g. Korean `오르카`/`범고래` → `Orca`) — extend with Alicorn's own set, and invert it
  to flag rows still emitting the *old* brand's mistranslation forms post-rebrand (proof the English
  source changed but the translation didn't).
- Mobile has **no separate locale catalog** — its "Orca" strings are English-only, hardcoded in
  `mobile/app.json`/`OrcaLogo.tsx`.

### Backend endpoints (BC2)
- Distinct hosts (`grep -rhoE "[a-zA-Z0-9.-]*onorca\.dev|stably[a-zA-Z0-9.-]*\.[a-z]+" src cloud --include=*.ts | sort -u`):
  `onorca.dev`, `www.onorca.dev`, `api.onorca.dev`, `login.onorca.dev`, `auth-staging.onorca.dev`,
  `share.onorca.dev`, `relay.onorca.dev`, `relay-staging.onorca.dev`, `relay-c1/c2.onorca.dev`,
  `c2/c9/c27/c28/c29.relay.onorca.dev`, `stably.ai`. (The 1675 raw count in §1 also matches
  `stablyai.orca*` **bundle-id-shaped test fixtures**, e.g. `stablyai.orca.helper` — not endpoints,
  don't conflate when scoping BC2.)
- Production-endpoint definition sites: `src/main/orca-profiles/profile-cloud-auth-config.ts`
  (`PRODUCTION_API_BASE_URL = 'https://login.onorca.dev'`, `PRODUCTION_CLIENT_ID = 'orca-desktop'`,
  `PRODUCTION_RELAY_DIRECTOR_URL = 'https://relay.onorca.dev'`, all overridable via
  `ORCA_CLOUD_*`/`ORCA_RELAY_URL` but hardcoded for packaged builds); `artifact-cloud-config.ts`
  (`PRODUCTION_ARTIFACTS_API_URL = 'https://share.onorca.dev'`, plus a hardcoded allowlist check
  `hostname === 'onorca.dev' || hostname.endsWith('.onorca.dev')` that must move with any new host);
  `plugin-kill-list-service.ts:9` (`PLUGIN_KILL_LIST_URL = 'https://onorca.dev/plugins/kill-list.json'`);
  `feedback.ts:17` (`FEEDBACK_API_URL = 'https://www.onorca.dev/v1/feedback'`);
  `telemetry.ts:11` (`PRIVACY_URL = 'https://www.onorca.dev/docs/telemetry'`).
- `updater/updater-release-feed.ts:206` and `updater-prerelease-feed.ts:5-13`
  (`ATOM_FEED_URL`/`RELEASES_DOWNLOAD_BASE`/`TAG_HREF_RE`) hardcode `github.com/stablyai/orca` —
  `TAG_HREF_RE` is a regex matched **against fetched Atom feed content**, a parse-time dependency on
  the repo string, not just a config constant (see Risk #3). Electron-builder's own `publish` block
  (:632-637) is the updater's authoritative feed source for `app-update.yml`; confirm which path is
  actually live before assuming both need identical edits.

### Distribution (DS1–DS3)
- Workflows: `release-mac-build.yml` (+ `hourly`/`daily`/`adhoc-mac-build.yml`),
  `windows-signing-rehearsal.yml`, `dev-channel-win-build.yml`. No dedicated `*linux*.yml` release
  workflow found; Linux packaging runs via `pnpm run build:linux`, and the glibc gate lives in
  electron-builder's `afterPack` hook regardless of caller (CI-agnostic).
- **macOS (DS1)**: `release-mac-build.yml` sets `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/
  `APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`; electron-builder's `notarize: isMacRelease` /
  `hardenedRuntime: isMacRelease` (config/electron-builder.config.cjs:481,489) auto-notarize when
  present. **Largely already built** — the task is re-pointing the Apple Developer Team/cert to
  Alicorn's account and updating the `extendInfo` usage-description copy (:456-476, currently "Orca
  allows terminal-launched developer tools to...").
- **Windows (DS2)**: signing is **not** raw `signtool`/`WIN_CSC_*` — it's **SignPath**, a hosted
  signing service (`windows-signing-rehearsal.yml` uploads unsigned binaries, downloads them signed,
  verifies subject `CN=SignPath Foundation`). electron-builder's `win.signtoolOptions.publisherName:
  'SignPath Foundation'` (:406) is what electron-updater checks the *installed* app's
  `app-update.yml` against — this string must change with whatever SignPath identity Alicorn
  provisions, or updates silently stop verifying. The plan's literal phrasing ("Windows EV
  certificate + signing") doesn't match this mechanism — see Risk #2.
- **Linux (DS3)**: floor check already exists and is enforced — `verify-linux-glibc-floor.cjs`
  (`MIN_GLIBC = [2,31]`, plus `GLIBCXX_`/`CXXABI_`), called from `afterPack` only on linux
  (:284-289), with a documented `sherpa-onnx` exemption. Full narrative in
  `docs/reference/linux-glibc-compatibility.md`. **Needs no new mechanism** — keep working through
  the rebrand, don't build it.

### Relay infra (BC1)
- `cloud/infra/terraform/` — `variables.tf` (`project_id`, `manage_relay_domain_mapping`,
  `relay_gce_domain`), `relay-dns.tf` (Cloud Run domain mapping, Google-managed cert), `relay.tf`,
  `relay-shared.tf`, `relay-database.tf`, `relay-gce-*.tf`, `relay-github-*.tf`,
  `relay-observability.tf`, `relay-fence-broker.tf`, `relay-asia-*-iam.tf`,
  `environments/{production,staging}.tfvars`, `backend/{production,staging}.hcl`.
  `environments/production.tfvars`: `project_id = "onorca-cloud"`, `name_prefix = "orca-cloud"`,
  `github_repo = "orca"`, `auth_base_url = "https://login.onorca.dev"`,
  `relay_cloud_run_service_name = "orca-cloud-relay"`, `relay_base_url = "https://relay.onorca.dev"`.
  **A new GCP project + domain is a `.tfvars`+DNS/cert change, not a code change** — provision the
  project, update `backend/*.hcl` (remote state location) and `.tfvars`, cut DNS over.
- `cloud/apps/relay-ops/src/environment-config.ts` mirrors the Terraform shape in TypeScript,
  parsing values back out of Terraform config text via regex (`relayOpsCellsFromTerraform`) rather
  than a shared source of truth — both sides need matching edits.
- `cloud/README.md` gates cloud-ops CI on `vars.ORCA_CLOUD_OPERATIONS_ENABLED`, documents
  `ORCA_RELAY_ROLE`/`ORCA_RELAY_TEST_POSTGRES_URL`/`ORCA_RELAY_ASSIGNMENT_SIGNING_KEY` — all
  `ORCA_*` per current convention. Per CLAUDE.md, new Alicorn services (`control-api`, `ledger-api`
  under `cloud/apps/` — tier-1 control-plane, unrelated to this plan) already use `ALICORN_*`/
  `@alicorn-cloud/*`; only the **existing relay stack** (`relay`, `relay-fence-broker`, `relay-ops`)
  carries the legacy `ORCA_RELAY_*` names BC1 targets.

## Mechanisms to reuse

| Need | Existing mechanism | Location |
|---|---|---|
| CI gate that fails on a forbidden literal, shrink-only baseline | ratchet-with-baseline-file pattern | `config/scripts/check-runtime-electron-ratchet.mjs` (baseline: `config/runtime-electron-baseline.txt`), `child-process-import-boundary.test.ts` (baseline: `__fixtures__/child-process-import-allowlist.txt` + numeric pin) |
| Skill-name rename without breaking old installs | alias registry, additive-only | `GUIDE_ALIASES` in `config/scripts/generate-bundled-skill-guides.mjs` |
| Content-addressed manifest regen after bulk text edits | existing generator, just re-run | `config/scripts/generate-skill-bundle-manifest.mjs` (`generate:skill-bundle-manifest`) |
| Reverting machine-mistranslated brand names per locale | existing per-locale brand map | `config/scripts/locale-brand-mistranslations.mjs` |
| Versioned, crash-safe reinstall across local/WSL/SSH hosts | immutable content-hash install dirs + install-lock + probe | `src/main/ssh/ssh-relay-versioned-install.ts`, `ssh-relay-install-lock.ts` |
| Env-var-driven prod endpoint override with a hardcoded packaged-build default | pattern repeated 5+ times | `profile-cloud-auth-config.ts`, `artifact-cloud-config.ts`, similarly-shaped files in §"Backend endpoints" |
| Per-platform CLI binary name resolution (single seam) | one pure function | `src/shared/orca-cli-command-name.ts` |
| Glibc/libstdc++ packaging floor enforcement | already built, `afterPack` hook | `config/scripts/verify-linux-glibc-floor.cjs` |
| macOS notarization/signing already wired | `isMacRelease` gated flags | `config/electron-builder.config.cjs:481-489`, `release-mac-build.yml` |
| Terraform environment parameterization for a new project/domain | `.tfvars` + `backend/*.hcl` per environment | `cloud/infra/terraform/environments/`, `cloud/infra/terraform/backend/` |

## Constraints (from AGENTS.md / docs/reference / CLAUDE.md)

- **WSL**: any new/edited orca→alicorn WSL launcher script must keep using `buildWslExecArgs`
  (`--exec`) and fence stdout-parsing paths with `buildWslCapturedLoginShellCommand` per
  `docs/reference/wsl-command-execution.md`. `wsl-cli-scripts.ts`'s existing bridge already shells
  out to `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...` — **this is a pre-existing
  `-ExecutionPolicy Bypass` usage** that `docs/reference/windows-edr-posture.md` calls out as an EDR
  smell; a rebrand touching this file should not casually copy the pattern into new scripts without
  reading that doc, but also should not silently "fix" it as a drive-by change (surgical-changes
  principle) unless R2/R4 explicitly plans to touch EDR posture.
- **Windows**: no direct `child_process` in new CLI/hook-rename code — the ratchet in
  `child-process-import-boundary.test.ts` (pin 158, shrink-only) will fail the build on a new import;
  route through `runProcess`/`spawnProcess` in `src/shared/child-process/`.
- **Linux glibc floor**: any native module touched incidentally while rebranding packaging scripts
  must stay under Ubuntu 20.04 / glibc 2.31 — enforced automatically, not a manual check.
- **Windows EDR posture**: do not introduce `-ExecutionPolicy Bypass`, `-EncodedCommand`, or runtime
  `Add-Type` in *new* code for R2/R4/DS2 without reading `docs/reference/windows-edr-posture.md`
  first (existing WSL bridge already uses Bypass — see above; don't propagate the pattern further).
- **Remote wire compatibility**: `updater-prerelease-feed.ts`'s Atom-feed-URL regex and the update
  feed base URL are effectively a wire contract between old (`stablyai/orca`) and new
  (`alicorn`-owned repo) clients/hosts — per `docs/reference/remote-wire-compatibility.md`, an old
  client polling the old feed must not silently stop being told about updates the moment the repo
  moves; a redirect or dual-feed period is likely needed, not a same-day cutover of that string.
- **Git provider compatibility**: nothing GitHub-specific was hardcoded in the CLI's git operations
  in what was searched, but `updater-prerelease-feed.ts` / `updater-release-feed.ts` / the
  electron-builder `publish` block are explicitly GitHub-Releases-shaped (Atom feed scraping, tag
  URLs) — if Alicorn ever changes git *hosting* provider (not just repo owner) this is a bigger
  rewrite than a string rename; out of scope for this plan's phrasing but worth flagging once.
- **Ledger/naming discipline (CLAUDE.md)**: none of the rebrand items should introduce a field or
  concept literally named "ledger" or "mode" outside their already-reserved meanings — not directly
  at risk here since this plan is infra/identity work, but a `verify:rebrand-cli-gate` script or a
  new `hook_version` field should avoid those words if it needs a name.
- **Fork posture / cut point (CLAUDE.md)**: R5's `UPSTREAM_BASE` file is explicitly the trigger for
  ending "merge everything" and starting "cherry-pick only" — sequence this file's creation
  deliberately; it is a one-way door for the team's workflow, not just a repo-root artifact.

## Risks & open questions

1. **Mobile identity (`mobile/app.json`) is not in the Plane item list** (R1 reads desktop-scoped)
   but shares the same `orca`/`Orca` brand surface (scheme, bundle id, package name, `OrcaLogo.tsx`).
   Confirm whether v0.1 rebrand explicitly excludes mobile or it was assumed under "app identity."
2. **DS2's premise may not match the shipped mechanism.** The item says "Windows EV certificate +
   signing," but the pipeline signs through **SignPath** (hosted CI signing service, identity
   `CN=SignPath Foundation`), not a directly-held EV cert + `signtool`. Decide: Alicorn's own
   SignPath project (matches existing workflow) vs. self-held EV cert + raw `signtool` (bigger
   rewrite of `windows-signing-rehearsal.yml`).
3. **Update feed cutover ordering (R2/BC2).** `updater-prerelease-feed.ts` string-matches
   `github.com/stablyai/orca` against *fetched feed content* (Atom scrape + tag-URL regex), not
   just a config constant. Renaming the GitHub repo same-day as this string leaves every installed
   Orca build unable to discover its next update — needs a compatibility window (dual feed,
   redirect, or staged rollout); confirm which updater path (electron-builder's `publish` block vs.
   this hand-rolled one) is actually live in production before sizing the fix.
4. **No `setAsDefaultProtocolClient` call site found in `src/`** — confirm with a broader search
   (`.mjs`/`.cjs` bootstrap, Info.plist template) whether protocol registration is 100%
   electron-builder-declarative or there's a runtime re-registration path the `.ts`/`.tsx`-only
   grep missed.
5. **`LICENSE` says "Lovecast Inc.", not "stablyai"** — confirm the authoritative legal entity
   name before writing `NOTICE`.
6. **Stale-translation audit (L1) has no existing script to extend** — `audit-localization-coverage.mjs`
   catches *missing* translations, `locale-brand-mistranslations.mjs` catches *brand-name*
   mistranslations; nothing flags "this value was translated from an English string that has since
   changed." Size as new tooling, not an extension.
7. **"Startup check that reports unreachable hosts" (R4)** — no existing SSH-side hook-liveness
   check was found; confirm this is genuinely new work before scoping it as "extend X."

## Suggested task decomposition (≤2 ew each)

| Task | Plane item | Files | Proving check |
|---|---|---|---|
| Rename `appId`, `productName`, `protocols.schemes`, `win.executableName`, `linux.executableName`/`StartupWMClass`, `publish.owner/repo`, entitlement usage strings | R1 | `config/electron-builder.config.cjs` | `pnpm run build:mac` / `build:win` / `build:linux` package successfully; new bundle id appears in packaged `Info.plist`/`AndroidManifest`-equivalent |
| New icon set + `build:icons` regeneration, wordmark asset swap | R1 | `resources/icon-source/`, `resources/build/icon.{icns,ico,png}`, `resources/app-icons/` | `bash resources/icon-source/generate.sh` produces updated `resources/build/icon.*`; visual diff |
| Add `NOTICE`, confirm/update `LICENSE` copyright holder | R1 | `NOTICE` (new), `LICENSE` | manual legal review, no CI gate |
| Rewrite ~15 `orca://pair`/`orca://relay`/`orca://skills/share` literals + tests to new scheme | R1/R2 | `src/renderer/src/web/web-pairing.ts`, `WebConnect.tsx`, `AddRemoteHostFields.tsx`, `RuntimeHostAccessForm.tsx`, `skill-share-link.ts`, ~15 `*.test.ts`/`*.test.tsx` | `pnpm test` on the listed files; grep for old scheme returns zero outside a documented compat shim |
| `bin` field rename + compat shim binary that forwards `orca` → new name for one release | R2 | `package.json` `bin`, `src/cli/index.ts`, `src/shared/orca-cli-command-name.ts`, `src/main/cli/cli-install-constants.ts` | `pnpm run build:cli` then invoke both binary names; `cli-command-name-parity.test.ts` (existing) extended |
| Widen/replace `OrchestrationCliCommand` union and install-path literals across `src/main/cli/**` | R2 | `src/main/runtime/orchestration/cli-command.ts`, `src/main/cli/*.ts` (~40 files) | `pnpm tc:node`; `cli-installer.test.ts` and siblings green |
| WSL launcher rename (`orca-ide` → new name) + PowerShell bridge marker string update, with legacy-marker detection kept for uninstall | R2 | `src/main/cli/wsl-cli-scripts.ts`, `wsl-cli-installer.ts`, `wsl-cli-registration-*.ts` | `wsl-cli-installer.test.ts`; manual WSL smoke per `docs/reference/wsl-command-execution.md` |
| SSH remote CLI passthrough rename | R2 | `src/main/ssh/ssh-remote-cli-host-passthrough.test.ts` + its implementation | targeted test file green |
| Rewrite skill-guide bodies' bare `orca ` invocations (skill-guides/, largest slice: 282) | R3 | `skill-guides/**` | `pnpm run verify:bundled-skill-guides` regenerates clean; new `verify:rebrand-cli-gate` (below) passes |
| Rewrite remaining call sites: `skills/`(14), `skill-stubs/`(4), `src/cli/bundled-skill-guides.ts`(128, likely auto-derived — regenerate, don't hand-edit) | R3 | same | same |
| Register `GUIDE_ALIASES` entries for every renamed canonical guide name (`orca-cli`→new, etc.) | R3 | `config/scripts/generate-bundled-skill-guides.mjs` | `verify:bundled-skill-guides` |
| Regenerate skill bundle manifest after corpus rewrite | R3 | `config/scripts/generate-skill-bundle-manifest.mjs` (run, not edit) | `pnpm run verify:skill-bundle-manifest` |
| Write `verify:rebrand-cli-gate` CI script + wire into `lint` chain | R3 | new `config/scripts/verify-rebrand-cli-gate.mjs`, `package.json` `lint` | `pnpm run verify:rebrand-cli-gate` fails on injected `orca ` literal, passes clean |
| Rename `ORCA_AGENT_HOOK_*`/`ORCA_PANE_KEY`/`ORCA_TERMINAL_HANDLE`/etc. across `src/shared/agent-hook-*`, per-backend hook scripts, with dual-emit (old+new) for one release | R4 | `src/shared/agent-hook-*.ts`, `src/main/{claude,codex,copilot,devin,droid,cursor,gemini,grok,command-code}/hook*.ts` (~60+ files) | targeted hook-service test suites per backend green; manual hook round-trip |
| Bump/rename hook protocol version field, decide old-name/new-name interop story | R4 | `src/shared/agent-hook-endpoint-file.ts`, `src/relay/agent-hook-endpoint-coordinates.ts` | `agent-hook-endpoint-file.test.ts` |
| Versioned hook reinstall across local/WSL/SSH, modeled on `ssh-relay-versioned-install.ts` | R4 | new module alongside `src/main/ssh/ssh-relay-versioned-install.ts`, hook install call sites | new unit tests; manual SSH host reinstall |
| Startup check reporting unreachable hosts post-hook-reinstall (confirm scope first, §5 risk 5) | R4 | likely new file under `src/main/ssh/` or `src/main/startup/` | new test; manual multi-host smoke |
| Rename `ORCA_*` env vars in `cloud/`, `config/`, `.github/` (top-30 list in §1), keep `ORCA_RELAY_*` as-is per CLAUDE.md until BC1 cuts relay infra | R4 | `cloud/**`, `.github/workflows/**`, `config/**` (exclude relay-specific `ORCA_RELAY_*` unless BC1 lands same-cycle) | `pnpm tc`, cloud service tests against `ALICORN_TEST_POSTGRES_URL` |
| Add `UPSTREAM_BASE` file, document cherry-pick policy | R5 | new `UPSTREAM_BASE` at repo root | manual — file exists, tag+SHA recorded |
| Add `upstream` git remote, verify cherry-pick workflow once | R5 | none (local git config only, not committed) | `git fetch upstream && git log upstream/main -1` |
| Confirm all 24 `docs/reference/*.md` + associated ratchet tests still pass post-rebrand file moves | R5 | `docs/reference/*.md`, `child-process-import-boundary.test.ts`, `check-runtime-electron-ratchet.mjs` | `pnpm run check:runtime-electron-ratchet` + child-process ratchet test green |
| Re-translate ~3680 "Orca"-bearing catalog values across 6 locales; extend `locale-brand-mistranslations.mjs` with Alicorn's own mistranslation set | L1 | `src/renderer/src/i18n/locales/*.json`, `config/scripts/locale-brand-mistranslations.mjs` | `pnpm run verify:localization-coverage`, `verify:localization-catalog` |
| Build stale-translation audit (new tooling, §5 risk 4) | L1 | new `config/scripts/audit-stale-translations.mjs` (or extend `audit-localization-coverage.mjs`) | new script's own self-test |
| Repoint `PRODUCTION_API_BASE_URL`/`PRODUCTION_RELAY_DIRECTOR_URL`/`PRODUCTION_ARTIFACTS_API_URL`/`PLUGIN_KILL_LIST_URL`/`FEEDBACK_API_URL`/`PRIVACY_URL` to alicorn.dev-equivalent hosts, update the `onorca.dev`-suffix allowlist check in `artifact-cloud-config.ts` | BC2 | `profile-cloud-auth-config.ts`, `artifact-cloud-config.ts`, `plugin-kill-list-service.ts`, `feedback.ts`, `telemetry.ts` | targeted unit tests per file (`.test.ts` siblings exist for each) |
| Update-feed cutover with compatibility window (dual feed or redirect) | BC2/R5 boundary | `updater-release-feed.ts`, `updater-prerelease-feed.ts`, electron-builder `publish` block | `updater.*.test.ts` suite; manual old-client-polls-new-feed smoke |
| Cut new GCP project + domain for relay infra: new `.tfvars`, `backend/*.hcl`, DNS cutover, update `relay-ops/environment-config.ts` parsing | BC1 | `cloud/infra/terraform/environments/`, `backend/`, `relay-dns.tf`, `cloud/apps/relay-ops/src/environment-config.ts` | `terraform plan` against new project; `cloud-verify.yml` CI |
| Rename `ORCA_RELAY_*` env vars used by the relay stack (`ORCA_RELAY_ROLE`, `ORCA_RELAY_TEST_POSTGRES_URL`, `ORCA_RELAY_ASSIGNMENT_SIGNING_KEY`, etc.) | BC1 | `cloud/apps/relay/**`, `cloud/README.md`, relay GH workflows (`cloud-*.yml`) | `cloud/README.md`'s documented local-dev flow still works; relay test suite green against `ALICORN_RELAY_TEST_POSTGRES_URL` |
| Re-point Apple Developer Team ID / cert to Alicorn's account; update `extendInfo` usage-description copy | DS1 | `config/electron-builder.config.cjs` (`extendInfo`), CI secrets `MAC_CERTS*`/`APPLE_*` | `pnpm run build:mac:release` (or CI dry run) notarizes successfully |
| Decide + implement Windows signing identity (new SignPath project vs. EV cert), update `publisherName` string | DS2 | `config/electron-builder.config.cjs:406`, `.github/workflows/windows-signing-rehearsal.yml` | rehearsal workflow run produces a Authenticode-valid signed installer; `verifyUpdateCodeSignature` path exercised |
| Confirm glibc floor check needs no changes; re-run against rebranded package names (`orca-ide` → new name) | DS3 | `config/scripts/verify-linux-glibc-floor.cjs` (read-only confirm), `deb.packageName`/`rpm.packageName` | `pnpm run build:linux` packaging succeeds, `afterPack` glibc gate passes |
