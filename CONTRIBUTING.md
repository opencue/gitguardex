# Contributing

Thanks for contributing to `GitGuardex`.

## Development setup

```bash
npm ci
npm test
node --check bin/multiagent-safety.js
npm run package:check
```

## Repository layout

- `package/gitguardex/` is the published CLI workspace. Its manifest owns the
  npm name, version, executable and shipped assets. The root npm workspace is
  private and runs repository-wide checks. In its `src/`, `worktree/` owns
  checkout lifecycle, `pull-request/` owns GitHub PR operations and reporting,
  and `review/` owns review providers and diff handling.
  To install from a checkout, pack the CLI with
  `npm pack --workspace @imdeadpool/guardex` and install the resulting tarball,
  not the root directory.
- `package/frontend/` is the standalone frontend with its own lockfile. Run
  `npm ci --prefix package/frontend` to install it.
- `scripts/`, `test/` and `.github/` are repository-level tooling, integration
  tests and CI. Existing repository paths `bin/`, `src/`, `skills/` and
  `templates/` are compatibility links to the CLI workspace; edit the canonical
  files there.

## Additional documentation

- Marketing: [GitHub About copy](./docs/marketing/about_description.txt) and
  [video brief](./docs/marketing/video-brief.md).
- Privacy: [optional telemetry and what it sends](./docs/telemetry.md).

## Pull request checklist

- Keep changes small and focused
- Add or update tests for behavior changes
- Keep README and CLI help text aligned
- Ensure `npm test` passes locally

## Release hygiene

- Every push to `main` queues the npm release workflow. It runs verification and
  the dependency audit before releasing the current commit; superseded runs
  skip publishing.
- By default the workflow releases the next free patch after npm `latest`. For
  a deliberate minor or major release, raise `package/gitguardex/package.json`
  and update the root workspace lockfile, then
  add the version to the `README.md` release notes in the same PR.
- The npm Trusted Publisher is `opencue/gitguardex`, workflow `release.yml`,
  environment `npm`, with `npm publish` allowed. No npm token is needed.
- The workflow publishes with provenance and attaches the published tarball,
  SHA-256 checksum, and Sigstore bundle to the GitHub release. Rerun a failed
  release on the same commit before the next merge to recover without publishing
  a second version. A manually published stable tag matching the package version
  on `main` still uses the same workflow.
