<p align="center">
  <img alt="GitGuardex logo" src="./logo.png" width="240">
</p>

<h1 align="center">GitGuardex</h1>

<p align="center">
  <strong>Safe parallel work for Codex, Claude, and humans.</strong><br>
  One task → one worktree → one PR → one clean merge.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@imdeadpool/guardex"><img alt="npm version" src="https://img.shields.io/npm/v/%40imdeadpool%2Fguardex?label=npm&style=flat-square&color=cb3837&logo=npm&logoColor=white"></a>
  <a href="https://github.com/recodeee/gitguardex/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/recodeee/gitguardex/ci.yml?branch=main&label=CI&style=flat-square"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/recodeee/gitguardex"><img alt="OpenSSF Scorecard" src="https://img.shields.io/ossf-scorecard/github.com/recodeee/gitguardex?label=OpenSSF%20Scorecard&style=flat-square"></a>
  <a href="https://github.com/recodeee/gitguardex/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/recodeee/gitguardex?label=stars&style=flat-square&color=d4ac0d"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/%40imdeadpool%2Fguardex?label=license&style=flat-square&color=97ca00"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#the-problem">Why</a> ·
  <a href="#what-gitguardex-can-do">Capabilities</a> ·
  <a href="#see-every-lane-in-vs-code">VS Code view</a> ·
  <a href="#daily-workflow">Workflow</a> ·
  <a href="#code-assist-review-gate">Code assist</a> ·
  <a href="#essential-commands">Commands</a>
</p>

---

## Install

<p align="center">
  <img alt="Install GitGuardex" src="https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/install-hero.svg" width="680">
</p>

```bash
npm i -g @imdeadpool/guardex
cd /path/to/your-repo
gx setup
gx onboard   # optional 2-minute tour
```

Requires **Node.js 18+**, Git, and GitHub CLI (`gh`). Recommended on macOS or
Linux; use WSL on Windows.

> [!WARNING]
> GitGuardex is an independent project. It is not affiliated with OpenAI,
> Anthropic, or Codex.

---

## The problem

![Parallel agents colliding in the same files](https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/problem-agent-collision.svg)

Parallel agents can edit the same files, overwrite tests, or commit directly to
`main`. More agents can create more conflicts instead of more progress.

### What GitGuardex can do

<p align="center">
  <img alt="GitGuardex capability map: isolated lanes, evidence-driven shipping, and safe cleanup" src="https://raw.githubusercontent.com/opencue/gitguardex/main/docs/images/capabilities-dark.svg" width="900">
</p>

| Isolate and coordinate | Ship with evidence | Recover without loss |
| --- | --- | --- |
| One `agent/*` branch and worktree per task. | Preflight, CI, and optional AI review block risky merges. | Dirty, locked, blocked, and uncertain lanes are preserved. |
| Shared file claims prevent silent overwrites. | The recorded base keeps unattended finishes on the correct target. | Successful lanes are merged, then their temporary branch and worktree are removed. |
| Protected branches stay behind a PR boundary. | Billing-aware fallbacks waive only explicitly named checks. | Cleanup fails closed instead of deleting work it cannot prove safe. |

<details>
<summary><strong>Implementation evidence and shipped hardening</strong></summary>

