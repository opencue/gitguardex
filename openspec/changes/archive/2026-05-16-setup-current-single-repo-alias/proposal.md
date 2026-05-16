## Why

- `gx setup` recurses into nested repos by default, so a top-level workspace can rewrite child repos when the user only wanted to bootstrap the current repo.
- `--no-recursive` already limits setup to the target repo, but users now expect the shorter `--current` alias after `gx doctor --current` shipped.
- The user explicitly wants both `gx doctor --current` and `gx setup --current` to leave nested repos under the target path untouched.

## What Changes

- Accept `--current` as a setup alias for the existing single-repo traversal behavior.
- Update recursive setup messaging to advertise `--current` alongside `--no-recursive`.
- Add regression coverage proving `gx setup --current` leaves nested repos unmodified.

## Impact

- Affected surface: `src/cli/args.js`, `src/cli/main.js`, `test/setup.test.js`.
- Expected outcome: `gx setup --current` scopes bootstrap/repair work to the target repo without mutating nested repos.
- Risk: low, because the alias reuses the existing non-recursive traversal path.
