## Why

`AGENTS.md` is loaded into every Claude Code / Codex session as part of the
agent contract. The current file is 26,331 bytes (~6,600 tokens) **per turn**.
Over a 30-turn session that is ~200K tokens just for the contract, most of which
is either (a) recodee-specific content that leaked during the `chore: sync
AGENTS.md` flow, (b) a bloated duplicate of the canonical multi-agent safety
contract, or (c) OpenSpec `tasks.md` scaffold text that does not belong in a
contract document.

## What Changes

Three surgical cuts, no information loss (references + SSOT paths preserved):

1. **Delete recodee-specific sections.** `## CLI Session Detection Lock
   (Dashboard / Accounts)` and `## Rust Runtime Proxy Lock` both point at files
   that do not exist in guardex (`frontend/src/utils/account-working.ts`,
   `rust/codex-lb-runtime/src/main.rs`). Also delete the matching rule 4 (Rust
   runtime verification gate) inside the Default contract and the `main.rs`
   note inside the Claude Code Workflow section.

2. **Replace the bloated `multiagent-safety` marker block with the canonical
   19-line template** (`templates/AGENTS.multiagent-safety.md`). The drift came
   from the upstream recodee sync pulling a much larger block than the template
   declares; `gx setup` would have re-synced this on next run. This cut brings
   the installed contract back in line with the template.

3. **Move the `## 1. Specification` ... `## 5. Cleanup` tasks.md scaffold,
   `## ADDED Requirements` baseline pattern, `## OpenSpec Multi-Codex Change
   Management`, and `## OpenSpec Plan Workspace (recommended)` out of AGENTS.md.**
   These were orphan template fragments living inside the marker block; they
   are either duplicates of earlier sections (Plan Workspace Contract) or
   belong in the `init-change-workspace.sh` / `init-plan-workspace.sh`
   scaffolding output, not the contract.

## Impact

- **Token budget.** AGENTS.md drops from 26,331 -> 15,608 bytes
  (-10,723 bytes, ~-2,700 tokens per Claude turn).
- **SSOT alignment.** The installed `multiagent-safety` block now matches
  `templates/AGENTS.multiagent-safety.md` exactly; future `gx setup` runs are
  a no-op for that section.
- **No behavior change.** No scripts, hooks, CI, or runtime code are touched.
  The removed Rust/CLI session detection sections referenced code paths that
  do not exist in guardex; their deletion cannot regress this repo.
- **Follow-up.** The upstream sync tool (used by `chore: sync AGENTS.md ...`)
  still copies recodee's bloated AGENTS.md wholesale. A separate change
  should teach the sync to respect the canonical template markers (out of
  scope here).
