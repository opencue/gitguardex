## ADDED Requirements

### Requirement: Guarded Post-Merge Base Pull

After `gx branch finish` successfully merges an agent branch and local base worktree refresh is enabled, Guardex SHALL attempt to fast-forward the local base worktree from `origin/<base>` using `git pull --ff-only` even when the base worktree has local modifications.

#### Scenario: Dirty base worktree can be fast-forwarded
- **GIVEN** a local base worktree has dirty edits that do not conflict with the merged remote changes
- **WHEN** `gx branch finish` completes a merge and refreshes the local base worktree
- **THEN** Guardex SHALL run the guarded fast-forward pull
- **AND** the base worktree SHALL contain the merged remote change
- **AND** the dirty local edits SHALL remain intact.

#### Scenario: Dirty base worktree cannot be safely fast-forwarded
- **GIVEN** a local base worktree has dirty edits that Git would overwrite during the post-merge pull
- **WHEN** `gx branch finish` attempts the guarded fast-forward pull
- **THEN** Guardex SHALL leave the base worktree dirty edits untouched
- **AND** Guardex SHALL emit a warning instead of stashing, rebasing, or forcing the update.
