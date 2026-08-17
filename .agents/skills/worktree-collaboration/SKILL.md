---
name: worktree-collaboration
description: Use when multiple Codex agents collaborate in worktrees and you need explicit owner/joined handoff control for checklist items 4.1-4.4 before cleanup.
---

# worktree-collaboration

Use this skill to run a strict owner/joined collaboration flow for OpenSpec section `4` and prevent ambiguous cleanup handoff.

## Required Contract

1. `4.1` Owner records each joined Codex branch/worktree and scope before accepting work.
2. `4.2` Joined Codex stays inside assigned scope (review/propose/implement only in owned files).
3. `4.3` Owner acknowledges each joined output as `accept`, `revise`, or `reject` before cleanup.
4. `4.4` If no Codex joined, owner marks `4.4` checked with explicit `N/A`.

## Operator Steps

1. Add or update `## 4. Collaboration` in the active change `tasks.md`.
2. Record joined lanes in `4.1` before any integration edits.
3. Keep `4.3` unchecked until owner verdict is written.
4. If no helper joined, check `4.4` and include `N/A`.
5. Proceed to cleanup only after `4.3` is checked, or `4.4` is checked with `N/A`.

## Templates

Owner registration (`4.1` evidence):

```text
joined=<agent-branch> worktree=<path> scope=<files/modules>
```

Joined handoff:

```text
files=<paths>; behavior=<what changed>; verify=<commands/results>; risks=<follow-ups>
```

Owner acknowledgment (`4.3`):

```text
decision=<accept|revise|reject>; reason=<short rationale>; next=<merge|rework|drop>
```

No-joined path (`4.4`):

```text
No Codex joined this change; marking N/A and continuing.
```
