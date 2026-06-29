<p align="center">
  <img alt="gitguardex logo" src="./logo.png" width="260">
</p>

<h1 align="center">guardian <em>t-rex</em> for multi-agent repos</h1>

<p align="center">
  Isolated worktrees, file locks, and PR-only merges for codex, claude,
  and human teammates working the same codebase at the same time.
</p>


<p align="center">
  <a href="https://www.npmjs.com/package/@imdeadpool/guardex"><img alt="npm version" src="https://img.shields.io/npm/v/%40imdeadpool%2Fguardex?label=npm&style=flat-square&color=cb3837&logo=npm&logoColor=white"></a>
  <a href="https://www.npmjs.com/package/@imdeadpool/guardex"><img alt="npm downloads per month" src="https://img.shields.io/npm/dm/%40imdeadpool%2Fguardex?label=downloads%2Fmonth&style=flat-square&color=0b76c5"></a>
  <a href="https://github.com/recodeee/gitguardex/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/recodeee/gitguardex/ci.yml?branch=main&label=CI&style=flat-square"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/recodeee/gitguardex"><img alt="OpenSSF Scorecard" src="https://img.shields.io/ossf-scorecard/github.com/recodeee/gitguardex?label=OpenSSF%20Scorecard&style=flat-square"></a>
  <a href="https://github.com/recodeee/gitguardex/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/recodeee/gitguardex?label=stars&style=flat-square&color=d4ac0d"></a>
  <a href="https://github.com/recodeee/gitguardex/commits/main"><img alt="last commit" src="https://img.shields.io/github/last-commit/recodeee/gitguardex?label=last%20commit&style=flat-square&color=7aa2f7"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/%40imdeadpool%2Fguardex?label=license&style=flat-square&color=97ca00"></a>
</p>

<p align="center">
  <a href="#01--install-in-one-line">Install</a> ·
  <a href="#03--what-it-does">What it does</a> ·
  <a href="#04--daily-workflow">Workflow</a> ·
  <a href="#05--dmux-style-multi-agent-cockpit">Cockpit</a> ·
  <a href="#06--what-gx-shows-first">gx status</a> ·
  <a href="#08--commands">Commands</a> ·
  <a href="#09--v6--v7-migration">Migration</a> ·
  <a href="#11--companion-tools">Companions</a>
</p>

---

## `01` &nbsp;Install in one line

<p align="center">
  <img alt="Install GitGuardex" src="https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/install-hero.svg" width="680">
</p>

```bash
npm i -g @imdeadpool/guardex
cd /path/to/your-repo
gx setup     # hooks, state, OMX / OpenSpec / caveman wiring — one shot
gx onboard   # optional: 2-minute guided tour — where you are + the exact next command
```

<p align="center">
  <sub><b>THE PROMISE</b><br><em>"guard many agent. keep one repo clean."</em></sub>
</p>

> [!WARNING]
> Not affiliated with OpenAI, Anthropic, or Codex. Not an official tool.

> [!IMPORTANT]
> GitGuardex is still being tested in real multi-agent repos. If something
> feels rough — especially around **cleanup**, **finish**, **merge**, or
> **recovery** flows — sorry. We're patching as we find things.

> [!CAUTION]
> **Recommended default: macOS or Linux with Codex CLI.** OMX is primarily
> designed and actively tuned for that path. Native Windows and Codex App are
> not the default experience, may break or behave inconsistently, and currently
> receive less support.

---

## The problem

![Parallel agents colliding in the same files](https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/problem-agent-collision.svg)

I was running ~30 Codex agents in parallel and hit a wall: they kept
working on the same files at the same time — especially tests — and
started overwriting or deleting each other's changes. More agents meant
**less** forward progress, not more.

| before · parallel collisions | after · isolated lanes + file locks |
| --- | --- |
| `codex-01` → `src/auth/login.ts` · ⚠ clash | `codex-01` → `agent/codex/login-refactor` · ● owned |
| `codex-02` → `src/auth/login.ts` · ⚠ clash | `codex-02` → `agent/codex/login-tests` · ● owned |
| `codex-03` → `test/auth.spec.ts` · ⚠ clash | `codex-03` → `agent/codex/session-guard` · ● owned |
| `claude-a` → `test/auth.spec.ts` · ⚠ clash | `claude-a` → `agent/claude/token-rotation` · ● owned |
| `codex-04` → `src/auth/session.ts` · ◌ stalled | `human` → `main` (protected) · ● clean |

