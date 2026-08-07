## ADDED Requirements

### Requirement: Findings SHALL be validated against the reviewed diff before posting

The system SHALL partition findings into diff-anchored and unanchored sets, post
only anchored findings inline, and report unanchored findings in the review
summary instead of discarding them or failing the post. GitHub rejects an entire
review with 422 when any inline comment anchors outside the diff.

#### Scenario: A finding points at a line outside the diff

- **WHEN** the review provider returns a finding whose line is not present in the PR diff
- **THEN** no inline comment is created for that finding
- **AND** the review summary lists it under a "could not be anchored" section
- **AND** the review post succeeds

#### Scenario: GitHub rejects the inline anchors anyway

- **WHEN** the review POST fails while carrying inline comments
- **THEN** the system SHALL retry once as a summary-only review carrying the findings in the body
- **AND** the summary SHALL record that inline anchoring was rejected

### Requirement: Repeated reviews SHALL NOT stack duplicate inline comments

Each posted finding SHALL carry a stable fingerprint marker. Before posting, the
system SHALL read the PR's existing review comments and skip any finding whose
fingerprint is already present.

#### Scenario: The same review runs twice on an unchanged PR

- **WHEN** a review re-runs and every finding was already reported
- **THEN** zero new inline comments are created
- **AND** the summary reports how many findings were already reported

#### Scenario: Reading existing comments fails

- **WHEN** the GitHub call listing existing comments fails
- **THEN** the review SHALL proceed and post all findings rather than blocking

### Requirement: A finding SHALL be able to address a multi-line range

Findings SHALL accept a `start_line` that is strictly before `line`, forwarded to
GitHub as `start_line` + `start_side` so a suggestion can replace a range.

#### Scenario: start_line is not strictly before line

- **WHEN** a finding declares `start_line` equal to or after `line`
- **THEN** the finding SHALL collapse to a single-line comment, because GitHub rejects such a range

### Requirement: The review summary SHALL state the merge-gate verdict

The summary body SHALL report the finding count, the severity mix, and whether
the findings block the merge gate, so a reader can distinguish advisory findings
from blocking ones.

#### Scenario: Only advisory findings are present

- **WHEN** the review finds medium and low findings and the gate blocks on high/critical
- **THEN** the summary SHALL state that the merge gate passes

#### Scenario: A blocking finding is present

- **WHEN** the review finds a high or critical finding
- **THEN** the summary SHALL state that the merge gate is blocked and how many findings block it

### Requirement: Inline comments SHALL lead with the defect

An inline comment SHALL render a severity alert callout with the severity and
category, followed by a lede. Message text beyond the lede limit SHALL be folded
into a collapsed details block.

#### Scenario: A long finding message is posted

- **WHEN** a finding message exceeds the lede limit
- **THEN** the inline comment SHALL show the lede first
- **AND** the remainder SHALL be inside a collapsed details block

### Requirement: A truncated review SHALL declare itself partial

The diff sent to the provider SHALL be capped. When the cap applies, the review
output SHALL state that the review is partial.

#### Scenario: The PR diff exceeds the cap

- **WHEN** the diff is longer than the cap
- **THEN** the summary and the CLI output SHALL both note that the diff was truncated

### Requirement: The review provider SHALL be asked for applicable suggestions

The review prompt SHALL require a `suggestion` for any finding whose fix is a
bounded edit to the commented line range, so GitHub renders a committable
suggestion rather than prose only.

#### Scenario: The provider wraps a suggestion in a code fence

- **WHEN** a returned `suggestion` is wrapped in a code fence
- **THEN** the fence SHALL be stripped before the suggestion is embedded in the comment

#### Scenario: The provider returns JSON containing a fenced suggestion

- **WHEN** provider output is valid JSON whose `suggestion` value contains a code fence
- **THEN** the payload SHALL parse as findings, not as the fence contents

### Requirement: `gx pr-review --fix` SHALL apply findings as a commit

With `--fix`, the system SHALL invoke the provider in edit mode and commit the
resulting edits as a single commit on the current branch.

#### Scenario: The branch is protected

- **WHEN** `--fix` runs on a protected branch
- **THEN** the provider SHALL NOT run
- **AND** the command SHALL report that it refused

#### Scenario: The working tree has uncommitted tracked edits

- **WHEN** `--fix` runs with uncommitted tracked changes present
- **THEN** the provider SHALL NOT run, so unrelated work is never bundled into the fix commit

#### Scenario: Untracked files already exist in the tree

- **WHEN** `--fix` runs with pre-existing untracked files present
- **THEN** the fix SHALL proceed
- **AND** only paths the fix touched SHALL be staged

#### Scenario: The provider makes no edits

- **WHEN** the provider runs and changes nothing
- **THEN** the result SHALL report a no-op and no commit SHALL be created

### Requirement: `--gate-autofix` SHALL let the merge gate repair blocking findings

With `--gate-autofix`, the merge gate SHALL run up to a bounded number of repair
rounds on blocking findings: fix in the branch's worktree, push, then re-review
with a fresh provider run before re-evaluating.

#### Scenario: Auto-fix is not requested

- **WHEN** the gate finds blocking findings without `--gate-autofix`
- **THEN** no fix SHALL run
- **AND** the gate SHALL block and mention `--gate-autofix` as an option

#### Scenario: Auto-fix clears the findings

- **WHEN** a repair round changes files and the re-review returns no blocking findings
- **THEN** the gate SHALL proceed to the merge
- **AND** the re-review SHALL be a separate provider invocation from the fix

#### Scenario: Auto-fix exhausts its round budget

- **WHEN** every budgeted round runs and blocking findings remain
- **THEN** the gate SHALL block and report that auto-fix did not clear them

#### Scenario: A repair round changes nothing

- **WHEN** a repair round makes no edits
- **THEN** the loop SHALL stop immediately rather than retrying
- **AND** the gate SHALL block

#### Scenario: The resolved worktree holds a different branch

- **WHEN** the checkout used for the fix is not on the gated branch
- **THEN** the fix SHALL be skipped rather than edit the wrong branch