- **Correct base targeting** — persist and validate each lane's base so an
  unattended finish cannot use another checkout's target. When
  `branch.<b>.guardexBase` is absent (e.g., a worktree created with raw
  `git worktree add`), the finish and stop hooks infer the base from git
  history: the oldest reflog "Created from &lt;name&gt;" entry wins; if absent,
  ancestry distance (commits ahead of each candidate's merge-base) selects the
  closest; ties prefer `multiagent.baseBranch`, then protected branches, then
  lexical order; and the result is persisted as `branch.<b>.guardexBase` for
  every subsequent gate. ([#745](https://github.com/opencue/gitguardex/pull/745), [#750](https://github.com/opencue/gitguardex/pull/750), [#751](https://github.com/opencue/gitguardex/pull/751))
- **Billing-aware CI fallback** — waive only named checks that GitHub could not
  start because of billing, while keeping repository preflight mandatory.
  ([#743](https://github.com/opencue/gitguardex/pull/743))
- **OpenSpec progress reconciliation** — merge conflicting `tasks.md` progress
  deterministically and validate it before continuing. ([#753](https://github.com/opencue/gitguardex/pull/753))
- **Reusable successful preflight** — reuse proof only while the source HEAD,
  base commit, command, and script stay unchanged; billing-waiver preflights
  are never cached. ([#757](https://github.com/opencue/gitguardex/pull/757))
- **Fail-closed cleanup** — preserve dirty, locked, open-PR, blocked, or
  uncertain lanes; close idle clean worktrees without deleting their branches.
  ([#741](https://github.com/opencue/gitguardex/pull/741), [#744](https://github.com/opencue/gitguardex/pull/744), [#746](https://github.com/opencue/gitguardex/pull/746), [#752](https://github.com/opencue/gitguardex/pull/752))
- **Workspace hygiene** — safely remove successful detached lanes, avoid stale
  VS Code worktree providers, and keep `gx branch finish --help` free of
  repository side effects. ([#742](https://github.com/opencue/gitguardex/pull/742), [#747](https://github.com/opencue/gitguardex/pull/747), [#748](https://github.com/opencue/gitguardex/pull/748), [#754](https://github.com/opencue/gitguardex/pull/754))

</details>

### See every lane in VS Code

Create an explicit multi-root workspace when you want every managed worktree to
appear as its own Source Control repository:

```bash
gx setup --vscode-worktree-view
code ../<repo>-branches.code-workspace
```

<p align="center">
  <img alt="VS Code Explorer showing separate Codex and Claude worktree groups" src="https://raw.githubusercontent.com/opencue/gitguardex/main/docs/images/vscode-worktrees-overview.png" width="668">
</p>

The generated workspace enables Git subfolder discovery, worktree detection,
and an empty repository-scan exclusion list. This is opt-in: GitGuardex does not
rewrite your repository's `.gitignore` or loosen the default single-repository
workspace. Disable future generation with `--no-vscode-worktree-view`.

---

## Daily workflow

```bash
# 1. Start an isolated lane
gx branch start "fix-auth" "codex"

# 2. Inside the printed worktree, claim what you will edit
gx locks claim --branch "$(git branch --show-current)" src/auth.ts test/auth.test.ts

# 3. Implement and verify
npm test

# 4. Commit, open a PR, merge, and clean up
gx branch finish --via-pr --wait-for-merge --cleanup
```

### One-call agent context

`gx context` exposes the existing MCP context collector as compact JSON, scoped
to the current repository. Read the current lane, peer agents, and ownership of
multiple files without separate per-file calls:

```bash
gx context src/auth.ts test/auth.test.ts
gx context --target /path/to/worktree --max-bytes 20000 --json
```

PR lookup is opt-in with `--include-prs`. The default limit is 20,000 UTF-8 bytes
of JSON, excluding the trailing newline; this is a byte budget, not a token
count. Up to 200 file paths are accepted. Use `--` before dash-prefixed filenames.
Only optional peer summaries may be omitted, with `complete: false` and an
omission count. Required safety data, including ownership conflicts, is never
truncated: an insufficient budget fails. Raise `--max-bytes` (up to 1 MiB) or
split the file batch. This read-only snapshot does not claim files or grant edit
permission; existing locks, approvals and merge gates still apply.

Run `node scripts/benchmark-context-cli.js` for a repeated local comparison of
separate MCP requests, the already-available batched MCP call, and this CLI.
It checks equivalent safety facts and reports timings and output bytes, not
provider-token counts or universal performance savings.

For a small change that you already verified locally, use the explicit fast
profile:

```bash
gx branch finish --fast
```

`--fast` still opens a PR and uses squash merge, but skips the local preflight,
AI review, and review autofix. Repository branch protection and required CI
checks still control whether GitHub accepts the merge. Do not use fast mode for
security-sensitive, migration, dependency, or broad refactor changes.

<p align="center">
  <img alt="Guarded VS Code Source Control example" src="https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/workflow-source-control-grouped.png" width="760">
</p>

---

## Worktree provisioning

Opt into isolated dependency copies in `.guardex.json` (JSONC is supported):

```json
{
  "provision": {
    "files": { "copy": ["node_modules", ".env"], "symlink": [] },
    "postCreate": ["npm run build"]
  }
}
```

New `gx branch start` worktrees apply this configuration. `copy` supports files
and directories, attempts native copy-on-write, and falls back to regular copying.
Unlike shared symlinks, modifying a copied dependency does not modify the source.
Existing targets are left untouched. Internal symlinks are relocated inside the
copy; dangling links, links outside the selected directory, and special files
fail the directory copy without installing a partial target. An explicit copy
never falls back to a shared symlink. Without an explicit copy policy, legacy
dependency sharing remains available; choose copies for writable dependencies.

**Migration:** `postCreate` now skips commands until their exact ordered list has
been approved locally for that repository. In a human terminal, run:

```bash
gx worktree approve-hooks --target /path/to/source-repo
gx worktree provision --source /path/to/source-repo --target /path/to/agent-worktree
# Revoke approval without running hooks:
gx worktree approve-hooks --target /path/to/source-repo --revoke
```

Approval is stored outside the repo under the Guardex user's
`.config/gitguardex/provision-approvals/`. Changed command lists require fresh
consent; noninteractive runs and `--yes` cannot grant it. Approved hooks can run
arbitrary shell code, including subsequently changed scripts: approval is not a
sandbox or a review of those scripts. `GUARDEX_PROVISION_HOOKS=0` disables even
approved hooks. `provision --with-defaults` also applies legacy dependency links
where they do not overlap an explicit copy policy (used by branch creation).

`gx agents status` prints its header before Git probes and then each completed
session row on a terminal. Redirected text and `--json` retain their prior format.
This is progressive display, not a claim that Git collection is faster.

These adaptations were inspired by [Worktrunk](https://github.com/max-sixty/worktrunk),
not implemented by adding a second worktree manager. Reproduce the local copy
comparison with `node scripts/benchmark-provision.js`; it reports repeated-run
timings and allocation accounting, not universal performance or storage savings.

### Native worktree navigation

```bash
eval "$(gx shell-init bash)"       # zsh supported too; fish: gx shell-init fish | source
gx switch agent/bot/my-task       # registered branch, worktree path, or "-" for previous
gx switch pr:123 --create         # GitHub PR (requires gh); creation uses GX safety gates
gx switch                        # terminal picker with diff-stat and PR preview
gx switch agent/bot/my-task --json
```

Without shell integration, `gx switch` prints the destination; it cannot change
the parent shell's directory. `--print` is path-only and `--json` is structured
output. Navigation does not change the primary checkout. `--create` provisions
a GX agent lane from an existing branch or PR head, retaining quotas and claims,
not a second worktree manager. PR URLs must match this repository; fork PR heads
are fetched through the origin repository's numbered PR ref and verified by SHA.

### Approved lifecycle hooks

Alongside the existing `provision.postCreate`, configure named lifecycle events:

```json
{
  "hooks": {
    "pre-start": ["npm ci", { "build": "npm run build", "lint": "npm run lint" }],
    "pre-merge": "npm test",
    "post-start": "echo Ready"
  },
  "hookTimeoutMs": 600000
}
```

An array is an ordered pipeline; commands in a named object run concurrently,
and the next stage waits for all of them to succeed. Pre hooks block; post hooks
run in the background with per-run output and status files.

```bash
gx worktree hook approve pre-start --source /path/to/repo
gx worktree hook approve pre-merge --source /path/to/repo
gx worktree hook approve post-start --source /path/to/repo
gx worktree hook pre-start --source /path/to/repo --worktree /path/to/lane --dry-run
gx worktree hook logs --source /path/to/repo --json
gx worktree hook approve pre-start --source /path/to/repo --revoke
```

Consent is interactive and local, bound to the repository, event, exact ordered
commands and timeout. Changes require approval again. These approvals are separate
from legacy `postCreate`; `--yes` cannot approve shell execution. State lives under
the Guardex user's `.config/gitguardex/lifecycle-hooks/`, outside the repository.
Approved commands are arbitrary shell code, not sandboxed; invoked scripts can
change independently of the approved command text.

Events are `pre-*` and `post-*` for `start`, `switch`, `commit`, `merge`,
and `remove`. Start hooks run after provisioning but before readiness, then
after successful initialization; reduced provisioning modes skip them. Switch
hooks surround destination selection, before the shell consumes its path.
Commit hooks surround GX finish's auto-commit (not unrelated manual Git commits).
Merge hooks supplement, never replace, existing PR/merge gates: a pre-merge hook
that changes the source revision or leaves changes aborts the merge.
Removal hooks apply to guarded prune and deferred finish cleanup, not internal
temporary integration/probe trees. A failed pre-remove preserves the worktree;
post-remove runs from the surviving repository, with `GUARDEX_WORKTREE` retaining
the removed path. Hooks also receive `GUARDEX_REPO_ROOT`, `GUARDEX_BRANCH` and
`GUARDEX_HOOK_EVENT`. `GUARDEX_PROVISION_HOOKS=0` disables hooks explicitly.

### Explicit ignored-file copy

```bash
gx worktree copy-ignored --source /path/to/repo --target /path/to/lane --dry-run --json
gx worktree copy-ignored --source /path/to/repo --target /path/to/lane
```

Only ignored files are eligible. Optional source `.worktreeinclude` narrows the
selection using Git's ignore-pattern syntax, for example `node_modules/**`
followed by `!node_modules/private/`. Existing or tracked target files are never
overwritten, and symlink escapes and nested repositories are rejected. This
explicit command does not broaden the normal branch-start copy policy.
GX runtime/ownership directories are excluded, including aliases pointing into
them. Foreign file claims and malformed lock registries block copying. Shared
remote-lock mode currently refuses this command rather than bypassing remote
ownership or fetching state during a read-only dry-run.
See [third-party attribution](THIRD-PARTY-NOTICES.md).

## Code-assist review gate

Add `--gate-review` to review the PR before merge. Add `--gate-autofix` to let
the agent repair blocking findings and run the review again.

```bash
gx branch finish --via-pr --wait-for-merge --cleanup \
  --gate-review --gate-autofix
```

High and critical findings block the merge. The review is posted directly on
the PR as a readable severity, location, and finding table.

<p align="center">
  <a href="https://github.com/projects-kssk/Wireless_KFB_Project/pull/165">
    <img alt="GitGuardex code-assist blocking a PR with review findings" src="https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/code-assist-review-gate.png" width="920">
  </a>
</p>

<p align="center">
  <sub>
    Real example: <a href="https://github.com/projects-kssk/Wireless_KFB_Project/pull/165">Wireless_KFB_Project PR #165</a>
    · <a href="https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/code-assist-review-gate.png">open the full-size screenshot</a>
  </sub>
</p>

---

## Essential commands

| Command | Purpose |
| --- | --- |
| `gx` / `gx status` | Show repo safety and the next action. |
| `gx setup` | Install or refresh Guardex in a repo. |
| `gx doctor` | Repair Guardex drift. |
| `gx branch start "task" "agent"` | Create an isolated task lane. |
| `gx locks claim --branch <branch> <files...>` | Claim files before editing. |
| `gx branch finish --via-pr --wait-for-merge --cleanup` | Ship safely through a PR. |
| `gx branch finish --fast` | Squash-merge a locally verified small change without local preflight or AI review. |
| `gx agents status` | Show active agent lanes. |
| `gx agents send --session <id> --message <text>` | Deliver safely to an idle agent or queue for its next turn. |
| `gx agents inbox [--ack <message-id>]` | Read or acknowledge the authenticated standalone message queue. |
| `gx cleanup` | Prune merged or stale worktrees. |

Need the terminal cockpit? Run `gx cockpit`; see the
[cockpit guide](./docs/agents-cockpit.md). Run `gx --help` for every command.

---

<details>
<summary><strong>Advanced setup and maintainer notes</strong></summary>

### AGENTS.md safety block

GitGuardex preserves your instructions. It only manages content between:

```text
<!-- multiagent-safety:START -->
<!-- multiagent-safety:END -->
```

### Agent skills

```bash
npx skills add recodee/gitguardex
npx skills add recodee/   # browse the namespace
```

`gx setup` does not auto-run `npx skills add ...`. If the picker does not show a separate `guardex` skill, that is expected; use the `gitguardex` skill.

### Package releases

```bash
gx release  # create/update the current GitHub release from README notes
```

`gx release` is the maintainer path for package releases. It reads `README.md`,
finds the last published GitHub release, and writes one grouped GitHub release body.

</details>

## Release notes

<details>
<summary><strong>v8.x</strong></summary>

### v8.4.0
- Added authenticated agent messaging that delivers live when safe and queues
  durably when Nodeterm or tmux delivery is unavailable.
- Added worktree-shared CLI and MCP inbox operations for reading and
  acknowledging queued agent messages.
- Improved stale Codex worktree recovery and VS Code visibility for managed
  worktrees.

### v8.3.0
- Added adaptive direct-main agent work and branch-targeted `gx sync`.
- Made worktree cleanup safer by preserving active or locked lanes while pruning
  only eligible merged or opted-in clean lanes.
- Persisted and validated explicit finish bases, recognized SHA-256 null object
  IDs, and prevented stale VS Code worktree providers.

### v8.2.0
- Reduced agent preflight and finish token overhead.
- Preserved dirty worktrees during stale-worktree cleanup and exposed
  command-specific cleanup help.
- Added the owning tmux pane and worktree to file-lock conflict output.

### v8.1.1
- Prevented `gx doctor` from pruning dirty detached or managed worktrees during
  stale-worktree repair.

### v8.1.0
- Added shared Git lock state so independent clones coordinate file ownership.
- Aligned npm repository metadata with `opencue/gitguardex` for trusted OIDC
  publishing.

### v8.0.0
- Added `gx branch finish --fast` for small tasks that should use the PR +
  squash-merge path without repeating local preflight or opt-in AI review.
- Removed the legacy `cr.yml` AI-review workflow; repository policy and explicit
  Guardex review gates now control merge readiness.

</details>

<details>
<summary><strong>v7.x</strong></summary>

### v7.1.1
- Bumped `@imdeadpool/guardex` from `7.1.0` to `7.1.1` so the current
  `main` payload can publish under a fresh npm version after `7.1.0` reached
  the registry.
- Direct maintainer `npm publish` now checks npm during `prepublishOnly` and
  bumps package release metadata to the next unpublished patch version when the
  committed version is already published. GitHub Actions release publishes keep
  the committed metadata so packed and signed assets stay aligned.

</details>

---

<p align="center">
  <a href="https://github.com/recodeee/gitguardex/issues">Issues</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./SECURITY.md">Security</a>
</p>
