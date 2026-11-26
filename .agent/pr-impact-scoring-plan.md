# Independent PR impact and risk

Replace additive net scoring with two diff-only estimates. Ask the existing
review provider for an integer magnitude and a rationale for each distinct
benefit or risk, and a qualitative likelihood for risks. No second provider call.
Validate anchors and values before rendering. Each scale shows its strongest
supported effect; neither axis cancels the other. Unsupported axes stay
unrated. Keep the chart, priority fix, opportunities, and follow-up history
advisory and separate from the merge gate.

First lock down non-bucket scores, conflicting high estimates, missing evidence,
and invalid model fields in unit tests. Then migrate the report and fixtures
and verify posted reviews, local artifacts, history, incomplete diffs, and
Drizzle projection evidence with the existing focused suites.
