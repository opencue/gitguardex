# Multi-Agent Execution Contract (Default)

Use this contract whenever multiple agents are active in parallel.

The marker-managed `multiagent-safety` section in `AGENTS.md` is the canonical lifecycle contract for branch/worktree startup, completion chain (`commit -> push -> create/update PR -> merged`), and PR/merge/cleanup evidence. This document captures the repo-specific supplements that live alongside it.

Apply these repo-specific supplements in addition to that canonical contract:

1. Local base safety
- Local `dev` is protected: never edit, stage, or commit task changes directly on `dev`.
- If currently checked out on `dev`, create the agent branch/worktree first and only then begin edits.
- Creating or attaching an agent worktree must never switch the primary local checkout branch.
- `agent-branch-start` and `agent-branch-finish` must fast-forward local `dev` from `origin/dev` before branch creation/merge.

2. Ownership and lock discipline
- Claim owned files before edits: `gx locks claim --branch "<agent-branch>" <file...>`.
- For a local worktree conflict, the waiting agent runs `gx locks handoff-request -- <file>`. The lock stays with its owner. Use `gx locks handoffs` to see requests and completed transfers.
- Commit the handoff file, and update the recipient branch to include the owner's commit first. Only the current owner runs `gx locks handoff-approve <id> --check '<verification command>'` from its worktree. Named lanes must set their own `GUARDEX_AGENT_ID` for both operations.
- Handoffs neither run the check nor grant delete approval. Do not use the existing maintenance release command to take an active lock. Local branch/agent IDs coordinate trusted peers; they are not authentication between users. Remote shared Git locks do not support handoffs.
- If `main.rs` is in scope, claim lock first: `python3 scripts/main_rs_lock.py claim --owner "<agent-name>" --branch "<agent-branch>"`.
- Non-integrator branches must not edit `main.rs` unless explicit emergency override is approved.
- Pre-commit blocks `agent/*` commits with unclaimed files or missing valid `main.rs` lock.

3. Shared behavior protection
- Do not delete, replace, or simplify critical paths (auth/session/proxy/API wiring) without explicit request or approved checkpoint plus regression coverage.
- Preserve parallel safety: never revert unrelated changes and report handoff conflicts.

4. Integrator finalization gate
- Final handoff must include files changed, behavior touched, verification commands/results, and risks/follow-ups.
- Integrator confirms no critical behavior loss, respected ownership boundaries, and verification gates passed.
