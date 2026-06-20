# agent-claude-add-global-hooks-installer-script-2026-05-18-12-49 (minimal / T1)

Branch: `agent/claude/add-global-hooks-installer-script-2026-05-18-12-49`

Add an opt-in installer that wires guardex's `.githooks/*` into the user's
**global** `core.hooksPath`, so the hooks fire in every existing and future
repo on the machine. Surfaced via `npm run guardex:install-global` — not
`postinstall`, because silently mutating `git config --global` on every
npm install would surprise downstream users.

## Files

- `scripts/install-global-hooks.sh` — new. Idempotent. Refuses to overwrite
  an existing `core.hooksPath` set to a different directory.
- `package.json` — adds `"guardex:install-global"` script entry.

## Behavior

Running the installer:

1. `mkdir -p ${XDG_CONFIG_HOME:-$HOME/.config}/git/hooks`
2. Symlinks `pre-commit`, `pre-push`, `post-checkout`, `post-merge` from the
   gitguardex repo's `.githooks/` into that dir.
3. Sets `git config --global core.hooksPath` to that dir (only if currently
   unset OR already pointing there).

Reverse:

```bash
git config --global --unset core.hooksPath
```

Per-repo opt-out:

```bash
git config core.hooksPath .git/hooks
```

## Handoff

- Handoff: change=`agent-claude-add-global-hooks-installer-script-2026-05-18-12-49`; branch=`agent/claude/add-global-hooks-installer-script-2026-05-18-12-49`; scope=`scripts/install-global-hooks.sh + package.json`; action=`finish via PR`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/add-global-hooks-installer-script-2026-05-18-12-49 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
