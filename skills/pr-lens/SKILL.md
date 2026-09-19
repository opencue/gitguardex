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
and renders light/dark SVGs locally, with no second model call.

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
severity rules and merge gates are unchanged. Rendering does not retry malformed
graphs; inspect the error and rerun the review or opt out explicitly.

Upstream: https://github.com/coldteadotai/pr-lens (MIT), CLI 0.6.1,
graph schema 0.2.0; inspected at `0f55772ecffd9d1fd7f39378d6f183fad1596015`.
