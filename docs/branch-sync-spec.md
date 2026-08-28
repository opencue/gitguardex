# GitGuardex branch sync feature spec (pre-implementation)

Status: draft
Scope: CLI UX + behavior spec + test matrix for keeping `agent/*` branches synced with `origin/dev` safely.

## Goals

1. Keep `dev` as source of truth.
2. Reduce late-stage merge surprises for long-running agent branches.
3. Avoid dangerous hidden background rebases.
4. Keep conflict handling explicit and operator-controlled.

## Non-goals

- No automatic background sync daemon.
- No automatic conflict resolution.
- No forced push without explicit user action.

## Proposed CLI

## 1) Sync current branch

```bash
gx sync [--target <path>] [--branch <agent/*>] [--base <branch>] [--strategy rebase|merge] [--ff-only] [--dry-run]
```

Defaults:
- `--base dev`
- `--strategy rebase`
- `--ff-only` off
- `--branch` omitted (sync the branch checked out at `--target` or in the current directory)

When `--branch <agent/*>` is supplied, GitGuardex resolves the branch's linked
worktree and runs the sync there without changing the caller's checkout. A named
branch that has no linked worktree is rejected rather than checked out implicitly.

Behavior:
1. Resolve repo root.
2. `git fetch origin`.
3. Detect current branch.
4. Validate branch is `agent/*` (or allow override with explicit `--allow-non-agent`).
5. Ensure clean working tree (unless explicit `--allow-dirty`).
6. Sync branch onto `origin/<base>` using selected strategy.
7. Print summary: behind count before sync, action taken, result.

## 2) Check-only mode

```bash
gx sync --check [--target <path>] [--branch <agent/*>] [--base <branch>] [--json]
```

Outputs:
- current branch
- base branch
- behind/ahead counts vs `origin/<base>`
- clean/dirty status
- sync required: true/false

## 3) Multi-branch report (optional maintainer workflow)

```bash
gx sync --all-agent-branches [--target <path>] [--base <branch>] [--json]
```

Notes:
- report-only by default
- optional `--apply` for batch sync should remain opt-in and conservative

## 4) Protect `finish` flow

`agent-branch-finish.sh` should fail if current agent branch is behind `origin/dev` unless an explicit override flag is provided.

Example failure message:

```text
[agent-sync-guard] Branch is behind origin/dev by 3 commit(s).
Run: gx sync --base dev
Then retry: bash scripts/agent-branch-finish.sh
```

## Config keys (git config)

Stored under local repo config:

- `multiagent.baseBranch = dev`
- `multiagent.sync.strategy = rebase` (`rebase` or `merge`)
- `multiagent.sync.requireBeforeFinish = true`
- `multiagent.sync.requireBeforeCommit = false`
- `multiagent.sync.maxBehindCommits = 0`

Precedence:
1. CLI flag
2. repo git config
3. default value

## Hook behavior (future-compatible)

### pre-commit optional gate

If enabled (`multiagent.sync.requireBeforeCommit=true`), pre-commit checks whether current `agent/*` branch is behind `origin/dev` by more than `multiagent.sync.maxBehindCommits`.

- If over threshold: block commit with clear remediation command.
- If within threshold: allow commit.

Default remains off to avoid excessive friction.

## Safety and failure handling

### hard blockers

- Not inside git repo
- Branch is protected branch (`dev/main/master/...`)
- Detached HEAD
- Dirty worktree when sync requires replay (unless explicit allow)

### conflict behavior

- Stop immediately.
- Print exact git state and recovery commands.
- Never auto-commit conflict resolutions.

### recovery message

```text
Conflict detected during sync.
Resolve manually, then:
  git rebase --continue
or abort:
  git rebase --abort
```

## Output contract

Human mode example:

```text
[gx] Sync target: /repo
[gx] Branch: agent/executor/feature-x
[gx] Base: origin/dev
[gx] Behind before sync: 4
[gx] Strategy: rebase
[gx] Result: success (behind now: 0)
```

JSON mode shape:

```json
{
  "repoRoot": "/repo",
  "branch": "agent/executor/feature-x",
  "base": "origin/dev",
  "strategy": "rebase",
  "behindBefore": 4,
  "behindAfter": 0,
  "status": "success"
}
```

## Test matrix

## A) Unit tests (CLI parsing + config)

1. `sync --check` parses correctly.
2. `--base` overrides git config default.
3. `--strategy merge|rebase` accepted; invalid strategy rejected.
4. `--target` path handling works.
5. config precedence (flag > git config > default).
6. `--json` returns parseable schema.

## B) Integration tests (real temp repos)

1. **Happy path rebase**
   - create `dev` + `agent/*`
   - advance `dev`
   - run `gx sync`
   - assert agent branch no longer behind.

2. **Happy path merge strategy**
   - same setup
   - set `multiagent.sync.strategy=merge`
   - assert merge commit or fast-forward as expected.

3. **Check-only mode**
   - assert behind counts reported correctly.

4. **Dirty working tree blocked**
   - staged/unstaged changes present
   - sync fails with remediation.

5. **Detached HEAD blocked**
   - checkout commit hash
   - sync fails.

6. **Non-agent branch behavior**
   - on `dev` branch
   - sync rejects unless explicit override (if implemented).

7. **Conflict scenario**
   - force conflicting edits on `dev` and `agent/*`
   - sync exits non-zero and prints continue/abort instructions.

8. **Finish guard**
   - branch behind `origin/dev`
   - `agent-branch-finish.sh` blocks with sync hint.

9. **Custom base branch**
   - use `--base release`
   - sync uses `origin/release`.

10. **Check gate threshold**
    - with `requireBeforeCommit=true` and threshold set
    - pre-commit blocks/permits appropriately.

## C) Regression tests (existing behavior)

1. Existing setup/install/fix/scan flows unchanged.
2. Protected branch guard still enforced.
3. File lock validation behavior unchanged.
4. release command guardrails unchanged.

## Rollout plan (recommended)

Phase 1:
- `gx sync --check`
- `gx sync` for current branch
- docs + test coverage

Phase 2:
- finish-script hard guard (`behind > 0` blocks)

Phase 3 (optional):
- commit-time behind-threshold gate via config

## Decision

Proceed with explicit, command-driven sync (not background sync). This gives safety and freshness without hidden branch rewrites.
