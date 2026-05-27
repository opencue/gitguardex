<!-- monorepo-apps:START -->
## Monorepo workflow (`apps/*`)

This repo has `apps/*` (storefront, backend, etc.). The **root worktree is kept on the protected base branch** so the user can keep `pnpm <app>:dev` running there and see merged-to-main state in real time. Never edit or commit on the root worktree.

### Per-task loop

1. **Start in a sibling worktree.** Run `gx pivot` (auto) or `gx branch start --type <kind> --task <slug>` — both spawn a worktree under `.omx/agent-worktrees/` on a fresh `agent/*` branch.
2. **Run scoped dev servers from your worktree**, e.g. `pnpm --filter storefront dev` from `.omx/agent-worktrees/<your>/`. Pick a non-conflicting port if the user is already running the root.
3. **Commit + push** as you go — the agent branch tracks `origin/agent/*`. The user can watch your branch live in their git client.
4. **Ship via PR.** When the user approves the work, run `gx ship` (alias for `gx finish --via-pr --wait-for-merge --cleanup`). This: opens a PR → auto-merges to the protected base → prunes the worktree + branch.
5. The user's root worktree is now showing the merged result on next pull.

### Cross-app guardrails

- Edits to **both** `apps/storefront` AND `apps/backend` in one branch → split into two PRs unless they must land atomically. Reviews stay clean, rollbacks stay surgical.
- Edits to root configs (`pnpm-workspace.yaml`, `turbo.json`, `package.json`) lock every other agent. Claim → change → release fast.
- Migrations under `apps/backend/src/migrations/*` require explicit user OK before commit — they're irreversible on prod.
- Don't `pnpm install` from the root unless the user asks; do it inside your worktree if you added a dep.

### What the user sees

- `git log --all --graph --oneline` shows every active agent branch in real time.
- `gx status` lists active worktrees + their branches.
- Each `gx ship` produces a PR — link goes in the user's GitHub notifications.
<!-- monorepo-apps:END -->
