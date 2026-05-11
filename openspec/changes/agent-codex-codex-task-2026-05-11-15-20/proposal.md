## Why

- GitGuardex needs a local PR review runner that can reuse already-authenticated Codex or Claude CLI sessions without requiring OpenAI or Anthropic API keys.
- GitHub posting should work with GitHub Actions `GITHUB_TOKEN` or local `gh` auth, with an artifact fallback when GitHub auth is unavailable.

## What Changes

- Add `gx pr-review --provider codex|claude --pr <num> [--post]`.
- Fetch the PR diff through `gh pr diff <num>`, prompt the selected local CLI for structured findings, and post one GitHub review with inline comments through `gh api`.
- Write a markdown review artifact instead of posting when `--post` is omitted or GitHub auth is unavailable.

## Impact

- Scope is CLI-only and self-hosted-runner friendly. It does not introduce model API dependencies or hosted bot state.
- Inline comment accuracy depends on provider output using changed-file paths and changed-line numbers.
