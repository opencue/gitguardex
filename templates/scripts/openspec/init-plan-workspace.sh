#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <plan-slug> [agent-role ...]"
  echo "Example: $0 add-ralplan-openspec-plan-export planner architect critic executor writer verifier"
  exit 1
fi

PLAN_SLUG="$1"
shift || true

if [[ "$PLAN_SLUG" =~ [^a-z0-9-] ]]; then
  echo "Error: plan slug must be kebab-case (lowercase letters, numbers, hyphens)."
  exit 1
fi

to_kebab() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

if [[ $# -gt 0 ]]; then
  ROLES=("$@")
else
  ROLES=(planner architect critic executor writer verifier)
fi

PLAN_DIR="openspec/plan/${PLAN_SLUG}"
mkdir -p "$PLAN_DIR"

if [[ ! -f "$PLAN_DIR/summary.md" ]]; then
  cat > "$PLAN_DIR/summary.md" <<SUMEOF
# Plan Summary: ${PLAN_SLUG}

- **Mode:** ralplan
- **Status:** draft

## Context

Describe the planning context, constraints, and desired outcomes.
SUMEOF
fi

if [[ ! -f "$PLAN_DIR/checkpoints.md" ]]; then
  cat > "$PLAN_DIR/checkpoints.md" <<CPTEOF
# Plan Checkpoints: ${PLAN_SLUG}

Chronological checkpoint log for all roles.

CPTEOF
fi

if [[ ! -f "$PLAN_DIR/open-questions.md" ]]; then
  cat > "$PLAN_DIR/open-questions.md" <<OPENQUESTIONSEOF
# Open Questions: ${PLAN_SLUG}

Capture unresolved plan questions here as unchecked checklist items.
Keep each item concrete, decision-shaped, and easy to close with evidence.

- [ ] Add the next unresolved question here.
OPENQUESTIONSEOF
fi

if [[ ! -f "$PLAN_DIR/README.md" ]]; then
  {
    echo "# Plan Workspace: ${PLAN_SLUG}"
    echo
    echo "This folder stores durable planning artifacts before implementation changes."
    echo
    echo "## Shared files"
    echo "- \`summary.md\`"
    echo "- \`checkpoints.md\`"
    echo "- \`phases.md\`"
    echo "- \`open-questions.md\`"
    echo "- \`coordinator-prompt.md\`"
    echo "- \`kickoff-prompts.md\`"
    echo
    echo "## Role folders"
    for role in "${ROLES[@]}"; do
      echo "- \`${role}/\`"
    done
    echo
    echo "When Codex or Claude hits an unresolved question that should survive chat, add it to \`open-questions.md\` as an unchecked \`- [ ]\` item."
    echo
    echo "Each role folder contains OpenSpec-style artifacts:"
    echo "- \`.openspec.yaml\`"
    echo "- \`prompt.md\` (copy/paste role prompt)"
    echo "- \`proposal.md\`"
    echo "- \`tasks.md\` (Spec / Tests / Implementation / Checkpoints checklists)"
    echo "- \`specs/<role>/spec.md\`"
    echo "Planner also gets \`plan.md\`; executor also gets \`checkpoints.md\`."
    echo "Planner plans should follow \`openspec/plan/PLANS.md\`."
  } > "$PLAN_DIR/README.md"
fi

if [[ ! -f "$PLAN_DIR/coordinator-prompt.md" ]]; then
  cat > "$PLAN_DIR/coordinator-prompt.md" <<COORDPROMPTEOF
# Master Coordinator Prompt

You are the coordinator for plan \`${PLAN_SLUG}\`.

## Objective

Drive this plan from draft to execution-ready status with strict checkpoint discipline and no scope drift.

## Source-of-truth artifacts

- \`openspec/plan/${PLAN_SLUG}/summary.md\`
- \`openspec/plan/${PLAN_SLUG}/checkpoints.md\`
- \`openspec/plan/${PLAN_SLUG}/open-questions.md\`
- \`openspec/plan/${PLAN_SLUG}/planner/plan.md\`
- role \`prompt.md\` files for copy/paste helper startup
- role \`tasks.md\` files for planner/architect/critic/executor/writer/verifier

## Coordinator responsibilities

1. Keep checkpoints current in each role \`tasks.md\` and root \`checkpoints.md\`.
2. Route unresolved questions and branching decisions into \`open-questions.md\`.
3. Ensure each role has explicit acceptance criteria and verification evidence.
4. Prevent implementation from starting before planning gates are complete.
5. Keep handoffs concise: files changed, behavior touched, verification output, risks.

## Wave-splitting decision (optional)

Create wave prompts in \`kickoff-prompts.md\` only when at least one applies:

- 3+ independent implementation lanes can run in parallel.
- Runtime cutover/rollback sequencing needs explicit lane ownership.
- Risk is high enough that bounded execution packets reduce coordination mistakes.

If wave splitting is not needed, keep execution under a single owner with normal role checkpoints.

## Exit criteria

- All role checkpoints required for planning are done.
- Execution lanes (if any) have clear ownership boundaries.
- \`open-questions.md\` captures unresolved decisions that still need answers.
- Verification plan and rollback expectations are explicit and testable.
COORDPROMPTEOF
fi

if [[ ! -f "$PLAN_DIR/kickoff-prompts.md" ]]; then
  cat > "$PLAN_DIR/kickoff-prompts.md" <<KICKOFFPROMPTEOF
# Kickoff Prompts (Copy/Paste)

Use these only when the coordinator decides wave-splitting is needed.

## Prompt A — Wave A (Primary lane)

\`\`\`text
You own Wave-A for plan \`${PLAN_SLUG}\` in /home/deadpool/Documents/codex-lb.

Goal:
Implement the assigned Wave-A scope and return verification evidence.

Hard constraints:
- You are not alone in the codebase; do not revert others' work.
- Stay in your owned files/modules only.
- Record explicit handoff notes for integration.

Owned scope:
- <fill owned files/modules>

Verification:
- <fill commands>

Handoff format:
- Files changed
- Behavior touched
- Verification outputs
- Risks/follow-ups
\`\`\`

## Prompt B — Wave B (Secondary lane)

\`\`\`text
You own Wave-B for plan \`${PLAN_SLUG}\` in /home/deadpool/Documents/codex-lb.

Goal:
Implement the assigned Wave-B scope and return verification evidence.

Hard constraints:
- You are not alone in the codebase; do not revert others' work.
- Stay in your owned files/modules only.
- Record explicit handoff notes for integration.

Owned scope:
- <fill owned files/modules>

Verification:
- <fill commands>

Handoff format:
- Files changed
- Behavior touched
- Verification outputs
- Risks/follow-ups
\`\`\`

## Prompt C — Wave C (Secondary lane)

\`\`\`text
You own Wave-C for plan \`${PLAN_SLUG}\` in /home/deadpool/Documents/codex-lb.

Goal:
Implement the assigned Wave-C scope and return verification evidence.

Hard constraints:
- You are not alone in the codebase; do not revert others' work.
- Stay in your owned files/modules only.
- Record explicit handoff notes for integration.

Owned scope:
- <fill owned files/modules>

Verification:
- <fill commands>

Handoff format:
- Files changed
- Behavior touched
- Verification outputs
- Risks/follow-ups
\`\`\`

## Prompt D — Integrator lane

\`\`\`text
You are the integrator for plan \`${PLAN_SLUG}\` in /home/deadpool/Documents/codex-lb.

Goal:
Integrate completed waves, resolve conflicts, run final verification, and prepare rollout/cutover notes.

Hard constraints:
- You are not alone in the codebase; do not revert others' work.
- Preserve safety-critical behavior unless explicitly planned and tested.
- Keep final output evidence-first.

Owned scope:
- integration glue and shared touchpoints
- final validation + handoff summary

Verification:
- <fill commands>

Final report:
- Files changed
- Integration decisions
- Verification outputs
- Remaining risks
\`\`\`
KICKOFFPROMPTEOF
fi

if [[ ! -f "$PLAN_DIR/phases.md" ]]; then
  cat > "$PLAN_DIR/phases.md" <<PHASESEOF
# Plan Phases: ${PLAN_SLUG}

One entry per phase. Checkbox marks map to: \`x\` = completed, \`>\` = in progress, space = pending.
Indented sub-bullets are optional metadata consumed by the Plans UI:

- \`session\`: which agent kind runs the phase (\`codex\` / \`claude\`).
- \`checkpoints\`: comma-separated role checkpoint ids delivered within the phase.
- \`summary\`: one short sentence rendered under the phase title.

One phase is intended to fit into a single Codex or Claude session task.

- [ ] [PH01] First milestone title goes here
  - session: codex
  - checkpoints: P1, A1
  - summary: Describe the single session outcome expected for this phase.
PHASESEOF
fi

for role in "${ROLES[@]}"; do
  ROLE_DIR="$PLAN_DIR/$role"
  mkdir -p "$ROLE_DIR"

  if [[ ! -f "$ROLE_DIR/README.md" ]]; then
    cat > "$ROLE_DIR/README.md" <<ROLEEOF
# ${role}

Role workspace for \`${role}\`.

Default artifacts:
- \`.openspec.yaml\`
- \`prompt.md\`
- \`proposal.md\`
- \`tasks.md\`
- \`specs/<role>/spec.md\`

Use this folder for role notes, artifacts, and status updates.
ROLEEOF
  fi

  ROLE_SPEC_SLUG="$(to_kebab "$role")"
  if [[ -z "$ROLE_SPEC_SLUG" ]]; then
    ROLE_SPEC_SLUG="role"
  fi

  if [[ ! -f "$ROLE_DIR/.openspec.yaml" ]]; then
    cat > "$ROLE_DIR/.openspec.yaml" <<ROLEYAMLEOF
schema: 1
plan: ${PLAN_SLUG}
role: ${role}
status: draft
artifacts:
  prompt: prompt.md
  proposal: proposal.md
  tasks: tasks.md
  spec: specs/${ROLE_SPEC_SLUG}/spec.md
ROLEYAMLEOF
  fi

  if [[ ! -f "$ROLE_DIR/prompt.md" ]]; then
    cat > "$ROLE_DIR/prompt.md" <<ROLEPROMPTEOF
# ${role} Prompt

You are the \`${role}\` role for OpenSpec plan \`${PLAN_SLUG}\`.

## Objective

Complete only this role's assigned checklist and leave compact evidence for the coordinator.

## Source of truth

- \`openspec/plan/${PLAN_SLUG}/summary.md\`
- \`openspec/plan/${PLAN_SLUG}/checkpoints.md\`
- \`openspec/plan/${PLAN_SLUG}/open-questions.md\`
- \`openspec/plan/${PLAN_SLUG}/${role}/tasks.md\`
- \`openspec/plan/${PLAN_SLUG}/${role}/proposal.md\`

## Before edits

1. Confirm branch/worktree with \`git status --short --branch\`.
2. Claim every touched file before editing:
   - Prefer Colony \`task_claim_file\` when an active task exists.
   - Otherwise run \`gx locks claim --branch <agent-branch> <file...>\`.
3. Stay inside assigned files/modules; coordinate before touching shared paths.

## Working rules

- Update \`${role}/tasks.md\` as each item completes.
- Record durable unresolved questions in \`open-questions.md\`.
- Keep handoffs short: files changed, behavior touched, verification, risks.
- Do not revert another agent's edits.

## Cleanup

Only the owner/finalizer lane runs \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`. If blocked, append \`BLOCKED:\` with branch, task, blocker, next, evidence.
ROLEPROMPTEOF
  fi

  if [[ ! -f "$ROLE_DIR/proposal.md" ]]; then
    cat > "$ROLE_DIR/proposal.md" <<ROLEPROPOSALEOF
# Proposal: ${role} (${PLAN_SLUG})

## Why

Summarize why this role's work is required for plan \`${PLAN_SLUG}\`.

## What Changes

- [ ] List the planned role-specific changes

## Impact

- Scope:
- Risks:
- Dependencies:
ROLEPROPOSALEOF
  fi

  ROLE_SPEC_DIR="$ROLE_DIR/specs/$ROLE_SPEC_SLUG"
  mkdir -p "$ROLE_SPEC_DIR"

  if [[ ! -f "$ROLE_SPEC_DIR/spec.md" ]]; then
    cat > "$ROLE_SPEC_DIR/spec.md" <<ROLESPECEOF
# Capability Spec: ${role}

## ADDED Requirements

### Requirement: ${role} responsibilities for \`${PLAN_SLUG}\`
This role MUST define and deliver its scoped outputs with evidence.

#### Scenario: Role executes assigned scope
- **WHEN** the role begins execution for \`${PLAN_SLUG}\`
- **THEN** it follows \`tasks.md\` and records evidence for completion
ROLESPECEOF
  fi

  if [[ "$role" == "planner" && ! -f "$ROLE_DIR/plan.md" ]]; then
    cat > "$ROLE_DIR/plan.md" <<PLANEOF
# ExecPlan: ${PLAN_SLUG}

This ExecPlan is a living document. Keep \`Progress\`, \`Surprises & Discoveries\`, \`Decision Log\`, and \`Outcomes & Retrospective\` current as work proceeds.

Follow repository guidance in \`openspec/plan/PLANS.md\`.

## Purpose / Big Picture

Describe what becomes possible after this plan is executed and how a user/operator can observe it working.

## Progress

- [ ] (YYYY-MM-DD HH:MMZ) Capture initial scope and acceptance criteria.
- [ ] (YYYY-MM-DD HH:MMZ) Draft architecture/tradeoff plan and verification strategy.
- [ ] (YYYY-MM-DD HH:MMZ) Finalize execution-ready handoff.

## Surprises & Discoveries

- Observation: _none yet_
  Evidence: _n/a_

## Decision Log

- Decision: Use OpenSpec plan workspace as source of truth for this planning cycle.
  Rationale: Keeps planning artifacts in-repo and reviewable.
  Date/Author: YYYY-MM-DD / planner

## Outcomes & Retrospective

Summarize outcomes, gaps, and lessons learned when a milestone or the full plan is completed.

## Context and Orientation

Describe relevant modules, files, constraints, and assumptions for a newcomer. Use repository-relative paths.

## Plan of Work

Describe the sequence of edits and deliverables in prose. Name target files and expected effects.

## Concrete Steps

List exact commands with working directory and short expected outcomes.

    cd /home/deadpool/Documents/codex-lb
    openspec validate --specs

## Validation and Acceptance

State observable behavior and verification evidence required before execution handoff.

## Idempotence and Recovery

Document safe re-run behavior, rollback strategy, and failure recovery notes.

## Artifacts and Notes

Capture concise command output snippets, evidence pointers, and references.

## Interfaces and Dependencies

Name concrete interfaces/modules/dependencies and any required signatures/contracts.

## Revision Note

- YYYY-MM-DD HH:MMZ: Initial scaffold generated by \`scripts/openspec/init-plan-workspace.sh\`.
PLANEOF
  fi

  if [[ "$role" == "executor" && ! -f "$ROLE_DIR/checkpoints.md" ]]; then
    cat > "$ROLE_DIR/checkpoints.md" <<EXCCPTEOF
# executor checkpoints

Timestamped execution checkpoints for \`${PLAN_SLUG}\`.

EXCCPTEOF
  fi

  if [[ ! -f "$ROLE_DIR/tasks.md" ]]; then
    case "$role" in
      planner)
        cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# planner tasks

## 1. Spec

- [ ] 1.1 Define planning principles, decision drivers, and viable options for \`${PLAN_SLUG}\`
- [ ] 1.2 Validate that scope, constraints, and acceptance criteria are captured in \`summary.md\`

## 2. Tests

- [ ] 2.1 Define verification approach for plan quality (traceability, testability, evidence expectations)
- [ ] 2.2 Validate OpenSpec consistency checkpoints (including \`openspec validate --specs\` when applicable)

## 3. Implementation

- [ ] 3.1 Produce the initial RALPLAN-DR plan draft
- [ ] 3.2 Integrate Architect/Critic feedback into revised plan iterations
- [ ] 3.3 Publish final planning handoff with explicit execution lanes

## 4. Checkpoints

- [ ] [P1] READY - Initial planning draft checkpoint

## 5. Collaboration

- [ ] 5.1 Owner recorded this lane before edits.
- [ ] 5.2 Record joined agents / handoffs, or mark \`N/A\` when solo.
- [ ] 5.3 Record unresolved plan questions in \`../open-questions.md\`, or mark \`N/A\` when none.

## 6. Cleanup

- [ ] 6.1 If this lane owns finalization, run \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`.
- [ ] 6.2 Record PR URL + final \`MERGED\` state in the handoff.
- [ ] 6.3 Confirm sandbox cleanup (\`git worktree list\`, \`git branch -a\`) or append \`BLOCKED:\` and stop.
TASKEOF
        ;;
      architect)
        cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# architect tasks

## 1. Spec

- [ ] 1.1 Define ownership boundaries, interfaces, and artifact responsibilities for \`${PLAN_SLUG}\`
- [ ] 1.2 Validate architecture constraints and non-functional requirements coverage

## 2. Tests

- [ ] 2.1 Define architectural verification checkpoints (integration boundaries, failure modes, compatibility)
- [ ] 2.2 Validate that acceptance criteria map to concrete architecture decisions

## 3. Implementation

- [ ] 3.1 Review plan for strongest antithesis/tradeoff tensions
- [ ] 3.2 Propose synthesis path and guardrails for implementation teams
- [ ] 3.3 Record architecture sign-off notes for downstream execution

## 4. Checkpoints

- [ ] [A1] READY - Architecture review checkpoint

## 5. Collaboration

- [ ] 5.1 Owner recorded this lane before edits.
- [ ] 5.2 Record joined agents / handoffs, or mark \`N/A\` when solo.
- [ ] 5.3 Record unresolved plan questions in \`../open-questions.md\`, or mark \`N/A\` when none.

## 6. Cleanup

- [ ] 6.1 If this lane owns finalization, run \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`.
- [ ] 6.2 Record PR URL + final \`MERGED\` state in the handoff.
- [ ] 6.3 Confirm sandbox cleanup (\`git worktree list\`, \`git branch -a\`) or append \`BLOCKED:\` and stop.
TASKEOF
        ;;
      critic)
        cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# critic tasks

## 1. Spec

- [ ] 1.1 Validate principle-driver-option consistency across the plan
- [ ] 1.2 Validate risks, consequences, and mitigation clarity (including idempotency expectations)

## 2. Tests

- [ ] 2.1 Validate testability and measurability of all acceptance criteria
- [ ] 2.2 Validate verification steps are concrete and reproducible

## 3. Implementation

- [ ] 3.1 Produce verdict (APPROVE / ITERATE / REJECT) with actionable feedback
- [ ] 3.2 Confirm revised drafts resolve prior findings before approval
- [ ] 3.3 Publish final quality/risk sign-off notes

## 4. Checkpoints

- [ ] [C1] READY - Quality gate checkpoint

## 5. Collaboration

- [ ] 5.1 Owner recorded this lane before edits.
- [ ] 5.2 Record joined agents / handoffs, or mark \`N/A\` when solo.
- [ ] 5.3 Record unresolved plan questions in \`../open-questions.md\`, or mark \`N/A\` when none.

## 6. Cleanup

- [ ] 6.1 If this lane owns finalization, run \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`.
- [ ] 6.2 Record PR URL + final \`MERGED\` state in the handoff.
- [ ] 6.3 Confirm sandbox cleanup (\`git worktree list\`, \`git branch -a\`) or append \`BLOCKED:\` and stop.
TASKEOF
        ;;
      executor)
        cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# executor tasks

## 1. Spec

- [ ] 1.1 Map approved plan requirements to concrete implementation work items
- [ ] 1.2 Validate touched components/files are explicitly listed before coding starts

## 2. Tests

- [ ] 2.1 Define test additions/updates required to lock intended behavior
- [ ] 2.2 Validate regression and smoke verification commands for delivery

## 3. Implementation

- [ ] 3.1 Execute implementation tasks in approved order
- [ ] 3.2 Keep progress and evidence linked back to plan checkpoints
- [ ] 3.3 Complete final verification bundle for handoff

## 4. Checkpoints

- [ ] [E1] READY - Execution start checkpoint

## 5. Collaboration

- [ ] 5.1 Owner recorded this lane before edits.
- [ ] 5.2 Record joined agents / handoffs, or mark \`N/A\` when solo.
- [ ] 5.3 Record unresolved plan questions in \`../open-questions.md\`, or mark \`N/A\` when none.

## 6. Cleanup

- [ ] 6.1 If this lane owns finalization, run \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`.
- [ ] 6.2 Record PR URL + final \`MERGED\` state in the handoff.
- [ ] 6.3 Confirm sandbox cleanup (\`git worktree list\`, \`git branch -a\`) or append \`BLOCKED:\` and stop.
TASKEOF
        ;;
      writer)
        cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# writer tasks

## 1. Spec

- [ ] 1.1 Validate documentation scope and audience for \`${PLAN_SLUG}\`
- [ ] 1.2 Validate consistency between plan terminology and OpenSpec artifacts

## 2. Tests

- [ ] 2.1 Define documentation verification checklist (accuracy, completeness, command correctness)
- [ ] 2.2 Validate command/help text examples against current workflow behavior

## 3. Implementation

- [ ] 3.1 Update workflow docs and command guidance for approved plan behavior
- [ ] 3.2 Add or refine examples for operator usage and handoff clarity
- [ ] 3.3 Publish final docs change summary with references

## 4. Checkpoints

- [ ] [W1] READY - Docs update checkpoint

## 5. Collaboration

- [ ] 5.1 Owner recorded this lane before edits.
- [ ] 5.2 Record joined agents / handoffs, or mark \`N/A\` when solo.
- [ ] 5.3 Record unresolved plan questions in \`../open-questions.md\`, or mark \`N/A\` when none.

## 6. Cleanup

- [ ] 6.1 If this lane owns finalization, run \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`.
- [ ] 6.2 Record PR URL + final \`MERGED\` state in the handoff.
- [ ] 6.3 Confirm sandbox cleanup (\`git worktree list\`, \`git branch -a\`) or append \`BLOCKED:\` and stop.
TASKEOF
        ;;
      verifier)
        cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# verifier tasks

## 1. Spec

- [ ] 1.1 Define end-to-end validation matrix for \`${PLAN_SLUG}\`
- [ ] 1.2 Validate success/failure conditions and evidence requirements

## 2. Tests

- [ ] 2.1 Execute verification commands and collect outputs
- [ ] 2.2 Validate idempotency/re-run behavior and error-path handling

## 3. Implementation

- [ ] 3.1 Verify completed work against acceptance criteria
- [ ] 3.2 Produce pass/fail findings with concrete evidence links
- [ ] 3.3 Publish final verification sign-off (or blocker report)

## 4. Checkpoints

- [ ] [V1] READY - Verification checkpoint

## 5. Collaboration

- [ ] 5.1 Owner recorded this lane before edits.
- [ ] 5.2 Record joined agents / handoffs, or mark \`N/A\` when solo.
- [ ] 5.3 Record unresolved plan questions in \`../open-questions.md\`, or mark \`N/A\` when none.

## 6. Cleanup

- [ ] 6.1 If this lane owns finalization, run \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`.
- [ ] 6.2 Record PR URL + final \`MERGED\` state in the handoff.
- [ ] 6.3 Confirm sandbox cleanup (\`git worktree list\`, \`git branch -a\`) or append \`BLOCKED:\` and stop.
TASKEOF
        ;;
      *)
        cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# ${role} tasks

## 1. Spec

- [ ] 1.1 Define ${role}-specific requirements and acceptance criteria
- [ ] 1.2 Validate relevant OpenSpec/spec artifacts

## 2. Tests

- [ ] 2.1 Define verification scope for ${role}
- [ ] 2.2 Confirm regression coverage expectations

## 3. Implementation

- [ ] 3.1 Execute ${role} deliverables for this plan
- [ ] 3.2 Record handoff/status notes for downstream roles
- [ ] 3.3 Mark completion with evidence links

## 4. Checkpoints

- [ ] [${role^^}1] READY - Role checkpoint

## 5. Collaboration

- [ ] 5.1 Owner recorded this lane before edits.
- [ ] 5.2 Record joined agents / handoffs, or mark \`N/A\` when solo.
- [ ] 5.3 Record unresolved plan questions in \`../open-questions.md\`, or mark \`N/A\` when none.

## 6. Cleanup

- [ ] 6.1 If this lane owns finalization, run \`gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup\`.
- [ ] 6.2 Record PR URL + final \`MERGED\` state in the handoff.
- [ ] 6.3 Confirm sandbox cleanup (\`git worktree list\`, \`git branch -a\`) or append \`BLOCKED:\` and stop.
TASKEOF
        ;;
    esac
  fi
done

echo "Plan workspace ready: $PLAN_DIR"
