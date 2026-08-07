## Why

Observed in production on `Webu-PRO/lifted.sk-storefront#440`:

- round 1 blocked on a HIGH in `src/pages/store.tsx`;
- round 2 blocked on a different HIGH in `src/components/product-card-compact.tsx`
  ("the compact card drops the set-total price line, so a SET product shows a
  per-kg figure with no total");
- the fix commit touched only the text-search bug in `store.tsx`;
- round 3 simply did not report the price bug, and the gate printed
  **"Merge gate: pass"**.

The defect was still in the branch — verified at head `7221fbf`:
`product-card-compact.tsx:182-192` renders the primary line plus a compare-at
line, with no set-total, while `store.tsx:2019-2035` renders exactly that second
line. Review providers are nondeterministic, so a real HIGH can fail to reappear
and the gate reads the silence as a repair.

## What Changes

- `src/finish/review-gate.js` tracks two sets across rounds: files that ever held
  a blocking finding, and files a repair round actually edited.
- New `resolveCarriedFindings(blockedPaths, repairedPaths, currentFindings)`
  returns files whose disappearance is unexplained — never edited, and no longer
  mentioned by the latest review at any severity.
- A clean final verdict with unexplained files now throws instead of merging.
- `templates/AGENTS.multiagent-safety.md` and `.min.md` name the gated ship
  (`--gate-review --gate-autofix`) as the default completion path, explain each
  gate flag, and state that posting a review is not merging.

File-level rather than finding-level granularity is deliberate: line numbers
shift after a repair and provider wording/severity varies run to run
(`product-card-compact.tsx:93` arrived as LOW, then MEDIUM, then MEDIUM in the
same PR), so a message or line fingerprint would not survive a round. A file path
does, and being coarse errs toward blocking.

## Impact

- Only active with `--gate-autofix`; without it there is one review round and the
  check cannot fire. Default behavior is unchanged.
- Strictly stricter: it can turn a merge into a block, never a block into a merge.
- Cost: a repair that fixes file A's finding by editing file B is now reported as
  unexplained. That is the intended trade — the gate demands the edit be visible
  where the finding was.
