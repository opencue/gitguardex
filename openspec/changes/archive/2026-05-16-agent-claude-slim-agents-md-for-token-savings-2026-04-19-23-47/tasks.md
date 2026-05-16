## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-slim-agents-md-for-token-savings-2026-04-19-23-47`.
- [x] 1.2 Define normative requirements in `specs/agents-doc-token-budget/spec.md`.

## 2. Implementation

- [x] 2.1 Cut 1: remove `## CLI Session Detection Lock` and `## Rust Runtime Proxy Lock` sections plus the Rust-gate bullet / main.rs note.
- [x] 2.2 Cut 2: replace the bloated `multiagent-safety` marker block with the canonical 19-line `templates/AGENTS.multiagent-safety.md` content.
- [x] 2.3 Cut 3: drop the orphan OpenSpec tasks.md scaffold (`## 1–5.`), `## ADDED Requirements` baseline, `## OpenSpec Multi-Codex Change Management`, and duplicate `## OpenSpec Plan Workspace (recommended)` that lived inside the marker block.

## 3. Verification

- [x] 3.1 `wc -c AGENTS.md` reports 15,608 bytes (< 18,000 budget).
- [x] 3.2 `diff <(awk '/START/,/END/' AGENTS.md) templates/AGENTS.multiagent-safety.md` is empty.
- [x] 3.3 Run `openspec validate agent-claude-slim-agents-md-for-token-savings-2026-04-19-23-47 --type change --strict` — valid.
- [x] 3.4 Run `openspec validate --specs` — passes (no main specs to validate).

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run `bash scripts/agent-branch-finish.sh --branch agent/claude/slim-agents-md-for-token-savings-2026-04-19-23-47 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`).
- [x] 4.3 Confirm sandbox worktree is gone (`git worktree list` + `git branch -a`).
