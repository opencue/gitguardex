## Why

- Users should be able to install the GitGuardex repo skill through the existing `npx skills add recodee/gitguardex` path without depending on repository-only files that are absent from the published npm tarball.

## What Changes

- Ship the repo-root `skills/` catalog as an explicit npm package asset.
- Document that the published package includes the skill catalog for the npx skill installer.
- Add metadata coverage so the package manifest keeps shipping the root skill catalog.

## Impact

- Affects package metadata, README install guidance, and metadata tests only.
- The tarball gains two small `skills/**/SKILL.md` files; no runtime CLI command behavior changes.
