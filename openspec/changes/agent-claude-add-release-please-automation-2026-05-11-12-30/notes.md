# add-release-please-automation (T1)

Branch: `agent/claude/add-release-please-automation-2026-05-11-12-30`

## Problem

`.github/workflows/release.yml` is wired correctly (publish-on-`release: types: [published]`) but nothing in the repo triggers it. The package on npm sat at `@imdeadpool/guardex@7.0.42` while the repo accumulated multiple fixes (PRs #545-551 in today's audit alone). Consumers don't pick up fixes until someone manually bumps `package.json`, creates a tag, and cuts a GitHub release.

## Approach

Add `googleapis/release-please-action@v4` as a parallel workflow that runs on `push: main`:

- `.github/workflows/release-please.yml` — invokes the action with the config + manifest files.
- `release-please-config.json` — `release-type: node`, package name, changelog sections (feat / fix / perf visible; chore / docs / refactor / test / build / ci / style hidden), `include-v-in-tag: true` so tags match the `vX.Y.Z` format `release.yml` already expects via `github.event.release.tag_name`.
- `.release-please-manifest.json` — pins current version `7.0.42` as baseline.

## How it works after merge

1. release-please scans commits since `v7.0.42`, classifies them by conventional-commit prefix.
2. Opens a "release-please: release X.Y.Z" PR that bumps `package.json` + writes `CHANGELOG.md`.
3. Merging that release PR creates a GitHub release at the new tag.
4. Existing `release.yml` listens for `release: types: [published]` and publishes to npm with provenance + cosign signing.

## Scope

- Three new files; no existing files modified.
- `chore(release): ...` / `chore(deps): ...` commits hidden from changelog by default.

## Out of scope

- Backfilling release notes for prior merged PRs (release-please picks them up from commits since last tag).
- Migrating off `release.yml` (kept as the publish handler).
- CI gate enforcing conventional-commits (today's commits already use it).

## Risk

- First release-please PR after merge accumulates all commits since `v7.0.42`. Likely just a patch bump (no `feat:` or `BREAKING CHANGE`).
- If `node-workspace` plugin causes issues at runtime (no real workspaces here), remove it from `release-please-config.json` plugins.

## Cleanup

- [ ] `gx branch finish --branch agent/claude/add-release-please-automation-2026-05-11-12-30 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state.
- [ ] Confirm sandbox worktree gone.
