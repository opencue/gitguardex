# Gap 06 — Per-remote trust policy

## Problem

When a `gx branch finish` flow pushes a parent repo whose submodules live in a different GitHub org (e.g. parent repo on `recodeee/`, submodule on `Webu-PRO/lifted.sk-storefront`), the Codex/Claude host approval policy blocks the submodule push every time. gx has no way to declare "this remote pattern is trusted for this operation". The choice today is binary: approve every push at the host level (wide blast radius), or get blocked every time (high friction).

## Evidence in current code

- Session memory S715–S716 (2026-05-11 12:38, 12:41): user explicitly hit this issue with `git@github.com:Webu-PRO/lifted.sk-storefront.git` during a `gx branch finish` flow.
- `src/finish/index.js` calls `git push` for submodules without consulting any local allowlist.
- No `.gx/trust.json` or equivalent config exists in `src/context.js`.
- Codex external-approval boundary is documented in `CLAUDE.md` under "External approval boundary" — gx is required to either request narrow approval or stay blocked.

## Proposed CLI surface

```bash
gx config trust add <pattern>        # add a remote pattern (glob or regex) to the trust list
gx config trust list                 # show current trust list
gx config trust remove <pattern>     # remove
gx config trust test <remote-url>    # exit 0 if the URL matches a trust entry
```

Persisted at repo-root `.gx/trust.json`:

```json
{
  "schemaVersion": 1,
  "remotes": [
    { "pattern": "git@github.com:Webu-PRO/*.git",          "scopes": ["submodule-push"] },
    { "pattern": "https://github.com/recodeee/*.git",      "scopes": ["push", "submodule-push", "pr-create"] }
  ]
}
```

When `gx branch finish` is about to push to a remote, it consults the trust list. A trusted remote means gx pre-emits a structured "trusted push" event so the host (Codex/Claude) approval prompt can route to a narrower approval path. **gx does not bypass host approval** — it only annotates so external tooling can make a better call.

## Tier / effort

- **Tier**: T1 (≤ 5 files, single capability, no behavior change to existing flows when no trust list is configured).
- **Effort**: ~5 files / ~half day. New `src/trust/index.js` + subcommands under `gx config` + integration call in `src/finish/index.js` + tests.

## Dependencies

None. Soft pair with Gap 02 (events): the "trusted push" annotation should appear in the event log.

## Open questions

- Glob vs. regex pattern syntax? Lean **glob** (`fnmatch`-style) for simplicity; regex is a follow-up.
- Where does the file live: `.gx/trust.json` (per-repo) or `~/.gx/trust.json` (per-user)? Lean **both**, with repo-local overriding user-level.
- Should `gx config trust add` warn loudly when adding wildcards (`*` at start of pattern)? Yes.
- Interaction with host approval: gx **must not** present this as a way to silently auto-approve. The trust list is a *hint*, not an override.

## Acceptance criteria

- [ ] `gx config trust add <pattern>` writes to `.gx/trust.json` with schema version 1.
- [ ] `gx config trust list` prints the current entries with pattern, scopes, source (repo vs. user).
- [ ] `gx config trust test <url>` exits 0 on match, 1 on miss, prints the matched pattern.
- [ ] `gx branch finish` consults the trust list and emits a structured annotation when pushing to a trusted remote.
- [ ] gx never bypasses host approval; it only annotates. Document this loudly in the trust subcommand help text.
- [ ] Regression test: with empty trust list, behavior is identical to today.
