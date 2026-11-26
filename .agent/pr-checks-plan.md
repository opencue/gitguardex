# PR checks and scoring evaluation

Integrate four deterministic tools without another reviewer or merge policy.
Pass reviewdog diagnostic JSON/SARIF as data, never execute a downloaded
report. Keep the GitHub and local review layouts identical for these checks.
The Promptfoo evaluation is outside the PR review hot path.

## Work and acceptance

- Source lane: actionlint on changed workflows and new Knip findings only.
- Contract lane: diff-cover consumes the existing test coverage and oasdiff
  compares the configured local OpenAPI contract against the base.
- Evaluation lane: Promptfoo exercises the real score normalization on
  reusable diff fixtures, without model keys in CI.
- Integrator: read-only artifacts, safe checks section, quieter impact report,
  linked upstream credits, focused integration tests, and gated PR delivery.

Do not replace existing gates. Validate that stale/untrusted artifacts cannot
become inline findings or alter the gate verdict. When no report exists, do
not claim a check passed. Keep BugHunter gate work on its existing PR #916.
