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

### Solution

![Agent branch/worktree start protocol](https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/workflow-branch-start.svg)

GitGuardex gives every task an isolated lane:

| Guard | Result |
| --- | --- |
| Separate `agent/*` branch + worktree | Agents do not share a working directory. |
| Explicit file locks | Other lanes cannot overwrite claimed files. |
| Protected `main` / `dev` / `master` | Agent changes must go through a PR. |
| Preflight + CI + optional AI review | Broken or risky changes stop before merge. |
| Finish + cleanup | The PR merges and the temporary lane is removed. |

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
