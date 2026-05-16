## Why

- The Active Agents VS Code companion still showed version `0.0.1` after plugin edits because nothing enforced a visible version bump when the shipped extension changed.
- That makes local reinstall verification ambiguous in VS Code and makes it too easy to ship plugin edits behind a stale installed version label.
- The companion also depended on workspace marker discovery or the first view open before activation, so a freshly reloaded VS Code window could still look stale even after installing the newest extension files.
- Even after the repo had a newer companion build, the installed extension still needed a manual install-script run, so the newest repo copy was easy to miss.

## What Changes

- Bump the shipped Active Agents extension manifest version.
- Add a focused regression that requires a higher extension version whenever plugin-shipping files change on a branch.
- Keep the live and template extension manifests aligned so installs and scaffolds report the same version.
- Add `onStartupFinished` to the shipped Active Agents manifests and lock that startup activation contract in the focused regression suite.
- Auto-install the newest workspace companion build when the running extension version is older, then offer a Reload Window prompt so the new version boots immediately.

## Impact

- Local VS Code installs show a new extension version after plugin edits.
- Reloaded VS Code windows activate the Active Agents companion immediately instead of waiting for view-open or marker-discovery triggers.
- When a workspace ships a newer companion version than the running extension, the companion updates itself and offers an immediate reload path.
- Future plugin branches fail fast in tests if they forget to bump the extension version.
- Runtime behavior changes are limited to earlier extension activation after startup, one-shot auto-update/reload prompting, and extension metadata/install-path visibility.
