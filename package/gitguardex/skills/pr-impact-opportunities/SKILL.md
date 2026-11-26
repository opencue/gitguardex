---
name: pr-impact-opportunities
description: Find evidence-backed feature follow-ups that could materially improve a benefit or reduce a serious risk. Use with a PR diff or Code Assist impact review, not to rescore the current PR.
---

# PR impact opportunities

Suggest at most two changes that build specifically on the feature in this diff. Judge the likely impact of the revised behavior as a whole, not the number of ideas or lines added. Prioritize a material benefit on an important workflow or a meaningful reduction in an existing risk; a cosmetic change or generic test does not qualify.

For each opportunity, give:

- `idea`: a specific feature-level change and who or what benefits (up to 200 characters).
- `pilot`: the smallest inexpensive first experiment using existing fixtures or a narrow prototype, before changing the full workflow (up to 200 characters).
- `verify`: an observable pass condition, measurement, or comparison against the current behavior (up to 200 characters).
- `evidence`: a real right-side diff line where the current feature supports the idea, as `{ "path": "...", "line": 1 }`.

Do not repeat findings, trade-off fixes, or ordinary improvement ideas. Return an empty list if the visible diff cannot support a credible high-impact idea. Do not give score predictions, invent results, modify either current estimate, or treat the opportunities as merge requirements.
