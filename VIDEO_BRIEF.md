# GitGuardex — Video Design Brief

A hand-off brief for a motion designer (or AI video tool: Runway / Sora / Veo /
Kling). Goal: a 30–45s promo/explainer that makes the problem felt in the first
5 seconds and lands the fix by the end.

---

## 1. The one-liner

> **Guardian t-rex for multi-agent repos.** Many AI agents, one clean repo.

Tagline (mascot voice): *"guard many agent. keep one repo clean."*

## 2. What we're selling (so the visuals stay true)

When you run many AI coding agents (Codex, Claude Code, humans) on the **same**
repo, they collide — editing the same files, overwriting and deleting each
other's work. More agents → *less* progress. GitGuardex fixes this with:

- **Isolated `agent/*` branch + worktree per task** — no shared working dir.
- **File locks** — an agent claims files before editing; others are blocked.
- **Deletion guard** — claimed files can't be ghost-deleted by another agent.
- **Protected base** — `main`/`dev` are off-limits; everything merges via PR.

## 3. Narrative arc (the spine of the video)

| Beat | Seconds | On screen |
| --- | --- | --- |
| **Chaos** | 0–8 | Agents swarm one repo, colliding on the same files. Red clash flashes, files flicker/overwrite, a progress bar goes *backwards*. |
| **Turn** | 8–12 | A heartbeat-pause. The t-rex steps in. Everything freezes. |
| **Order** | 12–28 | Each agent peels into its own lane (worktree). Files snap shut with a lock glyph. `main` sits on a protected pedestal. |
| **Payoff** | 28–40 | Lanes converge cleanly into single green PR-merge into `main`. Progress bar fills forward, fast. |
| **Logo / CTA** | 40–45 | Logo + `npm i -g @imdeadpool/guardex` + tagline. |

## 4. Visual style

- **Vibe:** modern dev-tool / terminal-noir. Dark canvas, crisp monospace,
  neon accents. Think "CI dashboard meets Jurassic Park control room."
- **Palette:** near-black bg `#0d1117`; lane/agent accents — codex blue
  `#0b76c5`, claude violet `#7aa2f7`, lock/clean green `#97ca00`, clash red
  `#cb3837`, protected-base gold `#d4ac0d`.
- **Type:** monospace for code/branch names (JetBrains Mono / IBM Plex Mono);
  clean geometric sans for the tagline.
- **Motion:** snappy, mechanical, satisfying. Locks *click*. Lanes *slide*.
  Merges *snap*. No floaty easing — this tool is about control.

## 5. Key motifs (reuse these as recurring visual language)

1. **Lanes** — horizontal tracks, one per agent, each labeled
   `agent/codex/login-refactor`, `agent/claude/token-rotation`, etc.
2. **Lock glyph** — appears on a file the instant an agent claims it; a second
   agent's cursor bounces off it.
3. **The t-rex** — guardian, not gimmick. Calm, deliberate, authoritative.
   Appears at the "turn" and again at the logo. Stylized/low-poly or line-art,
   not cartoonish.
4. **Protected pedestal** — `main` raised on a plinth with a shield; agent hands
   can't touch it directly, only PR arrows reach it.
5. **Terminal HUD** — a `gx` status panel ticking live: `locks ● 4 files
   claimed by 3 agents`, `branch agent/codex/login-refactor (sandbox of main)`.

## 6. Hero shot (the money frame for the thumbnail)

Split composition:
- **Left ("before"):** tangle of overlapping cursors hammering one file,
  red clash markers, chaos.
- **Right ("after"):** clean parallel lanes, green locks, the t-rex standing
  guard over a pristine `main`.

## 7. Voiceover / on-screen copy (optional, pick one register)

**Punchy:**
> Run thirty agents on one repo? They'll fight over every file.
> GitGuardex gives each one its own lane, locks what it touches,
> and lets nothing near `main` without a PR.
> Many agents. One clean repo.

**Minimal (text-only, no VO):**
- `30 agents. 1 repo.` →
- `they collide.` →
- `[t-rex]` →
- `isolated lanes · file locks · PR-only merges` →
- `many agents. one clean repo.` →
- `gitguardex`

## 8. AI-video generator prompt (paste-ready)

> Cinematic 35-second tech promo, dark terminal-noir aesthetic, near-black
> background (#0d1117), neon accents in blue, violet, green and gold, crisp
> monospace UI overlays. OPENING: chaotic swarm of glowing cursors all editing
> the same code file, red collision flashes, a progress bar moving backwards,
> tense. TURN: a stylized low-poly guardian Tyrannosaurus rex steps into frame,
> everything freezes. RESOLUTION: the cursors separate into clean parallel
> horizontal "lanes," each lane labeled with a code branch name, glowing lock
> icons snap shut on files, a central "main" branch sits protected on a shielded
> pedestal. PAYOFF: the lanes merge smoothly into the protected branch via
> arrows, the progress bar fills forward fast and turns green. Snappy mechanical
> motion, satisfying clicks, confident pacing. End on a clean logo card. No
> text artifacts, high detail, 16:9.

## 9. Deliverables

- 16:9 master (30–45s) for site/README hero + YouTube.
- 9:16 cut (≤20s) for social — keep chaos→t-rex→clean lanes→logo.
- 1:1 thumbnail = the §6 hero shot.
- Animated logo sting (~3s) reusable as an outro.

## 10. Brand guardrails

- T-rex is a **guardian**, calm and competent — never goofy/aggressive.
- Branch/command text must be real: `gx branch start`, `gx branch finish
  --via-pr`, `agent/<role>/<task>`. (Avoid inventing fake CLI.)
- Disclaimer somewhere small: *not affiliated with OpenAI, Anthropic, or Codex.*
- Logo: `logo.png` at repo root.
