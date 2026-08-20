# Margin + Pi Personal Work Continuity Agent Design

**Date:** 2026-08-20
**Status:** Proposed for implementation
**Scope:** Pi integration, structured continuity state, four Margin tools, cross-session evaluation, and auditable evidence

## 1. Product Goal

Margin will become a personal work-continuity agent built on Pi's agent runtime.

The first product question is deliberately narrow:

> After a user interrupts a sustained task, can a new session restore the correct state with less repeated background and help the user complete the next step?

The first release supports two task families:

1. learning and research;
2. job-search materials and project advancement.

Ordinary chat may remain in Pi's session history, but it must not automatically become durable Margin state or memory.

## 2. Verified Starting Point

### 2.1 Current Margin repository

- The repository is a JavaScript ESM application with Express, Electron, and SQLite.
- `src/services/chatService.js` currently owns input analysis, response generation, state updates, memory persistence, and profile synthesis.
- `src/storage/memoryStore.js` currently combines schema migration, conversation storage, memory retrieval, profile storage, actions, learning sessions, and operation audit records.
- `conversations` currently mixes dialogue history with durable-memory metadata.
- Existing operation proposals support confirmation and reversible operations, but destructive memory deletion is intentionally rejected.
- The current test baseline is 186 passing tests.
- No tracked Pi dependency, import, integration adapter, or Pi-specific test exists.

### 2.2 Pi dependency baseline

The integration baseline is fixed to:

- repository: `https://github.com/earendil-works/pi`;
- release tag: `v0.84.2`;
- package: `@earendil-works/pi-coding-agent@0.84.2`;
- license: MIT;
- required Node version: `>=22.19.0`;
- initial Margin runtime target: Node `22.23.1`.

The release package provides `createAgentSession`, `createAgentSessionRuntime`, `AgentSessionRuntime`, session persistence, branching, compaction, event streaming, extension tools, and tool-call interception.

The dependency is pinned to the exact release during the MVP. Upstream `main` is not used as an installation target.

### 2.3 Runtime prerequisite

The current shell runtime is Node `20.19.6`, which cannot load the selected Pi package. Margin's launchers already expect `.runtime/node-v22.23.1-win-x64`, but that runtime is not present in the working copy. Stage 0 must establish and document one reproducible Node 22 installation path before Pi is installed.

## 3. Contribution Boundary

### 3.1 Pi-owned capabilities

Margin reuses and does not claim authorship of:

- the agent loop;
- LLM provider and model execution;
- tool-call orchestration;
- Pi session JSONL persistence;
- session creation, switching, resume, fork, and branch navigation;
- context compaction and branch summaries;
- Pi lifecycle and streaming events.

### 3.2 Margin-owned capabilities

Margin adds:

- structured projects, tasks, decisions, memories, actions, and events;
- explicit links from Margin records to source Pi sessions and runs;
- memory proposal, confirmation, correction, expiry, and deletion controls;
- project-aware retrieval and context planning;
- four domain tools exposed to Pi;
- a default-deny permission policy and auditable confirmation flow;
- conflict detection and optimistic version checks;
- cross-session benchmark definitions, runners, traces, and reports;
- user-research protocols and evidence packaging.

### 3.3 Not yet implemented

Until verified by code and evidence, Margin must not claim:

- successful Pi integration;
- improved cross-session task success;
- measured memory precision or recall;
- user adoption, retention, or market demand;
- production-ready security or privacy.

## 4. Integration Decision

### 4.1 Selected approach

Use `AgentSessionRuntime` from `@earendil-works/pi-coding-agent` in the existing Node application.

This approach preserves Pi's session replacement and compaction behavior while allowing Margin to register custom tools, inject structured context, subscribe to traces, and enforce its own permission policy.

### 4.2 Rejected alternatives

