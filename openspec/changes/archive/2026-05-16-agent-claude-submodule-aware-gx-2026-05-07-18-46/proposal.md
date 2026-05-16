# Submodule-aware gitguardex: detect, claim, commit, PR, merge nested repos

## Why

`.gitmodules` lists 5 submodules in this repo (`examples/conductor`,
`examples/dmux`, `examples/hive`, `examples/skills_for_claude`,
`vscode-material-icon-theme`). `git submodule status` shows three of
them as uninitialized-but-disk-modified (`-` prefix in `git submodule
status` plus `m` in `git status`). That state is the smoking gun: a
prior agent edited files inside submodule paths, the parent recorded
nothing, and the changes are now stranded on disk with no commit
path.

Today `scripts/agent-branch-start.sh`, `scripts/agent-branch-finish.sh`,
`scripts/agent-file-locks.py`, and `scripts/codex-agent.sh` contain
**zero** `submodule` references — the entire Guardex lifecycle
ignores nested repos. When Codex/Claude works inside a submodule
path, edits never reach the submodule's remote and the parent's
gitlink is never bumped.

This change makes the gx lifecycle submodule-aware: detect at
`branch start`, claim per-(repo,path), and run a per-submodule
commit→push→PR→merge cycle on `branch finish`, then atomically bump
all parent gitlinks in one parent commit.

## What Changes

- **Detection** (`gx branch start` and a new `gx submodules status`):
  parse `.gitmodules`, run `git submodule status`, classify each
  submodule as `clean | dirty | uninitialized | missing-remote`.
- **Auto-init** (`gx branch start`, default on): run `git submodule
  update --init --recursive` inside the new worktree before tier
  scaffold so agent edits land in real submodule trees, not stranded
  paths. Opt-out via `GUARDEX_SUBMODULE_INIT=0`.
- **Lock keying** (`scripts/agent-file-locks.py`): claim records key
  on `(submodule_root, relative_path)` instead of bare absolute path.
  Parent-repo and submodule paths share no lock namespace.
- **Per-submodule write flow** (`gx branch finish`): for each dirty
  submodule, create `agent/<owner>/<slug>` inside the submodule,
  commit, push, open a PR via `gh -R <owner>/<repo>`, and wait for
  merge. Configurable via `GUARDEX_SUBMODULE_MODE`:
  - `off` — skip entirely (legacy behavior).
  - `sync-only` — detect drift, refuse, surface BLOCKED.
  - `commit-only` — commit + push to a topic branch, no PR.
  - `full-pr` (default) — full PR cycle.
- **Atomic gitlink bump**: parent does NOT bump submodule SHAs
  incrementally. Only after every submodule PR reaches `MERGED` does
  the parent stage all gitlink updates in a single commit
  (`chore(submodules): bump gitlinks for <slug>`). On any submodule
  failure, parent stages no bumps and finish exits BLOCKED with
  rollback instructions.
- **Multi-org token preflight**: at `branch start`, gx probes
  `GET https://api.github.com/repos/<owner>/<repo>` with the active
  token for every submodule whose URL host is github.com. Missing
  write permission anywhere fails fast with a remediation message.
- **Per-submodule gate-skip**: `openspec validate --specs` is run
  only against submodules that own an `openspec/` directory; absent
  `openspec/` records a deliberate skip in the finish report.
- **New capability spec** (`openspec/specs/gitguardex-submodules/`)
  to make these behaviors testable.

## Impact

- **Affected specs** — adds `gitguardex-submodules` capability;
  `gitguardex-branch-lifecycle` (if extracted) gains a §I link to
  the new capability.
- **Affected code** — `scripts/agent-branch-start.sh`,
  `scripts/agent-branch-finish.sh`, `scripts/agent-file-locks.py`,
  `scripts/codex-agent.sh`, plus a new `scripts/agent-submodules.py`
  helper. New tests under `test/agent-submodules.test.*`.
- **Affected docs** — `AGENTS.md` Multi-Agent Execution Contract
  gains a "Submodules" subsection; `README.md` "How it works" gains
  a one-paragraph submodule note.
- **Migration** — first run on a repo with dirty submodules will
  refuse `branch finish` until the operator chooses a mode. This is
  intentional: silently committing a stranded `m examples/hive`
  state into a submodule's `main` would amount to undisclosed
  history rewrites for that downstream repo.
- **Risk** — full-PR mode multiplies merge surface (5× repos × 5×
  protected-branch dance × 5× wait loops). Mitigations: the mode
  switch above; a single shared `--wait-for-merge` poller across
  all PRs; fail-fast preflight.
