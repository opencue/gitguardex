---
name: guardex-merge-skills-to-dev
description: "Use when you need to merge SKILL.md updates from agent branches/worktrees into the local base branch (default: dev) with the multiagent-safety flow."
---

# GuardeX Merge Skills to dev

Use this skill when you only want to promote Codex skill file updates into the base branch (normally `dev`) without editing the visible base checkout directly.

## What this merges

- `skills/**/SKILL.md`
- `.codex/skills/**/SKILL.md`
- `templates/codex/skills/**/SKILL.md`

## Merge runbook (safe path)

1. Resolve the base branch:

```sh
BASE_BRANCH="$(git config --get multiagent.baseBranch || echo dev)"
echo "$BASE_BRANCH"
```

2. Start a dedicated integration sandbox from base:

```sh
gx branch start "merge-skill-files-to-${BASE_BRANCH}" "skill-merge" "$BASE_BRANCH"
```

3. Enter the sandbox worktree printed by the command above.

4. Pull only skill files from each source agent branch:

```sh
SOURCE_BRANCH="<agent-branch>"
git checkout "$SOURCE_BRANCH" -- ':(glob)skills/**/SKILL.md' ':(glob).codex/skills/**/SKILL.md' ':(glob)templates/codex/skills/**/SKILL.md'
```

5. Verify scope before commit:

```sh
git status --short
git diff --name-only
```

6. Commit and merge back to base using guardex finish flow:

```sh
git add skills .codex/skills templates/codex/skills
git commit -m "Merge skill file updates into ${BASE_BRANCH}"
gx branch finish --branch "$(git rev-parse --abbrev-ref HEAD)" --base "$BASE_BRANCH" --via-pr --wait-for-merge --cleanup
```

## Notes

- If a source branch has non-skill changes, this runbook keeps them out of the merge.
- If merge conflicts occur, resolve only within the skill files, then rerun `gx branch finish`.
- Do not commit directly on `dev`/`main`; always merge through an agent branch/worktree.
