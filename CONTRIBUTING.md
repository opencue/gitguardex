# Contributing

Thanks for contributing to `GitGuardex`.

## Development setup

```bash
npm ci
npm test
node --check bin/multiagent-safety.js
npm pack --dry-run
```

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
  a deliberate minor or major release, raise `package.json` and its lockfile and
  add the version to the `README.md` release notes in the same PR.
- The npm Trusted Publisher is `opencue/gitguardex`, workflow `release.yml`,
  environment `npm`, with `npm publish` allowed. No npm token is needed.
- The workflow publishes with provenance and attaches the published tarball,
  SHA-256 checksum, and Sigstore bundle to the GitHub release. Rerun a failed
  release on the same commit before the next merge to recover without publishing
  a second version. A manually published stable tag matching the package version
  on `main` still uses the same workflow.
