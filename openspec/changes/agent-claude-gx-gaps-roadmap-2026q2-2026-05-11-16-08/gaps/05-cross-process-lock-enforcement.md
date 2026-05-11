# Gap 05 — Cross-process lock enforcement

## Problem

`gx locks claim` writes a JSON manifest at the repo's lock-file path. The pre-commit hook later refuses commits that touch unclaimed files. Between claim and commit, nothing prevents another process (a different IDE, a different agent in a different worktree, a stray script) from saving the file. Pre-commit catches it, but **at the worst possible time**: after the user has invested edit work that now has to be reverted.

The contract today is advisory, not enforced. For a tool whose purpose is multi-agent safety, that is the weakest link.

## Evidence in current code

- `src/git/index.js lockRegistryStatus(...)` reads the manifest; no fs-level enforcement.
- Pre-commit hook (in `templates/`) runs `gx locks ...` validation only on `git commit`.
- No editor extension, no fsmonitor, no LSP hook, no inotify watch.
- Memory 5006: hooks live in `.githooks` via `git config core.hooksPath` — established hook surface, but pre-commit timing only.

## Proposed surface (research-required)

This gap is the only one in the roadmap that is **not** a self-contained CLI verb. It is a platform decision: where do we hook in to enforce locks at edit time instead of at commit time?

Candidates (each has its own R&D cost):

| Approach              | Pros                                                  | Cons                                                                 |
|-----------------------|-------------------------------------------------------|----------------------------------------------------------------------|
| VS Code extension     | Already have `Recodee.gitguardex-active-agents` extension id reserved (see `main.js:1268`). | Editor-specific; no Vim/Emacs/Cursor/Neovim coverage by default.     |
| `fsmonitor` daemon    | Native git integration since 2.36; cross-editor.      | Requires `git config core.fsmonitor` adoption; per-repo only.        |
| `inotify`/`fswatch` watcher | Cross-editor; runs alongside the agent shell.   | Spurious wakes; daemon lifecycle management.                         |
| LSP layer (Claude/Cursor) | Catches the *intent* to edit, not just the save. | Tied to specific clients; not portable.                              |
| Pre-write `EDITOR` wrapper | Minimal infra; just wraps `$EDITOR`.            | Bypassed by IDE saves; only catches terminal editors.                |

Hybrid recommendation: **fsmonitor + IDE extension**. Fsmonitor catches saves from anywhere; IDE extension provides early UI warnings before save.

CLI surface (small, only ships once a backend is chosen):

```bash
gx locks watch --branch <b>          # foreground daemon for one branch
gx locks watch --all                 # daemon for every owned branch
gx locks doctor                      # report which enforcement path is active
```

## Tier / effort

- **Tier**: T3.
- **Effort**: multi-week. Includes a design doc, ADR on enforcement backend, prototype, cross-editor testing, fallback strategy.

## Dependencies

- **Hard on Gap 02** (Structured observability): every blocked-save must emit a `lock-violation-blocked` event so we can prove enforcement is working without re-instrumenting.
- **Soft on Gap 01** (Interactive recovery): `gx recover` should know how to read enforcement-violation events.

## Open questions

- Do we ship a watchman/fsmonitor dependency, or pure-JS inotify (`chokidar`)? `chokidar` keeps the install surface npm-only; watchman gets perf at the cost of platform install instructions.
- Hard-block (refuse save) vs. soft-warn (allow save, but flag in IDE and in pre-commit)? Lean **soft-warn first**, hard-block behind an opt-in flag, escalate to default-hard after one quarter of telemetry.
- Single-user enforcement (claim by username) vs. branch-scoped (claim by branch)? Today it is branch-scoped — keep that.

## Acceptance criteria (deferred until backend chosen)

- [ ] ADR written describing the chosen enforcement backend and rejected alternatives.
- [ ] Prototype demonstrates soft-warn for a save by a non-owner process in at least one editor.
- [ ] `gx locks doctor` reports which enforcement backend is active and whether it is healthy.
- [ ] Pre-commit hook continues to function as the last-line defense and is not removed.
- [ ] Documentation in `openspec/specs/multiagent-safety/context.md` explains the new layered model.

## Why this is deferred

This is the gap most prone to over-engineering. Do not start until at least Gap 01–04 have shipped and there is concrete evidence (event-log data from Gap 02) that lock-violation collisions are actually happening at edit time, not just being theoretically possible.