### Solution

![Agent branch/worktree start protocol](https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/workflow-branch-start.svg)

---

## `03` &nbsp;What it does

- **Isolated `agent/*` branch + worktree per task.** Agents never share a
  working directory. Your visible local branch never changes mid-run.
- **Explicit file lock claiming.** An agent declares the files it's
  editing before it edits them. Claimed files can't be clobbered by
  another lane.
- **Deletion guard.** Claimed files can't be removed by another agent —
  no more ghost-deleted tests between runs.
- **Protected-base safety.** `main`, `dev`, `master` are blocked by
  default. Agents must go through PRs.
- **Auto-merges agent configs.** `oh-my-codex`, `oh-my-claudecode`,
  caveman mode, and OpenSpec all get applied automatically per worktree.
- **Repair / doctor flow.** When drift happens (and it will), `gx doctor`
  gets you back to a clean, verified state.
- **Auto-finish on session exit.** Codex exits → Guardex commits sandbox
  changes, syncs against base, retries once if base moved, and opens a PR.
- **Monorepo + nested repos.** Setup walks into every nested `.git`.
  Submodules and sandboxes are skipped automatically.

---

## `04` &nbsp;Daily workflow

Per new agent task — four steps, every time:

| `01` start isolated lane | `02` claim files | `03` implement + verify | `04` finish |
| --- | --- | --- | --- |
| Spawns `agent/role/task` branch + its own worktree. | Declare what you're touching. Other agents are blocked from these paths. | Run tests inside the sandbox — not against the live base branch. | Commit, push, open PR, wait for merge, prune the sandbox. |

```bash
# 1) start isolated branch/worktree
gx branch start "task-name" "agent-name"

# 2) claim the files you're going to touch
gx locks claim --branch "$(git rev-parse --abbrev-ref HEAD)" <file...>

# 3) implement + verify
npm test

# 4) finish — commit + push + PR + merge + cleanup
gx branch finish --branch "$(git rev-parse --abbrev-ref HEAD)" \
    --base main --via-pr --wait-for-merge --cleanup
```

> [!TIP]
> Launching Codex through Guardex runs **finish automatically** when the
> session exits — auto-commits, retries once if the base moved mid-run,
> then pushes and opens the PR.

