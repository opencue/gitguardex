## ADDED Requirements

### Requirement: The merge gate requires a posted review
A review that did not reach the pull request SHALL NOT satisfy the gate. The
gate exists to put a verdict on the record, and an in-memory verdict cannot be
audited or distinguished from a provider that returned nothing.

#### Scenario: An unposted review blocks the merge
- **WHEN** the review runner reports that it did not post
- **THEN** the gate throws before promoting the PR out of draft
- **AND** the PR is neither marked ready nor merged.

#### Scenario: Zero findings do not excuse an unposted review
- **WHEN** the review reports no findings and was not posted
- **THEN** the gate still blocks.

#### Scenario: The operator is told why and where to look
- **WHEN** the gate blocks on an unposted review
- **THEN** the error names the reported cause
- **AND** includes the local artifact path when the runner wrote one.