**RPC subprocess as the primary integration:** retained as a fallback if SDK embedding causes an unrecoverable dependency or process-isolation problem. RPC adds process lifecycle, JSONL framing, UI confirmation bridging, and duplicated failure recovery, so it is not the MVP default.

**Direct use of `pi-agent-core`:** rejected for the MVP because Margin would have to rebuild session replacement, compaction integration, and coding-agent runtime behavior that the project explicitly intends to reuse.

### 4.3 Adapter boundary

Margin code must depend on an internal runtime port rather than importing Pi throughout the application.

The runtime port exposes:

```text
createSession(projectId)
resumeSession(sessionId)
sendMessage(sessionId, input)
forkSession(sessionId, entryId)
compactSession(sessionId)
subscribe(sessionId, listener)
disposeSession(sessionId)
```

`PiAgentRuntimeAdapter` implements the port. Tests use `FakeAgentRuntimeAdapter`, making domain and evaluation tests independent of live model calls.

## 5. Dual-Layer Architecture

### 5.1 Pi Session layer

Pi remains the source of truth for:

- user, assistant, and tool-result messages;
- model and thinking-level changes;
- tool execution trajectories;
- session tree and parent relationships;
- branch summaries and compaction summaries;
- token and provider usage recorded by Pi.

Margin never copies the complete Pi session into a second conversation-history table.

### 5.2 Margin continuity layer

Margin is the source of truth for durable work state:

- `project`: a sustained user objective;
- `task`: the current or completed units of progress;
- `decision`: a confirmed conclusion with evidence and revision history;
- `memory`: a proposed or confirmed continuity fact;
- `action`: a next step the user may perform;
- `event`: an immutable record of state transitions and corrections;
- `tool_audit`: an immutable record of permission and tool outcomes.

### 5.3 Ownership rule

If a record answers "what happened in the agent conversation?", it belongs to Pi Session.

If it answers "what state should survive into a different session and affect future work?", it belongs to Margin.

Pi compaction summaries are not automatically Margin memories. They may be cited as evidence by `memory_propose`, but durable storage still passes Margin's write gate.

## 6. Data Model

New tables use explicit columns for identity, ownership, versioning, source, confirmation, and lifecycle. JSON is reserved for bounded metadata, not primary relationships.

### 6.1 `continuity_projects`

```text
id
title
goal
domain                 learning_research | job_project
status                 active | paused | completed | archived
current_phase
version
created_at
updated_at
deleted_at
```

### 6.2 `continuity_tasks`

```text
id
project_id
title
status                 pending | active | blocked | completed | cancelled
blocker
completion_criteria
position
version
source_session_id
created_at
updated_at
deleted_at
```

Only one task per project may be `active`. The constraint is enforced transactionally.

### 6.3 `continuity_decisions`

```text
id
project_id
task_id
statement
status                 proposed | confirmed | superseded | withdrawn
confidence
source_session_id
source_entry_id
supersedes_id
version
created_at
updated_at
deleted_at
```

Conflicting decisions are preserved. A new confirmed decision supersedes an older one rather than overwriting its evidence.

### 6.4 `continuity_memories`

```text
id
project_id
task_id
content
memory_type            fact | preference | constraint | blocker | recovery | milestone
sensitivity            normal | sensitive | restricted
status                 proposed | confirmed | rejected | superseded | expired | deleted
confidence
source_session_id
source_entry_id
supersedes_id
expires_at
version
created_at
updated_at
deleted_at
```

Sensitive and restricted memories cannot move from `proposed` to `confirmed` without an explicit user confirmation event.

### 6.5 `continuity_actions`

```text
id
project_id
task_id
title
detail
status                 pending | active | completed | cancelled
due_at
source_session_id
version
created_at
updated_at
deleted_at
```

### 6.6 `continuity_events`

```text
id
project_id
entity_type
entity_id
event_type
from_version
to_version
source_session_id
source_tool_call_id
actor                  user | margin | migration
payload_json
created_at
```

Events are append-only. Corrections and deletions create events even when the entity is soft-deleted.

