## Why

GitGuardex deliberately keeps its nested agent worktrees out of VS Code's normal
repository scan so removed lanes do not leave stale Source Control providers.
Operators sometimes need the opposite view: one explicit workspace where every
Codex and Claude lane is visible with its own changes.

The README capability overview is also text-heavy. A dark, structured diagram and
a real VS Code worktree screenshot make the isolation model easier to understand.

## What Changes

- Add `gx setup --vscode-worktree-view` as the operator-facing alias for the
  existing parent workspace generator.
- Configure that generated multi-root workspace to discover nested Git
  repositories and worktrees while leaving the normal repository settings safe.
- Keep `--parent-workspace-view` as a backwards-compatible alias.
- Redesign the README capability section around a dark workflow diagram and a
  real VS Code worktree screenshot.

## Impact

- Affected runtime surfaces: setup argument parsing and both parent-workspace
  builders used by direct and protected-base setup paths.
- Default behavior is unchanged. Git repository discovery inside agent worktrees
  is enabled only in the explicitly generated `.code-workspace` file.
- No dependency changes.
