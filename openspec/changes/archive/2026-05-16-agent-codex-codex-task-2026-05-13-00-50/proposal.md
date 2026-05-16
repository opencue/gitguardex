## Why

- Claude Code reads `CLAUDE.md`, while Guardex keeps the canonical repo guidance in `AGENTS.md`.
- Fresh `gx setup` repos currently get `AGENTS.md` only, so Claude sessions can miss the same safety contract.

## What Changes

- Make `gx setup` / `gx doctor` create a root `CLAUDE.md` symlink to `AGENTS.md` when `CLAUDE.md` is absent.
- Preserve existing root `CLAUDE.md` files unchanged.
- Update setup regression coverage and README guidance.

## Impact

- Affected surface is setup/doctor scaffold output only.
- Existing user-authored Claude guidance remains untouched.
