# Taking a fix from upstream, after the cut

Alicorn forked from [Orca](https://github.com/stablyai/orca) at the commit recorded in
[`UPSTREAM_BASE`](../../UPSTREAM_BASE). From that commit onward upstream is a source to
cherry-pick from, never a branch to merge.

## Why the cut exists

Upstream ships roughly 500 merged pull requests between two consecutive releases, and much of that
is platform grunt work worth having: Windows and WSL path handling, SSH reliability, Git version
compatibility, EDR posture, the glibc floor, crash reporting. Merging it was cheap while the
rebrand was configuration and copy, and it stopped being cheap the moment the rebrand touched
every environment identifier in the tree.

So the trade is deliberate: we stop taking their work for free, and in exchange we stop paying
merge tax on files we have rewritten. Sitting in the middle — merging occasionally, resolving the
same conflicts repeatedly — is the only option that costs both.

## The remote is local-only

`upstream` is never committed as a remote. Add it when you need it:

```bash
git remote add upstream https://github.com/stablyai/orca.git
git fetch upstream --tags
```

## What to take

**Take:** security fixes, and platform bugs on the hazards `docs/reference/*.md` documents —
Windows EDR posture, WSL command execution, Git compatibility, the SSH execution boundary, the
Linux glibc floor. These are the expensive, hard-won parts of the inherited codebase.

**Do not take:** features, refactors, or anything touching a file Alicorn has rewritten (the tab
model, the agent-first surface, anything under `src/main/alicorn/` or `cloud/`). A feature that
looks useful is a rewrite request, not a cherry-pick.

## How

One pull request per fix, so a bad pick reverts alone:

```bash
git fetch upstream
git log --oneline UPSTREAM_BASE_SHA..upstream/main -- path/of/interest
git cherry-pick -x <sha>            # -x records the origin commit in the message
```

`-x` is not optional. It is the only thing that makes "where did this come from" answerable a year
from now.

**Compare against the sha, not the tag.** `UPSTREAM_BASE`'s tag is the first release *containing*
the cut commit, so the cut sits mid-release: a fix shipped in that release may or may not already
be in this fork. `git merge-base --is-ancestor <sha> HEAD` is the question worth asking.

**A cherry-pick brings its hazard note and its ratchet with it.** If the upstream fix updates a
`docs/reference/*.md` page or a ratchet test, take those in the same pull request. Deleting a
ratchet is how a fixed Windows bug comes back, and a fix without its note is a fix nobody can
maintain.

## What we keep regardless

- `docs/reference/*.md` — the platform hazard notes. Worth more than the code they describe.
- The ratchet tests enforcing them, such as the one failing on any new direct `child_process`
  import.
- MIT attribution: `LICENSE` and the upstream copyright notice stay, with our own `NOTICE`
  alongside. Rebranding a product does not remove the attribution requirement.
