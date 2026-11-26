# Advisory BugHunter pass

## Goal and scope

Add an opt-in behavioral bug pass to the shared Codex and Claude PR review.
Reuse the provider that completed the primary review. Publish the result in
the same GitHub review and in local review artifacts. Keep the existing merge
verdict, inline comments and automatic fixes independent of this pass.

Adapt the evidence-first review method, not the runtime, of
[Bug Hunter's hunter skill](https://github.com/codexstar69/bug-hunter/blob/b412f9885e3ec074625a88c862c3f5b6724ec3b4/skills/hunter/SKILL.md).
Only the fetched, capped PR diff goes into the prompt. Do not load repository
instructions, run code, use tools, or generate exploit or patch instructions.

## Implementation and verification

1. Add the bounded prompt, output validation and escaped advisory report.
2. Run one isolated provider call after the primary review, when
   `GUARDEX_REVIEW_BUG_HUNTER=1`. Preserve review posting and head checks.
3. Test both providers and the fallback, changed-line anchoring, failure and
   truncation status, disabled behavior, and GitHub summary output. Run the
   existing review tests to check for regressions.

This feature does not claim an improvement in detection without a matched A/B
evaluation.
