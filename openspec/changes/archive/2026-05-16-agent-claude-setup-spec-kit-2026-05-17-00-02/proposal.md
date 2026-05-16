## Why

- Bring Spec-Driven Development (SDD) slash skills into gitguardex so Claude sessions can use `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement` and friends alongside the existing gx workflow.

## What Changes

- Add tracked `.specify/` (workflows, templates, scripts, integration manifests, constitution skeleton, bundled git extension).
- Add 14 `.claude/skills/speckit-*` skill prompt files alongside the existing gitguardex / guardex skills.
- Append a 3-line `<!-- SPECKIT START -->` marker to `AGENTS.md`.
- No CLI or core changes.

## Impact

- No runtime behavior change.
- Speckit skills are additive — they sit alongside the existing gx workflow without conflict.
