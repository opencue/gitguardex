## Why

- `openspec/changes/` had accumulated 221 active change folders whose corresponding PRs had already merged into `main`. Their `tasks.md` cleanup sections were left unchecked, so the workspace looked like 221 in-flight changes when in fact almost all were complete. This obscured the real backlog and made `openspec list` / dashboard tooling unusable for triaging real work.
- Per the OpenSpec philosophy in `CLAUDE.md` (iterative, easy to apply, scalable), completed changes belong under `openspec/changes/archive/<date>-<slug>/`, with delta specs folded into `openspec/specs/`.

## What Changes

- Identified every active change whose head branch corresponds to a merged PR (exact `agent/<who>/<slug>` lookup against `gh pr list --state merged`) or whose change directory already contains commits on `origin/main`.
- For each matched change: ticked the unchecked `- [ ]` boxes in cleanup sections (`## 4. Cleanup`, `## Cleanup`, sections 5/6) of `tasks.md` / `notes.md` to reflect that the work shipped, then ran `openspec archive <slug> --yes`, falling back to `--skip-specs` only for the seven changes whose delta specs collided with already-applied main-spec entries (typical for release-version-bump-style changes that re-add the same requirement header).
- No content in `proposal.md`, `spec.md`, or other narrative files was rewritten; only checkbox state in cleanup sections changed.

## Impact

- 221 changes moved from `openspec/changes/` to `openspec/changes/archive/2026-05-16-*`.
- 9 main spec files received additive delta merges via the normal `openspec archive` pipeline (no manual rewrites).
- `openspec validate --specs` passes (133/133 items).
- Risk: very low. Each archive step is reversible by moving the dated archive folder back; the underlying PRs already shipped the implementation work.