### 6.7 `tool_audit_log`

```text
id
pi_session_id
pi_entry_id
tool_call_id
tool_name
risk_level             read | reversible_write | destructive | external
authorization_status   allowed | confirmed | denied | expired
input_summary
input_hash
result_status          succeeded | failed | blocked | rolled_back
error_code
entity_type
entity_id
entity_version
created_at
completed_at
```

Audit rows store redacted summaries and hashes, not unrestricted copies of sensitive prompts or secrets.

## 7. Four Margin Tools

All tools are registered through a Pi extension factory. Pi's built-in `bash`, `edit`, `write`, file discovery, and network-capable tools are disabled for the continuity MVP.

### 7.1 `memory_search`

Purpose: retrieve confirmed, non-deleted, non-expired memories for the active project.

Inputs:

```text
project_id
task_id?
query
limit                 1..5
as_of
```

Output includes memory ID, content, type, confidence, source session, age, version, and retrieval reasons. No match returns an empty list and `reason: no_relevant_memory`.

The tool is read-only and may run without confirmation.

### 7.2 `memory_propose`

Purpose: create a candidate durable memory without silently confirming it.

Inputs:

```text
project_id
task_id?
content
memory_type
sensitivity
confidence
source_session_id
source_entry_id?
expires_at?
```

Normal, low-risk candidates remain `proposed` until the write policy either auto-confirms an explicitly allowed structured event or the user confirms them. Sensitive and restricted candidates always require user confirmation.

### 7.3 `state_update`

Purpose: change project, task, blocker, or decision state.

Inputs include `entity_type`, `entity_id`, `expected_version`, `operation`, and the allowed field patch.

Every successful update increments the version and emits a continuity event. A stale `expected_version` fails with `state_version_conflict`; it never overwrites newer state.

### 7.4 `action_update`

Purpose: create, activate, complete, cancel, or restore an action.

Inputs include project/task ownership, action ID when updating, `expected_version`, operation, title/detail, and optional due date.

Completing an action does not automatically complete its parent task unless the tool call explicitly requests that transition and the task completion criteria are satisfied.

## 8. Permission and Confirmation Model

The default policy is deny.

| Risk | Examples | Default behavior |
|---|---|---|
| Read | memory search, state view | allow and audit |
| Reversible write | propose memory, create action, update blocker | allow only within declared project; audit |
| Sensitive write | confirm sensitive memory, stable preference | require explicit confirmation |
| Destructive | permanent deletion, irreversible merge | require confirmation and a second scoped execution token |
| External | files, shell, network, external service write | disabled in MVP |

Confirmation produces a short-lived, single-operation token bound to:

- user-visible operation summary;
- entity and expected version;
- exact tool name;
- normalized input hash;
- expiry time.

A confirmation cannot authorize a broader or changed operation.

Permanent deletion uses soft deletion first. Physical purge is a separate maintenance operation and is excluded from the first cross-session MVP.

## 9. Context Planning

Before each Pi model call, Margin's context planner injects only:

1. the active project's goal, phase, and status;
2. the active task, blocker, and completion criteria;
3. confirmed current decisions;
4. at most five relevant memories;
5. confirmed stable user information relevant to the task;
6. the four allowed tool contracts and current permission scope.

Pi remains responsible for recent conversation messages and compaction summaries.

Margin context is injected through Pi's pre-model `context` extension event as a typed custom message. It is regenerated from current state for every model call and is not copied into durable memory merely because it was injected.

Three independent gates are enforced:

```text
write gate: should this become durable Margin state?
recall gate: should this record enter the current model context?
display gate: should the assistant proactively mention it to the user?
```

Retrieval never increments durable importance merely because an item was retrieved. This removes the current positive-feedback behavior in which repeated recall increases memory weight.

## 10. Cross-Session Flow

