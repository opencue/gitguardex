## Why

- The shipped `multiagent-safety` contract (installed into every gx-managed repo's `AGENTS.md`) carried a `### Caveman style` subsection. It restates generic terseness/formatting guidance that agents already get from their own persona, so it spends contract tokens in every installed repo for little marginal value.

## What Changes

- Remove the `### Caveman style` subsection from the shipped template `templates/AGENTS.multiagent-safety.md`.
- KEEP `### Token / context budget` (the `.agent/TOKEN-DISCIPLINE.md` pointer added in #612 references it).
- Re-generate this repo's `AGENTS.md` managed block from the trimmed template.
- Update template-content test assertions in `test/prompt.test.js` (also fixed pre-existing stale assertions there → green) and `test/setup.test.js`.

## Impact

- Surface: the installed contract every gx repo receives (~150 tokens leaner). No code/behavior change to the CLI.
- Risk: low. Token-budget subsection retained (no broken pointer). Net test result improves: the stale `prompt --snippet` test goes green (34 → 33 failures); zero new failures.
- Out of scope (deferred): Kitty stack consolidation (A10/A11) — recon-overstated, needs test rewrites.
