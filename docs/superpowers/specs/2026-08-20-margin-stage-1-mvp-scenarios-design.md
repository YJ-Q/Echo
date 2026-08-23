# Margin Stage 1 MVP Scenarios and Packaging Design

Status: approved design, frozen before Stage 2 implementation. Date: 2026-08-20.

## Product question

Stage 1 freezes one question:

> After a sustained task is interrupted, can a user start a new Session, repeat less background, recover the latest valid state, and complete the specified next-step artifact safely?

Accurate restatement alone is not success. A run must produce the task's verifiable next-step artifact or authorized state transition.

## Scope

The MVP contains exactly two sustained-task scenarios:

1. Learning and research.
2. Career materials and project advancement.

Ordinary chat may remain in the Session history but does not become structured project state or long-term memory without a qualifying project relationship and the applicable write gate. Proactive suggestions and general-purpose automation are outside Stage 1.

## Scenario A: learning and research

The user returns in a new Session after interrupting a research task. The system must recover:

- the active research question and project;
- the latest confirmed scope;
- confirmed findings and their sources;
- unresolved questions and blockers;
- the current next step.

The frozen task supplies one verifiable continuation artifact, such as completing a comparison row, producing a source-grounded interim conclusion, or updating the research state after an authorized lookup. A generic recap or plan does not satisfy the task.

## Scenario B: career materials and project advancement

The user returns in a new Session after interrupting a job-search or project-delivery task. The system must recover:

- the target role, deliverable, or project goal;
- the latest material or decision version;
- confirmed constraints and decisions;
- the current blocker;
- the current next step.

The frozen task supplies one verifiable continuation artifact, such as revising a specified resume bullet, updating a project decision record, or completing an authorized project-state transition. A generic recap or list of suggestions does not satisfy the task.

## Success contract

A task succeeds only when every required condition passes:

1. The correct project and goal are selected.
2. The latest valid phase, blocker, and confirmed decisions are recovered without contradiction.
3. Already-confirmed background is not requested again unless the frozen task marks it ambiguous or unavailable.
4. Recalled state and memory expose traceable source identifiers.
5. The task-specific continuation artifact or authorized state transition is completed.
6. No tool outside the task's permission fixture is called.
7. When no relevant state or memory exists, the result is explicitly empty and does not claim recollection.

Each frozen task declares its required facts, forbidden facts, expected artifact, allowed tools, and whether clarification is permitted. This makes the contract machine-scoreable without treating test counts as user value.

## Frozen failure taxonomy

- `missing_required_context`: required current information was omitted.
- `incorrect_recovery`: a recovered fact is unsupported or wrong.
- `stale_state_override`: an older value displaced a newer valid value.
- `cross_project_contamination`: another project's information entered the result.
- `unnecessary_background_request`: the user was asked to repeat confirmed available context.
- `unsupported_memory_claim`: the system claimed memory without a traceable source.
- `unauthorized_tool_attempt`: a tool outside the permission fixture was attempted.
- `recap_without_progress`: the state was restated but the required continuation artifact was not completed.
- `intrusive_recall`: otherwise correct information was surfaced when the task did not require it.

The taxonomy is frozen before implementation. New failure classes may be added only with a versioned protocol change; existing task labels are not rewritten to improve scores.

## Packaging and contribution boundary

Margin is not implemented as one Skill. The system uses three boundaries:

### Margin Core

Runtime-agnostic application logic owns structured State/Memory persistence, versions, sources, corrections, deletion history, write and recall gates, conflict handling, permissions, audit events, and evaluation evidence. This is the main Margin contribution and must be testable without Pi.

### Pi Extension Adapter

An internal thin adapter registers `memory_search`, `memory_propose`, `state_update`, and `action_update`, subscribes to the necessary Pi lifecycle events, and supplies the approved context plan. It does not reimplement Pi's agent loop, Session, branching, tool execution, or compaction.

The adapter remains internal during the MVP. It may become a separately distributed plugin only after its interfaces and upgrade behavior are proven stable.

### Skill Policies

Learning/research and career/project policies describe scenario-specific workflow, prompts, completion rules, and tool-use guidance. They do not own authoritative state, credentials, permissions, deletion, conflict resolution, or evaluation scoring.

This separation permits another Agent runtime to use Margin Core later without migrating the underlying project state.

## Data flow boundary

1. Pi owns messages, tool traces, branches, and compaction history for the active Session.
2. The adapter requests only the Margin Core state required by the frozen task.
3. Margin Core applies recall gates and returns source-addressable context or an explicit empty result.
4. The relevant Skill Policy guides continuation within the allowed scenario.
5. State-changing tools submit proposals or authorized transitions to Margin Core.
6. Margin Core records versioned state and audit evidence independently of Pi's conversation history.

Saving does not imply recall, recall does not imply display, and display does not imply permission to act.

## Stage 1 evaluation fixture contract

Stage 1 defines the schema for frozen tasks but does not pre-write evaluation results. Every task fixture must contain:

- immutable task ID and protocol version;
- scenario type and project ID;
- prior Session inputs and interruption point;
- current valid facts with source/version metadata;
- stale, conflicting, irrelevant, and sensitive distractors where applicable;
- new-Session user request;
- required and forbidden recovered facts;
- expected continuation artifact or state transition;
- allowed tools and confirmation requirements;
- deterministic scoring rules and failure labels.

The first implementation plan will produce a small representative seed set and a generator/validator contract. Expansion to at least 50 frozen tasks occurs before comparative evaluation, not by copying one template with cosmetic wording changes.

## Security and privacy

- Credentials remain environment-provided and never enter fixtures or reports.
- File, command, network, and external-write tools are disabled unless a task explicitly allows them.
- Sensitive or durable memory proposals require confirmation according to the later write-gate specification.
- Test fixtures use synthetic identities and content; they are not described as real-user research.
- Local Pi Session traces and model content remain ignored development evidence.

## Stage boundaries

Stage 1 is complete when this design, the implementation plan, the task-fixture schema, and representative frozen fixtures are versioned and validated. It does not require production State/Memory implementation.

Stage 2 may begin only against this frozen contract. Production Pi chat migration, plugin publication, user studies, resume claims, and evaluation results remain outside Stage 1.

## Acceptance criteria

- Both scenarios require a verifiable continuation artifact.
- Success is all-required-conditions, not a vague quality judgment.
- Failure labels, fixture fields, and protocol versioning are explicit.
- Ordinary chat cannot silently become durable project state.
- Margin Core, Pi adapter, and Skill Policy responsibilities do not overlap.
- No claim implies production integration, market validation, or measured user improvement.
