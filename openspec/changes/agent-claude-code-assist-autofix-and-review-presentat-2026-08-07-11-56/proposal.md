## Why

`gx pr-review` (GitGuardex code-assist) only ever described problems. It had no
write-back path, so every fix was a human action, and the posted review had five
defects that made it fragile and hard to read:

1. Findings were never validated against the diff. GitHub 422s the whole review
   when one comment anchors outside it, and in `--gate-review` mode that throw
   becomes a merge block — a bad line number from the provider could block a
   healthy PR.
2. Every run POSTed a fresh review, so repeated `gx ship` attempts stacked
   duplicate inline comments.
3. Only `line` was sent, so a fix spanning multiple lines could not be expressed
   as a committable suggestion.
4. The summary body was one bare sentence; the merge-gate verdict was invisible,
   so a reader could not tell advisory findings from blocking ones.
5. The whole diff went into the prompt uncapped, and a truncated review read as
   a clean one.

`suggestion` was also documented to the provider as optional, so it was routinely
omitted and findings arrived as prose with no committable fix.

## What Changes

- **Diff anchoring** (`src/review-diff.js`, new): parse the unified diff into the
  RIGHT-side lines GitHub accepts, split findings into anchored/unanchored, post
  only anchored ones inline and report the rest in the summary. A rejected POST
  retries once as summary-only so a review never hard-fails on anchoring.
- **Dedupe**: every posted finding carries a fingerprint marker; a re-run reads
  the PR's existing comments and skips what it already said.
- **Range findings**: `start_line`/`start_side` are forwarded when a finding
  declares a range strictly before `line`.
- **Presentation**: severity alert callouts (`> [!CAUTION|WARNING|IMPORTANT|NOTE]`)
  with an emoji + category badge, a lede with the tail folded into `<details>`,
  and a summary report card with severity mix, gate verdict, findings table, and
  a provider/commit footer.
- **Prompt contract**: `suggestion` is required for bounded edits, `category` and
  `start_line` are requested, and the provider is told to drop findings it cannot
  anchor.
- **Diff cap**: capped at 220k chars with truncation surfaced in both the summary
  and the CLI output.
- **Auto-fix** (`src/review-fix.js`, new): `gx pr-review --fix` runs the provider
  in edit mode and commits what changed. `gx branch finish --gate-autofix`
  (`--gate-autofix-rounds N`, 1-5) lets the merge gate repair its own blocking
  findings: fix in the worktree, push, re-review with a fresh provider run, then
  re-evaluate.
- **Parse-order fix**: `extractJsonPayload` now tries the raw text before the
  fence extractor, so valid JSON containing a fenced `suggestion` no longer
  parses as the suggestion body.

## Impact

- Affected surfaces: `gx pr-review`, `gx branch finish --gate-review`, `gx ship`.
- New CLI flags: `--fix`/`--no-fix` on `pr-review`; `--gate-autofix`,
  `--no-gate-autofix`, `--gate-autofix-rounds` on `branch finish`. All default
  off, so existing invocations behave as before apart from the improved review
  presentation and the anchoring/dedupe safety.
- Write risk is bounded: auto-fix refuses protected branches, refuses uncommitted
  tracked edits, stages only paths the fix touched, is pinned to the gated branch
  by name, and never pushes or merges on its own outside the gate loop.
- The gate is still fail-closed. Auto-fix only ever converts a block into a merge
  after an independent re-review; an unfixable finding falls through to the block.
- Extra provider invocations when auto-fix is enabled: one fix run plus one
  re-review per round.
