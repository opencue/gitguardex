## Why

AI agents read `gx` output into their context window, so verbose output costs tokens
every turn. gitguardex already wires one token-saving tool into agents (the `rtk`
command-compression prompt part) and ships terse-by-default output, but the
**headroom** context-compression tool is referenced nowhere. Agents working in a
gx-wired repo are never told to compress large `gx` output / logs / dumps, and gx
has no hook to route its own output through a compressor.

## What Changes

Two backward-compatible layers, both graceful when headroom is absent (gitguardex is
a published npm package, so headroom must never be a hard dependency):

- **Advisory** — add a prompt-only `headroom` part to the AI setup checklist
  (`gx prompt`), mirroring the existing `rtk` part, plus `compress` / `compression` /
  `headroom-mcp` aliases. Add a headroom bullet to the managed AGENTS companion-tooling
  block so the guidance propagates into every consumer repo.
- **Runtime** — add `GUARDEX_COMPRESS_CMD` support: when set, gx pipes its large
  narrative output (currently the `gx prompt --snippet` block) through the configured
  filter. Gated on terse/non-TTY mode + a size threshold; skips machine-readable
  (JSON-looking) text; fails open to the original text on any error.

## Impact

- Affected surfaces: `src/context.js` (AI_SETUP_PARTS + aliases), `src/output/index.js`
  (new `compressBlock` / `printCompressible` helpers), `src/cli/commands/prompt.js`
  (snippet routed through the compressor), `templates/AGENTS.multiagent-safety.md`.
- Default behavior is unchanged: with no `GUARDEX_COMPRESS_CMD` set, output is
  byte-for-byte identical to today. `gx prompt --exec` never includes the prompt-only
  headroom part. No API/schema changes; new env knob only.
- Risk: low. The compressor runs with `shell:false` argv (no shell interpolation),
  a timeout, and a fail-open fallback; machine-readable output is never compressed.
