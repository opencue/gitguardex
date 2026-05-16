## Why

- The user asked the Source Control illustration to make it explicit that agent branches also create OpenSpec artifacts.
- The current visual does not clearly show `openspec/.../tasks.md` and `openspec/.../spec.md` inside each agent's change list.

## What Changes

- Replace `docs/images/workflow-source-control.svg` with a frontend-style Source Control mock inspired by the current UI language.
- Show two active agent branches and include OpenSpec files (`tasks.md`, `spec.md`) directly in each branch's `Changes` list.
- Update the README visual section to use the refreshed SVG.

## Impact

- Affected surfaces:
  - `README.md`
  - `docs/images/workflow-source-control.svg`
- Risk is low (docs/image-only update).
- No runtime, API, or CLI behavior changes.
