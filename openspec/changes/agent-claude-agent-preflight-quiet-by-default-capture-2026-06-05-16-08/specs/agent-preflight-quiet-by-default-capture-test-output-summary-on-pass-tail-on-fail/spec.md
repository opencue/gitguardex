## ADDED Requirements

### Requirement: Preflight output is quiet by default
The preflight `run_step` SHALL suppress a passing step's output, emitting only a
one-line summary, and SHALL surface output only when a step fails.

#### Scenario: Passing step is summarized
- **WHEN** a preflight step passes
- **THEN** its full output is not printed; a one-line `ok (N lines suppressed)` summary is, reporting how many lines were hidden.

#### Scenario: Failing step stays diagnosable
- **WHEN** a preflight step fails
- **THEN** the tail of its output (default 40 lines) is printed to stderr and the preflight exits non-zero (refusing the push).

#### Scenario: Verbose opt-in
- **WHEN** `GUARDEX_PREFLIGHT_VERBOSE=1` is set
- **THEN** every step streams its full output live.

#### Scenario: A single failing step is not masked
- **WHEN** the only recognized check fails
- **THEN** the preflight exits non-zero (not the "no stack detected" exit-0 path).
