# /gx-setup

Install gitguardex scaffolding into the current repo (or a target one).

```
gx setup            # current repo
gx setup --target /path/to/repo
gx setup --dry-run  # preview without writing
```

What it does:

1. Installs companion tools (interactive prompt; skip with `--no-global-install`).
2. Bootstraps `.omc/`, `.githooks/`, lock registry, OpenSpec scaffolding.
3. Configures git hooks (`pre-commit`, `pre-push`, `post-checkout`) to defend
   the protected base branch.
4. Optionally installs Spec Kit (`--no-speckit` to opt out).
5. Runs a final scan and prints any remaining safety findings.

After `gx setup`, also run `gx claude install` (or `/gx-setup --claude`) to
wire up Claude Code hooks, slash commands, the agent skill, and the abide rule
hooks that enforce this repo's `AGENTS.md` / `CLAUDE.md` on every edit (needs a
TypeSafe key via `abide login`; `--no-abide` skips it).

Then: `gx pivot "<task>" "<agent>"` to start work, or `gx status` to verify.
