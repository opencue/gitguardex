# Token-Efficient Execution

This document captures the token-discipline rules referenced from `AGENTS.md`. The marker-managed `multiagent-safety` section in `AGENTS.md` also restates a "Token / context budget" subsection scoped to multi-agent execution; treat both as additive.

## Planning

- Start each task with a plan of at most 4 bullets.
- Work in phases:
  1. minimal inspection
  2. grouped edits or grouped repo actions
  3. focused verification
  4. compact summary
- Low output alone is not a defect. A bounded run that finishes in roughly <=10 steps is usually fine; low output stretched across 20+ steps with rising input is fragmentation.
- Treat obvious follow-on actions as part of the active phase; do not stop for tiny internal checkpoints.
- If context grows or the session becomes fragmented, write a short working summary and continue from it.
- Checkpoint after each milestone or roughly every 15-25 tool calls: keep only `task`, `done`, `current status`, `next`, and the latest meaningful evidence; drop the raw transcript from active context.

## Token Discipline

- Do not re-read the same file, line range, or command output unless the file changed or new evidence requires it.
- Prefer targeted reads: `rg`, `head`, `tail`, `git diff`, and exact line ranges.
- Keep command output compact and relevant.
- Avoid repeated status checks unless something changed.
- Treat repeated `sed` / `cat` peeks, tiny diagnostic retries, and repeated `write_stdin` as red flags. When they appear, stop the probe loop and reset to one bounded phase.

## Command Discipline

- Batch related shell commands whenever safe.
- Prefer one-shot non-interactive commands, scripts, or exact invocations over interactive loops or repeated stdin driving.
- For diagnosis, gather the relevant evidence in one pass, then summarize once.
- If the session turns fragmented, collapse back to inspect once, patch once, verify once, and summarize once.

## Git And PR Workflow

- Treat local git and PR work as one bounded phase when possible: inspect status, stage intended files, commit, push, and check PR or CI.
- Do not narrate every trivial git step; summarize branch, commit, PR, and CI state once per phase.

## Reporting

- Use this format:
  1. Plan
  2. Actions taken
  3. Verification
  4. Result
- Keep reports concise and focused on blockers, material changes, and verification outcomes.

## Verification

- Always verify before finalizing.
- Choose the smallest verification that meaningfully proves the change.
- Do not run redundant checks.
- Pause only for destructive actions, ambiguous intent, missing credentials or access, or conflicting evidence.

## Token / Context Budget (multi-agent supplement)

Core token/context-budget rules live in the always-loaded `### Token / context budget` subsection of the `multiagent-safety` block in `AGENTS.md`. Extra operational heuristics, not repeated there:

- Switch to low-overhead mode on prompts about token inefficiency, reviewer mode, minimal overhead, or session waste.
- Front-load scaffold/path discovery into one grouped inspection pass; avoid serial `ls` / `find` / `rg` / `cat` retries.
- Treat repeated `write_stdin`, `sed` / `cat` peeks, and tiny diagnostic follow-ups as strong negative signals.
- Treat local edit/commit, remote publish/PR, CI diagnosis, and cleanup as bounded phases.
- Do not spend fresh narration or approval turns on obvious safe follow-ons inside an already authorized phase.
