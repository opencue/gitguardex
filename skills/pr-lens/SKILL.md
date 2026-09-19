---
name: pr-lens
description: Generate local PR Lens architecture and data-flow diagrams alongside a GitGuardex Codex or Claude PR review.
---

# PR Lens code review

Install the optional renderer once (requires Node >=20.11):

```bash
npm install -g @coldtea/pr-lens-cli@0.6.1
gx pr-review --pr 123 --provider codex --pr-lens
```

`gx pr review` accepts the same flags. `--provider claude` uses Claude instead.
No additional model API key is needed: the existing tool-free review call
returns findings and a PR Lens graph together. PR Lens validates the graph
and renders light/dark SVGs locally. A valid graph needs no second model call.

Set `GUARDEX_PR_LENS_BIN` to an installed CLI path if it is not on PATH.
Set `GUARDEX_REVIEW_PR_LENS=1` to include diagrams in `gx branch finish
--gate-review` too. `--no-pr-lens` overrides the environment for a direct review.
The default remains off, so Node 18 review users do not acquire a new requirement.

The printed manifest names the SVGs; graph and diagrams live in the durable
Git common-directory artifact store, surviving worktree cleanup. `--artifact`
changes the findings Markdown path, not the diagram store. `--post` posts the
normal findings only: diagrams remain local. No canvas upload, public asset
publication, auto-install, `.gitignore` edit, or checkout config loading occurs.

The diagram is limited to the supplied diff, not a whole-repository map.
PR metadata and line counts come from GitHub, never from the model. A moving
PR, truncated diff, missing graph/CLI, or validation/render failure fails the
requested review rather than silently reporting success. Existing finding
severity rules and merge gates are unchanged.

Findings are saved before validation/rendering, including when `--post` was
requested. Diagram failures report the saved Markdown path and a separate failed
status; they still throw and prevent posting or a successful merge verdict.

A schema-validation failure gets at most one graph-only repair using the same
provider/model and tool-free sandbox. The repair cannot replace the original
findings or trusted PR metadata. It receives the diff, graph and validator errors;
it has a separate timeout of at most 60 seconds (or the lower review timeout),
a 64,000-character graph input limit, 8,000-character error limit and
256,000-byte process output cap. These bound retries/input/output, not billed
tokens. CLI installation, I/O, renderer and timeout failures do not trigger repair.
Failed repair remains an error. The PR head is checked again after repair.

The `PR Lens contract` workflow installs CLI 0.6.1 outside the checkout and
always enables the real renderer tests; the tests use fixture model responses,
not paid model calls. To run the same tests locally:

```bash
GUARDEX_TEST_PR_LENS_BIN=/absolute/path/to/pr-lens node --test test/pr-lens*.test.js
```

## Optional PR artifact link

After an explicitly configured GitHub Actions workflow has uploaded the diagram
directory (graph, manifest and SVGs), publish its artifact URL:

```bash
gx pr-review --pr 123 --post --pr-lens-publish \
  https://github.com/OWNER/REPO/actions/runs/RUN_ID/artifacts/ARTIFACT_ID
```

This is a **publish-only** operation: it does not run another review/model,
render, upload files or produce a merge verdict. Do not combine it with
`--fix`, `--pr-lens`, `--no-pr-lens` or `--artifact`. The existing `--post`
review behavior still leaves diagrams local.

Only HTTPS artifact URLs on the same GitHub host and repository are accepted.
GitHub must confirm an unexpired artifact for that run and the current PR head
SHA; a merge-commit artifact is not accepted as a head-commit artifact. The
uploader is responsible for the archive contents: this command verifies metadata,
not the contents of the archive. It refuses public canvas/external hosting URLs.

The link keeps GitHub's repository access controls and artifact retention; it is
a download link, not an inline image. A matching comment is updated only if it
belongs to the authenticated user, otherwise a new comment is created. Serialize
publication jobs to avoid concurrent creates. Use a user token with Actions read
and issue-comment write access; tokens unable to resolve `gh api user` fail
closed (including installation-only tokens). No publication is enabled by default.

Upstream: https://github.com/coldteadotai/pr-lens (MIT), CLI 0.6.1,
graph schema 0.2.0; inspected at `0f55772ecffd9d1fd7f39378d6f183fad1596015`.
