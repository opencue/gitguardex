# PR checks and scoring evaluation

Integrate four deterministic tools without another reviewer or merge policy.
Pass reviewdog diagnostic JSON/SARIF as data, never execute a downloaded
report. Show available reports in the PR's Checks tab. The Promptfoo
evaluation is outside the PR review hot path.

## Work and acceptance

- Source lane: actionlint on changed workflows and new Knip findings only.
- Contract lane: diff-cover consumes the existing test coverage and oasdiff
  compares the configured local OpenAPI contract against the base.
- Evaluation lane: Promptfoo exercises the real score normalization on
  reusable diff fixtures, without model keys in CI.
- Integrator: read-only artifacts, safe checks section, quieter impact report,
  linked upstream credits, focused integration tests, and gated PR delivery.

Do not replace existing gates. Validate that stale/untrusted artifacts cannot
alter the gate verdict. When no report exists, do not claim a check passed.
The shared review renderer is locked by PR #916. Integrate direct Codex/Claude
review display only after the checkout owner releases or hands off that file.