1. A user starts or selects a Margin project.
2. Margin creates a Pi session and records its ID against the project.
3. Pi handles dialogue and calls only the four Margin tools.
4. Tool operations update structured state and write audit/events.
5. The user interrupts the task.
6. A new Pi session is created and linked to the same Margin project.
7. Margin builds fresh context from current structured state and confirmed memories.
8. Pi proposes the next step without replaying the full previous session.
9. The user may inspect sources, correct state, reject a memory, or continue the task.

The original Pi session remains available for trace inspection but is not replayed wholesale.

## 11. Compatibility and Migration

Existing tables remain readable during the MVP. They are not silently reinterpreted as Pi sessions.

Migration rules:

- existing `learning_sessions` may be imported as draft continuity projects/tasks;
- existing `actions` may be imported as continuity actions;
- existing `conversations` remain legacy records and are not bulk-promoted;
- only pinned/core records or explicitly selected records may become proposed continuity memories;
- every imported record has `actor: migration` and a source reference;
- migration supports dry-run, count comparison, and rollback from backup;
- existing `/chat`, `/memory`, and `/state` contracts remain available behind a legacy compatibility path until the Pi flow reaches acceptance.

No destructive migration runs automatically at application startup.

## 12. Error Handling and Consistency

### 12.1 Pi unavailable

If Pi cannot initialize, Margin returns `pi_runtime_unavailable` with a diagnostic ID. It does not silently route the request through the legacy reflective engine while claiming that the Pi flow ran.

### 12.2 Database unavailable

Margin enters a read-only/no-continuity mode only when Pi can still run safely. The response explicitly states that durable state and memory are unavailable. No write is reported as successful.

### 12.3 Tool failure

Each tool call has a stable idempotency key derived from Pi session ID and tool call ID. Retries return the previous committed result or resume a known incomplete operation; they do not duplicate actions or events.

### 12.4 Version conflict

Stale writes fail closed with the current entity version and a conflict summary. The model must re-read state before proposing another update.

### 12.5 Partial failure

Domain mutation, entity version increment, continuity event, and tool audit result are committed in one SQLite transaction. If any part fails, the transaction rolls back and the audit attempt is marked failed without claiming a state change.

### 12.6 Context or retrieval failure

No relevant memory produces an empty result. A retrieval error is distinct from an empty result and is recorded as `memory_search_failed`.

## 13. Evaluation Design

### 13.1 Freeze point

The evaluation protocol, task schemas, scoring rules, model configuration, tool permissions, prompt version, and first 50 tasks are frozen after product-scope approval and before behavior implementation begins.

The benchmark is versioned. Changes create a new benchmark version and do not rewrite earlier results.

### 13.2 Conditions

All conditions use the same model, model version, temperature, prompt, task inputs, permissions, run count, and timeout.

- **A — new Pi session, no bridge:** no prior session content or Margin continuity context;
- **B — new Pi session, summary bridge:** one ordinary summary of the prior session;
- **C — new Pi session, Margin bridge:** structured project/task/decision state and Top-k confirmed memories.

Continuing the original Pi session is recorded as a separate reference condition, not merged into A/B/C.

### 13.3 Task set

The minimum frozen set contains 50 cross-session tasks across:

- new-session recovery;
- continuation after Pi compaction;
- multi-project switching;
- state supersession;
- correction and deletion;
- no relevant memory;
- sensitive information;
- interruption around tool execution.

Tasks are divided into a visible development set and a held-out test set. Debugging may use the development set; implementation decisions must not inspect held-out expected outputs.

### 13.4 Metrics

The report calculates, without pre-filling results:

- cross-session task success;
- recovery time;
- repeated-background information units;
- Memory Precision@5 and Recall@5;
- expired/conflicting recall rate;
- tool-task success;
- input tokens and cost;
- high-risk confirmation coverage.

Every metric links to task-level traces, configuration, scoring output, and aggregation code.

Automated test counts are reported as engineering verification, not user value.

