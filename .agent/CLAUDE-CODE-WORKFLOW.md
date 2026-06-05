# Claude Code Workflow

When Guardex is enabled, Claude Code sessions use the same agent-worktree + OpenSpec flow as Codex; there is no separate `claude-agent.sh` wrapper — Claude calls the generic scripts directly.

## Tiering (token-aware scaffolding)

`gx branch start` and `gx branch finish` accept `--tier {T0|T1|T2|T3}` to size the OpenSpec scaffolding to the change's blast radius. Default is `T1` (notes.md only — most tasks are small, and a full T3 plan workspace costs thousands of tokens an agent never reads). Escalate explicitly with `--tier T2` for a behavior change or `--tier T3` for plan-driven work. The tier is recorded in the bootstrap manifest so `finish` picks it up automatically.

| Tier | Use for | Scaffolding on `start` | Gates on `finish` |
|------|---------|------------------------|--------------------|
| `T0` | typos, dep bumps, format-only, comment-only | none (no `openspec/changes/` or `openspec/plan/` files) | tasks gate skipped |
| `T1` | ≤5 files, 1 capability, no API/schema change | `openspec/changes/<slug>/notes.md` + `.openspec.yaml` only | tasks gate skipped |
| `T2` | behavior change, API/schema, multi-module | full change workspace (`proposal.md`, `tasks.md`, `specs/.../spec.md`); no plan workspace | full gates |
| `T3` | cross-cutting, multi-agent, plan-driven | full change workspace + plan workspace with role `tasks.md` files | full gates |

Examples:

```bash
# T0 (typo / trivial): fastest path, no OpenSpec artifacts
gx branch start --tier T0 "fix-typo-in-readme" "claude-name"

# T1 (small fix): notes-only scaffold, commit message is the spec of record
gx branch start --tier T1 "tighten-retry-backoff" "claude-name"

# T2 (explicit; real behavior changes): full change spec, no plan workspace
gx branch start --tier T2 "add-oauth-endpoint" "claude-name"

# T3 (explicit; plan-driven): plan workspace + full OpenSpec
gx branch start --tier T3 "refactor-payment-pipeline" "claude-name"
```

`finish` reads the tier from the manifest automatically; passing `--tier` on finish is only needed to override (e.g., upgrading to a fuller gate).

## Default flow

1. Start a sandbox worktree:

   ```bash
   gx branch start [--tier T0|T1|T2|T3] "<task>" "claude-<name>"
   ```

   Creates `agent/claude-<name>/<slug>` under `.omc/agent-worktrees/`, scaffolds the OpenSpec change + plan workspaces (sized by tier), and records the bootstrap manifest. Codex sessions keep using `.omx/agent-worktrees/`. Missing `codex-auth` silently falls back to an empty snapshot slug (expected for Claude sessions).

2. Work inside the sandbox only:

   ```bash
   cd .omc/agent-worktrees/agent__claude-<name>__<slug>
   gx locks claim --branch "agent/claude-<name>/<slug>" <file...>
   # implement + commit inside this worktree
   ```

   Do not edit the primary `dev` checkout; multiagent-safety rules apply unchanged.

3. Finish via PR + cleanup:

   ```bash
   gx branch finish \
     --branch "agent/claude-<name>/<slug>" \
     --base main --via-pr --wait-for-merge --cleanup
   ```

   Runs the OpenSpec tasks gate, merge-quality gate, and worktree prune — identical to the Codex path.

## Default Claude finish (non-negotiable)

Claude's default completion command **must** include all four flags in this order: `--via-pr --wait-for-merge --cleanup`. Never stop at bare `--via-pr`; that strands commits and leaves worktrees dirty (see `.agent/STALLED-WORKTREE-RECOVERY.md`). The only time to deviate is when the user explicitly asks to keep the lane open (e.g. "don't merge yet", "leave the branch").

When branch protection blocks a direct merge, enable auto-merge as soon as the PR URL is known so `--wait-for-merge` can observe the state transition:

```bash
# finish also prints the PR URL / number; use it immediately:
gh pr merge <PR-NUMBER> --repo <owner>/<repo> --auto --squash
```

If checks are slow, extend the poll window rather than dropping the flag:

```bash
GUARDEX_FINISH_MERGE_TIMEOUT=3600 \
  gx branch finish \
    --branch "agent/claude-<name>/<slug>" \
    --base main --via-pr --wait-for-merge --cleanup
```

One-shot sweep for multiple finished lanes:

```bash
gx finish --all       # iterates every agent/* branch the current user owns
```

## Notes

- Slash commands `/opsx:*` in `.claude/commands/opsx/` drive the OpenSpec artifact flow.
- `.claude/settings.json` already wires the `skill_activation` / `skill_guard` hooks, so project-conventions enforcement runs automatically on edits.
- `skill_guard` blocks most Bash commands while the shell is on `dev`; run the `gx branch ...`, `gx locks ...`, and `gx branch finish ...` commands from within the worktree, or prefix the invocation with `ALLOW_BASH_ON_NON_AGENT_BRANCH=1` when calling from the primary checkout.