![Guarded VS Code Source Control example](https://raw.githubusercontent.com/recodeee/gitguardex/main/docs/images/workflow-source-control-grouped.png)

---

## `05` &nbsp;dmux-style multi-agent cockpit

GitGuardex now has a dmux-style cockpit for starting, inspecting, and
finishing isolated agent lanes from one terminal workspace. It is not a
dmux clone: GitGuardex keeps safety as the core and adds orchestration
on top of isolated worktrees, file locks, protected base branches, and
PR-only finish.

```bash
gx cockpit
gx agents start "fix auth tests" --agent codex --base main --claim test/auth.test.js
gx agents start "fix auth tests" --panel --codex-accounts 3 --base main
gx agents start "update setup docs" --agent claude --base main --claim README.md
gx agents status
gx agents files --branch agent/codex/fix-auth-tests-2026-04-29-21-30
gx agents diff --branch agent/claude/update-setup-docs-2026-04-29-21-31
gx agents finish --branch agent/codex/fix-auth-tests-2026-04-29-21-30
```

Long-form guide: [docs/agents-cockpit.md](./docs/agents-cockpit.md).

---

## `06` &nbsp;What `gx` shows first

Before you branch, repair, or start agents, run plain `gx`. It gives you
a one-screen status for the CLI, global helpers, repo safety service,
current repo path, and active branch.

```text
$ gx

  ▮▮  gitguardex   v7.0.31
  ─────────────────────────────────────────────────────────────
  repo      /Users/you/code/your-repo
  branch    agent/codex/login-refactor  (sandbox of main)
  hooks     ● installed   pre-commit · pre-push · post-merge
  locks     ● 4 files claimed   by 3 agents
  service   ● running      review-bot · cleanup

  COMPANIONS
  ● oh-my-codex                    active
  ● oh-my-claude-sisyphus          active
  ● @fission-ai/openspec           active
  ● colony                         active
  ● cavekit                        optional · not installed
  ● gh                             authenticated

  NEXT   › gx branch start "task" "agent"
         › gx doctor   (if anything drifts)
```

Compact by default in a TTY. Pass `--verbose` for the full services
list and grouped help tree, or set `GUARDEX_COMPACT_STATUS=1` to force
the compact layout everywhere.

---

## `07` &nbsp;How `AGENTS.md` is handled

> [!IMPORTANT]
> **GitGuardex never overwrites your guidance.** Only content between
> these markers is managed:
> `<!-- multiagent-safety:START --> … <!-- multiagent-safety:END -->`.
> Everything outside that block is preserved byte-for-byte.

| Your repo has… | `gx setup` / `gx doctor` does… |
| --- | --- |
| `AGENTS.md` **with** markers | Refreshes **only** the managed block. |
| `AGENTS.md` **without** markers | Appends the managed block to the end. |
| No `AGENTS.md` | Creates it with the managed block, then links `CLAUDE.md` to it. |
| No root `CLAUDE.md` | Creates a `CLAUDE.md` symlink to `AGENTS.md`. |
| A root `CLAUDE.md` | Leaves it alone. |

---

## `08` &nbsp;Commands

### Core

| command | does |
| --- | --- |
| `gx onboard` | Guided first-run tour: where you are + the exact next command (alias: `gx welcome`). |
| `gx status` | Health check (the default when you type `gx`). |
| `gx status --strict` | Exit non-zero on findings. |
| `gx setup` | Full bootstrap. |
| `gx setup --repair` | Repair only. |
| `gx setup --install-only` | Scaffold templates, skip global installs. |
| `gx doctor` | Repair + verify (auto-sandboxes on protected main). |

### Lifecycle

| command | does |
| --- | --- |
| `gx finish --all` | Commit + PR + merge every ready `agent/*` branch. |
| `gx cleanup` | Prune merged / stale branches and worktrees. |
| `gx sync` | Sync current agent branch against base. |
| `gx release` | Update the GitHub release from README notes. |

### Multi-agent cockpit

| command | does |
| --- | --- |
| `gx cockpit` | Create or attach to a repo tmux cockpit session with a status pane. |
| `gx agents start "<task>" --agent codex` | Start an isolated Codex lane for a task. |
| `gx agents start "<task>" --agent claude` | Start an isolated Claude Code lane for a task. |
| `gx agents status` | Show repo agent service status. |
| `gx agents files --branch <agent/...>` | List files changed by one agent lane. |
| `gx agents diff --branch <agent/...>` | Show the diff for one agent lane. |
| `gx agents finish --branch <agent/...>` | Finish one agent session through the existing PR flow. |

```bash
gx release  # create/update the current GitHub release from README notes
```

`gx release` is the maintainer path for package releases. It reads `README.md`, finds the last published GitHub release, and writes one grouped GitHub release body.

### Protected branches

```bash
gx protect list
gx protect add release staging
gx protect remove release
gx protect set main release hotfix
gx protect reset   # back to: dev · main · master
```

---

## `09` &nbsp;v6 → v7 migration

Five commands were consolidated into flags. Old names still work and
print a deprecation notice; they'll be removed in v8.

| v6 | v7 |
| --- | --- |
| `gx init` | `gx setup` |
| `gx install` | `gx setup --install-only` |
| `gx fix` | `gx setup --repair` |
| `gx scan` | `gx status --strict` |
| `gx copy-prompt` | `gx prompt` |
| `gx copy-commands` | `gx prompt --exec` |
| `gx print-agents-snippet` | `gx prompt --snippet` |
| `gx review` | `gx agents start` |

---

## `10` &nbsp;Known rough edges

Being honest about where this still has issues:

- **Usage limit mid-task.** When an agent hits its Codex / Claude usage
  limit partway through, another agent may need to take over the same
  sandbox and run the remaining finish / cleanup steps.
- **Conflict-stuck probes.** Fixed in v7.0.2 — earlier versions could
  leak `__source-probe-*` worktrees when the sync-guard rebase hit
  conflicts.
- **Windows.** Most of the hook surface assumes a POSIX shell. Use WSL
  or symlink-enabled git.

---

## Release notes

<details open>
<summary><strong>v7.x</strong></summary>

### v7.1.1
- Bumped `@imdeadpool/guardex` from `7.1.0` to `7.1.1` so the current
  `main` payload can publish under a fresh npm version after `7.1.0` reached
  the registry.
- Direct maintainer `npm publish` now checks npm during `prepublishOnly` and
  bumps package release metadata to the next unpublished patch version when the
  committed version is already published. GitHub Actions release publishes keep
  the committed metadata so packed and signed assets stay aligned.

### v7.0.43
- Budget-friendly CI defaults for gitguardex-managed projects: live
  workflows drop `push: main`, gate per-PR jobs on `pull_request.draft
  == false`, add `concurrency: cancel-in-progress`, and split per-runtime
  matrix coverage into a weekly `ci-full.yml`. CodeQL and Scorecard run
  on the weekly schedule + `workflow_dispatch` only. Templates under
  `templates/github/workflows/` carry the same posture so downstream
  projects inherit it via `gx setup`.
- New `gx ci-init` subcommand scaffolds `ci.yml`, `ci-full.yml`, `cr.yml`,
  and a `README.md` budget-posture guide into a target repo's
  `.github/workflows/` directory. Supports `--target`, `--dry-run`,
  `--force`, `--no-stage`, and `--json`.
- New `gx budget` subcommand wraps the new GitHub
  `/settings/billing/usage` endpoint (the legacy
  `/settings/billing/actions` endpoint was retired in early 2026) and
  reports monthly Actions minute spend with warn/critical USD thresholds
  per `--org` or `--user`.
- Per-PR label opt-in for `agent/*` lanes: `needs-review` runs AI code
  review on an otherwise-skipped agent PR; `needs-ci-full` triggers the
  full cross-runtime matrix without waiting for the weekly schedule.
- `gx branch finish` runs `scripts/agent-preflight.sh` in the worktree
  before pushing. Default script auto-detects pnpm/npm, Rust, and Python
  stacks and refuses the push on verification failure. After pre-flight
  passes, draft PRs are promoted to ready-for-review so the
  budget-friendly CI defaults fire once on a known-passing commit.

### v7.0.42
- Bumped `@imdeadpool/guardex` from `7.0.41` to `7.0.42` so the current
  `main` payload can publish under a fresh npm version after `7.0.41` reached
  the registry.
- Improves the agent-session and cockpit workflow: `gx agents start/status`
  now share canonical session storage, agent lanes can be previewed, claimed,
  finished by session, and launched through safer supported-agent metadata,
  and cockpit can render live session state through tmux-backed panes.
- Hardens setup and status hygiene by ignoring local `.codex/` state during
  setup/doctor, avoiding generic OpenSpec dirty-worktree reuse, and pruning
  stale agent sessions from user-facing status surfaces.

### v7.0.41
- Bumped `@imdeadpool/guardex` from `7.0.40` to `7.0.41` so the current
  `main` payload can publish under a fresh npm version after the `v7.0.40`
  GitHub release landed without a matching npm registry package.
- Ships the Colony companion setup as the default global companion surface:
  `colony` maps to `@imdeadpool/colony-cli`, README setup documents
  `colony install --ide ...`, and status tests/images expect Colony instead
  of cavemem.

### v7.0.40
- Bumped `@imdeadpool/guardex` from `7.0.39` to `7.0.40` so the current
  `main` payload can publish under a fresh npm version after `7.0.39` reached
  the registry.
- No new CLI command behavior is introduced in this release lane.

### v7.0.39
- Bumped `@imdeadpool/guardex` from `7.0.38` to `7.0.39` so the current
  `main` payload can publish under a fresh npm version after `7.0.38` reached
  the registry.
- No new CLI command behavior is introduced in this release lane.

### v7.0.38
- Bumped `@imdeadpool/guardex` from `7.0.37` to `7.0.38` so the current
  `main` payload can publish under a fresh npm version after `7.0.37` reached
  the registry.
- No new CLI command behavior is introduced in this release lane.

### v7.0.37
- Bumped `@imdeadpool/guardex` from `7.0.36` to `7.0.37` so the current
  package can publish under a fresh npm version after `7.0.36` reached the
  registry.
- Synced the shipped Active Agents template with the canonical VS Code
  extension source so Colony task counts and details install with the package.
- No new CLI command behavior is introduced in this release lane.

### v7.0.36
- Bumped `@imdeadpool/guardex` from `7.0.35` to `7.0.36` so the latest
  branch-finish cwd-prune fix can ship under a fresh npm version after PR #424.
- No new CLI command surface is introduced in this release lane.

### v7.0.35
- Bumped `@imdeadpool/guardex` from `7.0.34` to `7.0.35` so the current
  merged `main` payload can publish on a fresh npm version after PR #420.
- Refreshed README release/skills metadata and shipped Active Agents template
  parity so the current `main` payload passes release verification.
- No new CLI command behavior is introduced in this release lane.

</details>

---

## `11` &nbsp;Companion tools

All optional — but if you're running many agents, you probably want them.
`gx status` auto-detects each one and reports it in the `Global services`
block.

Install repo skills with `npx skills add recodee/gitguardex`; the npm package also ships the root `skills/` catalog so the npx installer can read the GitGuardex skill from the published tarball. `npx skills add recodee/` opens the recodee namespace. `gx setup` does not auto-run `npx skills add ...`. If the picker does not show a separate `guardex` skill, that is expected.

| Tool | What it does | Stars |
| --- | --- | --- |
| [**oh-my-codex**](https://github.com/Yeachan-Heo/oh-my-codex) — `npm i -g oh-my-codex` | Codex config + skills framework. Merged into every agent worktree so each spawned Codex starts with the same tuned config. | [![stars](https://img.shields.io/github/stars/Yeachan-Heo/oh-my-codex?style=social)](https://github.com/Yeachan-Heo/oh-my-codex) |
| [**oh-my-claudecode**](https://github.com/Yeachan-Heo/oh-my-claudecode) — `npm i -g oh-my-claude-sisyphus@latest` | Claude-side mirror of oh-my-codex. Skills, commands, and defaults for every Claude Code session. | [![stars](https://img.shields.io/github/stars/Yeachan-Heo/oh-my-claudecode?style=social)](https://github.com/Yeachan-Heo/oh-my-claudecode) |
| [**OpenSpec**](https://github.com/Fission-AI/OpenSpec) — `npm i -g @fission-ai/openspec` | Structured plan / change / apply / archive flow so long agent runs don't drift off-task. | [![stars](https://img.shields.io/github/stars/Fission-AI/OpenSpec?style=social)](https://github.com/Fission-AI/OpenSpec) |
| [**Colony**](https://github.com/recodeee/colony) — `npm i -g @imdeadpool/colony-cli` | Multi-agent task coordination and handoff routing. After install, register runtimes with `colony install --ide codex`, `colony install --ide claude-code`, `colony install --ide cursor`, `colony install --ide gemini-cli`, or `colony install --ide opencode`, then verify with `colony status`. | [![stars](https://img.shields.io/github/stars/recodeee/colony?style=social)](https://github.com/recodeee/colony) |
| [**cavekit**](https://github.com/JuliusBrussee/cavekit) — `npx skills add JuliusBrussee/cavekit` | Spec-driven build loop with `spec`, `build`, `check`, `caveman`, `backprop` skills bundled in. | [![stars](https://img.shields.io/github/stars/JuliusBrussee/cavekit?style=social)](https://github.com/JuliusBrussee/cavekit) |
| [**caveman**](https://github.com/JuliusBrussee/caveman) — `npx skills add JuliusBrussee/caveman` | Ultra-compressed response mode for Claude / Codex. Less output-token churn on long reviews and debug loops. | [![stars](https://img.shields.io/github/stars/JuliusBrussee/caveman?style=social)](https://github.com/JuliusBrussee/caveman) |
| [**codex-account-switcher**](https://github.com/recodeecom/codex-account-switcher-cli) — `npm i -g @imdeadpool/codex-account-switcher` | Multi-identity Codex account switcher. Auto-registers accounts on `codex login`; switch with one command. | [![stars](https://img.shields.io/github/stars/recodeecom/codex-account-switcher-cli?style=social)](https://github.com/recodeecom/codex-account-switcher-cli) |
| [**GitHub CLI (`gh`)**](https://github.com/cli/cli) — see [cli.github.com](https://cli.github.com/) | Required for PR / merge automation. `gx branch finish --via-pr --wait-for-merge` depends on it. If `ghx` is on `PATH`, Guardex uses that GitHub CLI cache proxy automatically; set `GUARDEX_GH_BIN=gh` to force direct `gh`. | [![stars](https://img.shields.io/github/stars/cli/cli?style=social)](https://github.com/cli/cli) |

---

<p align="center">
  <sub>
    — PRs and issues welcome ·
    <a href="https://github.com/recodeee/gitguardex">github.com/recodeee/gitguardex</a> —
  </sub>
</p>