## 14. Real-Use Research

AI prepares but does not fabricate:

- participant instructions;
- consent and privacy text;
- daily task diary;
- recall correctness/interruption coding form;
- correction and deletion log;
- exit interview guide;
- analysis template.

The minimum research target is five real participants, seven days, and one sustained task per participant. Results are described as formative evidence, not market validation.

If participants, consent, or accounts are unavailable, the project records the study as blocked and does not generate substitute user results.

## 15. Failure Taxonomy

Each failure record contains a trace ID, benchmark/task ID, configuration hash, observed behavior, root cause, fix, regression test, and known side effects.

Initial categories are:

- ordinary chat polluted project state;
- instruction noise entered a topic or memory;
- stale state overwrote newer state;
- retrieval created a positive feedback loop;
- sensitive information was proposed or stored without confirmation;
- correct memory appeared at an intrusive moment;
- tool call exceeded its permission scope;
- tool failure left state and audit records inconsistent;
- Pi session and Margin project links diverged.

At least one real failure must complete the full trace-to-regression loop before the project is presented as complete.

## 16. Delivery Stages

### Stage 0 — audit and reproducible Pi spike

- establish Node `22.23.1` runtime instructions;
- install Pi in an isolated spike, not the production path;
- run one in-memory session, one persisted session, one new-session transition, one compaction, and one custom no-op tool;
- record exact versions, lockfile integrity, license, and upstream links;
- produce the four audit/architecture documents requested by the project brief.

### Stage 1 — scope and evaluation freeze

- freeze the two product scenarios;
- define A/B/C precisely;
- freeze benchmark v1, scoring contracts, and configuration format.

### Stage 2 — continuity schema and runtime adapter

- add versioned continuity tables and repositories;
- implement the runtime port, Pi adapter, and fake adapter;
- link Pi sessions to Margin projects without duplicating session history.

### Stage 3 — tools and permissions

- implement the four tools;
- implement audit, idempotency, version conflicts, confirmation tokens, correction, and soft deletion;
- enable only the four tools.

### Stage 4 — context planner and cross-session MVP

- add write, recall, and display gates;
- inject bounded structured context;
- complete one learning/research and one job/project cross-session path.

### Stage 5 — benchmark execution

- run A/B/C using frozen artifacts;
- generate task-level traces and aggregate reports;
- record failures without rewriting benchmark v1.

### Stage 6 — real-use package and study

- prepare the study package;
- wait for user-organized participants and consent;
- analyze only collected data.

### Stage 7 — evidence and presentation

- close at least one failure loop;
- produce architecture, evaluation, privacy, interview, resume-placeholder, and demo materials;
- retain explicit Pi/Margin contribution labels in every artifact.

## 17. Non-Goals for the MVP

- rebuilding Pi's agent loop, session manager, branches, or compaction;
- broad file, shell, network, browser, or external-account automation;
- new TTS, achievements, dashboards, or unrelated pages;
- automatic promotion of ordinary chat to long-term memory;
- physical data purge automation;
- vector database adoption before lexical/structured retrieval has a measured limitation;
- multi-user cloud deployment;
- claims based on simulated users.

## 18. Acceptance Criteria

The MVP is accepted only when:

- Pi repository, tag, package, license, Node version, and lockfile are recorded;
- Pi and Margin contribution boundaries are visible in code and documentation;
- a real new Pi session resumes a sustained Margin project;
- only the four Margin tools are callable;
- sensitive writes and destructive operations fail without valid confirmation;
- a user can inspect source, correct a record, and soft-delete one memory;
- state updates reject stale versions;
- empty retrieval and retrieval failure are distinguishable;
- A/B/C run against the same frozen benchmark and configuration;
- at least 50 task-level results can be recomputed from scripts and traces;
- the real-use report contains only actual collected data;
- at least one failure has a trace, fix, regression test, and side-effect note;
- resume and interview claims link to auditable evidence.
