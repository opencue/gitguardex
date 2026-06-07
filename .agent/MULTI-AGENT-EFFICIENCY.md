# Multi-Agent Token Efficiency

How to spend the fewest tokens when more than one agent (or subagent) works a
task — during both **review** and **implementation**. Fan-out is only cheaper
when each agent has a narrow job and hands back a compact result; a subagent that
reads widely and returns prose can cost more than doing the work inline. This
subdoc is the long form of the `### Multi-agent token efficiency` rules in the
multiagent-safety contract.

## The cost model

A subagent pays a fixed setup cost (its own system prompt + context) and a
variable cost (what it reads). It saves tokens only when it keeps a large read or
review surface OUT of the main context and returns a small summary. So:

- Wide surface, small answer → fan out (e.g. "which 4 files handle auth?").
- Narrow surface, or the answer IS the full output → stay inline.

## Practices

### Scout, then implement
Send a cheap-model subagent to locate the 3-5 files that matter and return a
summary (entry points, call sites, deps). Edit those directly in the main
context. Reading 20+ files inline to find the 4 that count burns expensive tokens
on cheap work.

### One agent, one job
Give each subagent a single objective and expect one output — analyze OR fix,
explore OR draft, never both. A multi-objective agent muddles its context and
returns weaker results for more tokens.

### Review by parallel role, not one big pass
Split a review into independent lenses run in parallel — correctness, security,
consistency — then synthesize the findings. Cheaper and sharper than one reviewer
holding the whole diff in context, and the lenses catch each other's blind spots.
In this repo the finish review-gate is the natural place to do this.

### Route models to task weight
Match model capability to task complexity:

| Task | Tier |
|------|------|
| scan, explore, file lookup, draft | cheap (e.g. `haiku`) |
| implement, debug, code generation | mid (e.g. `sonnet`) |
| architecture, complex review, planning | top (e.g. `opus`) |

`CLAUDE_CODE_SUBAGENT_MODEL` sets the subagent tier for a session; `/model`
switches the main model mid-session.

### Don't fan out trivial work
One-file tweaks, typos, version bumps, and bounded edits stay direct — see
**Task-size routing** in the contract. The subagent setup cost only pays off when
the read or review surface is genuinely wide. Spawning an agent for a one-liner is
a net loss.

### Return compact, not complete
A subagent's job is to shrink context, not relay it. Have it return the
conclusion, the file:line, and the one fact that proves it — not the files it
read. Full logs and stdout belong in artifacts, not in the handoff.

## When NOT to use this
- The task is one bounded edit (the contract's Task-size routing already covers
  it — solve directly, caveman-only).
- The answer is inherently the whole output (e.g. "write this 400-line file") —
  a subagent can't compress that.
- You're under a tight context where the round-trip overhead exceeds the saving.

Verify once per phase (see `.agent/TOKEN-DISCIPLINE.md`); a bounded run is fine.
