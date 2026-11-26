# Cue task integration

GitGuardex remains the authority for task identity, checkout eligibility and
exclusive launch. Cue owns profile selection and presentation.

1. Expose ready linked task worktrees as versioned JSON. Emit a single
   versioned result from a successful explicit-ID start, with progress on
   stderr. Keep normal text and the read-only preview unchanged.
2. Recheck task identity and occupancy under an exclusive launch lock before
   starting a supervised child. Never create a worktree from the resume path.
3. Verify creation, reuse, read-only listing, stale or mismatched selection,
   and two attempts to run a writer against the same disposable task. Verify
   Cue against the local CLI and retain its legacy start path.
