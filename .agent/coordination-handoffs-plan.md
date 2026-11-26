# Durable coordination handoffs

Reuse the local lock handoff record across agent sessions. An authenticated
worktree inbox shows applicable pending requests, including whether the owner
has seen them. Acknowledging a request records receipt but never moves the lock.
Keep approval, stale-lock detection, and recovery in the existing lock tool.

Make merge-ready an explicit PR handoff signal for the current GitHub head. It
is a sender declaration, not evidence of a passing gate, and invokes no merge.
Use the existing PR handoff delivery and receipt paths.

Verify with real sibling worktrees (request retry, visible after a fresh
invocation, wrong-owner denial, acknowledgment without transfer, approval),
authenticated inbox tests, and simulated GitHub reads for merge-ready (reject
closed and draft PRs and missing head; no GitHub write by default). Document the
workflow and upstream inspirations in the README.
