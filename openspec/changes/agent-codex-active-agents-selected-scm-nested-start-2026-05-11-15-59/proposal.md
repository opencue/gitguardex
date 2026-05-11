## Why

VS Code Source Control shows the primary repo, nested storefront repo, and nested backend repo as separate SCM roots. The Active Agents Start Agent command must launch in the repo the user is actually working in, instead of silently falling back to the outer workspace root.

## What Changes

- Prefer the active SCM/editor repo root when multiple workspace Git repos are discovered.
- Launch agents through the canonical `gx agents start --target <repo>` surface so nested repos do not require changing the outer checkout.
- Add branch and dirty-state cues to the repo picker when the active repo cannot be inferred.
- Cover the selected nested repo and active-editor repo paths with focused VS Code extension tests.

## Impact

The change is limited to the bundled Active Agents VS Code extension and its install template. Existing tree rendering and session inspection behavior are unchanged.
