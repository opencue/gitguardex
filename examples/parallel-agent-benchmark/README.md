# Parallel-agent benchmark

Compare plain Git worktrees with GitGuardex file claims on two identical
workloads: two agents change the **same** file, then two agents change
**different** files as a control. Each arm starts from a fresh Git repository;
the fixture intentionally offers both edits against that same starting
revision. The benchmark alternates arm order between repetitions.

## Reproduce locally

From the GitGuardex source checkout, with Node.js 18+, Git and Python 3:

```bash
node scripts/benchmark-parallel-agents.js --pairs 10 > parallel-agents.json
jq -r '.trials[] | .scenario as $task | .results[] |
  [$task,.arm,.deniedClaims,.integrationConflicts,.manualInterventionsRequired,.localMerges]
  | @tsv' parallel-agents.json
```

No credentials or network are needed. The default is a deterministic scripted
driver, **not a model evaluation or proof of real-world performance**.
The raw JSON contains one row per job in each arm, including claim results,
commit IDs and integration outcomes:

- **Offered overlaps:** both jobs initially target the same path, whether or not
  a claim prevents the second edit. This input is identical across arms.
- **Denied claims:** GitGuardex refuses an actual cross-worktree claim before
  writing. The driver then waits for release and retries on the latest base.
- **Integration conflicts / manual interventions required:** an unresolved Git
  merge conflict that would need intervention; the harness records and aborts
  that merge. It does not count a simulated resolver as a human action.
- **Local merges:** accepted edits that Git merged as-is. **Successful PRs:**
  GitHub confirmed a merge, or `null` when GitHub was not measured.

### Recorded offline run

[`offline-results.json`](./offline-results.json) is the raw output from
`node scripts/benchmark-parallel-agents.js --pairs 3` (whitespace compacted).
Across the three overlap pairs, plain Git had three merge conflicts.
GitGuardex denied three initial claims and had no merge conflicts after the
blocked lane retried on the new base. Both arms merged all six disjoint edits.
No hosted PRs or model performance were measured.

## Use the same real model in both arms

Provide a trusted executable (a wrapper around the model CLI or API of your
choice) and a pinned model identifier:

```bash
node scripts/benchmark-parallel-agents.js --pairs 10 \
  --driver ./my-benchmark-driver --model PINNED_MODEL_ID > model-results.json
```

The executable receives one JSON object on stdin with
`{model, task, file, entry, content}`. Write only the complete replacement
file to stdout; a nonzero exit or invalid edit is recorded in the result.
Use the same provider, model configuration and wrapper for all jobs. The
wrapper runs in each job's temporary worktree with your account's permissions
and can use your configured provider credentials. It's not a sandbox.
Claims are scheduled deterministically to reproduce contention, so this does
not measure simultaneous model throughput. Do not report broad win rates
from these two synthetic tasks.

## Measure real PR outcomes (explicit opt-in)

Create a **disposable private** GitHub repository named
`gitguardex-benchmark`, initialized with a default branch and merge commits
enabled. Use `gh auth login` with write access to that repository. GitHub
branch protection is never bypassed.

```bash
node scripts/benchmark-parallel-agents.js --pairs 1 \
  --github-sandbox YOUR-ACCOUNT/gitguardex-benchmark > live-results.json
```

This **pushes fixture branches, opens PRs and attempts merges**. It never writes
the default branch; each arm uses fresh `gx-benchmark/<uuid>/` refs and pins
the PR head commit when merging. PR links and failed attempts appear in the
raw results. If a failed PR contributes commits to a later PR, the later
attempt is marked `dependency-not-merged` instead of landing the failed edit.
The sandbox must not contain real work, secrets or active
automation. PRs and fixture branches remain on GitHub as evidence; delete the
disposable repository when no longer needed. Don't publish private repo links
unless you intend to share them.
