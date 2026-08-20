# Margin Stage 2 Core Schema and Tool Contracts Design

Status: approved design. Date: 2026-08-20.

## Objective

Stage 2 introduces a runtime-agnostic Margin Core data model and stable contracts for `memory_search`, `memory_propose`, `state_update`, and `action_update`. It does not connect Pi to the production `/chat` path, migrate real user data, or run comparative evaluation.

## Migration strategy

Use parallel additive storage with explicit migration. Existing tables such as `conversations`, `user_states`, `learning_sessions`, and `actions` remain unchanged and continue to serve the legacy path.

Margin Core receives its own schema namespace and migration ledger. Legacy data enters the new schema only through a later dry-run migration report followed by explicit authorization. Stage 2 provides no automatic import and deletes no legacy data.

The Margin Core feature flag defaults off. Existing chat behavior must remain unchanged when it is off.

## Runtime boundary

Margin Core is plain application and persistence code with no Pi imports. It owns authoritative state, memory, versions, provenance, correction/deletion history, permission decisions, and audit evidence.

The Pi Extension Adapter is a thin future consumer. It will register tools, translate Pi calls into Margin Core requests, and translate stable results back to Pi. Pi continues to own its agent loop, messages, Session history, branching, tool execution, and compaction.

Skill Policies guide learning/research and career/project workflows but do not own credentials, durable state, permissions, or scoring.

## Identity and time conventions

- All new entities use application-generated stable string IDs.
- Timestamps are UTC ISO 8601 strings.
- Mutable aggregate rows carry a positive integer `version`.
- Writes to an existing aggregate require `expectedVersion`.
- A successful write increments the version once.
- A mismatch returns `version_conflict` and writes no entity or success event.
- Source identifiers are opaque strings and are never inferred from content.
- Content deletion is represented by an event and tombstone metadata; audit evidence is not silently removed.

## Tables

### `margin_schema_migrations`

- `version INTEGER PRIMARY KEY`
- `name TEXT NOT NULL UNIQUE`
- `checksum TEXT NOT NULL`
- `applied_at TEXT NOT NULL`

Migrations are append-only and checksum-verified. A recorded version with a different checksum aborts startup for the Margin Core store.

### `margin_projects`

- `id TEXT PRIMARY KEY`
- `scenario TEXT NOT NULL CHECK scenario IN ('learning_research', 'career_project')`
- `goal TEXT NOT NULL`
- `phase TEXT NOT NULL`
- `status TEXT NOT NULL CHECK status IN ('active', 'blocked', 'completed', 'archived')`
- `version INTEGER NOT NULL CHECK version > 0`
- `source_session_id TEXT NOT NULL`
- `source_event_id TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `deleted_at TEXT`

### `margin_tasks`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL REFERENCES margin_projects(id)`
- `title TEXT NOT NULL`
- `current_step TEXT NOT NULL`
- `blocker TEXT`
- `completion_condition TEXT NOT NULL`
- `status TEXT NOT NULL CHECK status IN ('pending', 'active', 'blocked', 'completed', 'cancelled')`
- provenance, version, timestamps, and optional tombstone fields matching the project conventions

At most one non-deleted `active` task exists per project, enforced by a partial unique index.

### `margin_decisions`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL REFERENCES margin_projects(id)`
- `task_id TEXT REFERENCES margin_tasks(id)`
- `decision_key TEXT NOT NULL`
- `content TEXT NOT NULL`
- `status TEXT NOT NULL CHECK status IN ('confirmed', 'superseded', 'revoked')`
- `effective_at TEXT NOT NULL`
- `expires_at TEXT`
- `superseded_by TEXT REFERENCES margin_decisions(id)`
- provenance, version, and timestamps

Only one confirmed, non-expired decision may be current for a `(project_id, decision_key)` pair. Replacing a decision creates a new row and marks the previous row superseded in one transaction.

### `margin_memories`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL REFERENCES margin_projects(id)`
- `task_id TEXT REFERENCES margin_tasks(id)`
- `content TEXT NOT NULL`
- `memory_type TEXT NOT NULL CHECK memory_type IN ('fact', 'preference', 'constraint', 'context', 'sensitive')`
- `confidence REAL NOT NULL CHECK confidence >= 0 AND confidence <= 1`
- `confirmation_status TEXT NOT NULL CHECK confirmation_status IN ('proposed', 'confirmed', 'rejected')`
- `valid_from TEXT NOT NULL`
- `expires_at TEXT`
- `superseded_by TEXT REFERENCES margin_memories(id)`
- provenance, version, timestamps, and optional tombstone fields

Sensitive memories and durable preferences are never inserted as confirmed by `memory_propose`; they remain proposed until an explicit confirmation operation is introduced.

### `margin_events`

- `id TEXT PRIMARY KEY`
- `entity_type TEXT NOT NULL`
- `entity_id TEXT NOT NULL`
- `project_id TEXT`
- `event_type TEXT NOT NULL CHECK event_type IN ('created', 'updated', 'completed', 'failed', 'superseded', 'revoked', 'deleted', 'restored', 'confirmation_requested', 'confirmation_rejected')`
- `entity_version INTEGER`
- `payload TEXT NOT NULL DEFAULT '{}'`
- `source_session_id TEXT NOT NULL`
- `source_event_id TEXT NOT NULL`
- `created_at TEXT NOT NULL`

Events are append-only. Payloads contain structured deltas or reason codes, not credentials or full model prompts.

### `margin_actions`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL REFERENCES margin_projects(id)`
- `task_id TEXT REFERENCES margin_tasks(id)`
- `title TEXT NOT NULL`
- `detail TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL CHECK status IN ('proposed', 'pending_confirmation', 'pending', 'active', 'completed', 'cancelled')`
- `risk_level TEXT NOT NULL CHECK risk_level IN ('read_only', 'internal_write', 'external_write', 'high_risk')`
- `due_at TEXT`
- `confirmation_required INTEGER NOT NULL CHECK confirmation_required IN (0, 1)`
- provenance, version, timestamps, and optional tombstone fields

External-write and high-risk actions cannot enter `pending`, `active`, or `completed` without a recorded confirmation reference.

### `margin_audit_log`

- `id TEXT PRIMARY KEY`
- `operation TEXT NOT NULL`
- `request_id TEXT NOT NULL`
- `actor_type TEXT NOT NULL CHECK actor_type IN ('user', 'agent', 'system')`
- `project_id TEXT`
- `entity_type TEXT`
- `entity_id TEXT`
- `permission_decision TEXT NOT NULL CHECK permission_decision IN ('allowed', 'confirmation_required', 'denied')`
- `result_code TEXT NOT NULL`
- `input_digest TEXT NOT NULL`
- `metadata TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL`

The log records hashes and bounded metadata rather than raw sensitive input. Denied calls are audited even when no domain entity changes.

## Transaction boundary

Every state-changing operation uses one SQLite transaction. The transaction contains the aggregate mutation, associated `margin_events` rows, and `margin_audit_log` entry. Any failure rolls back all three.

Read operations write only a bounded audit entry. They do not reinforce memory weights or mutate recall state in Stage 2.

## Stable result envelope

Core tool handlers return one of:

```js
{ ok: true, data, auditId }
{ ok: false, error: { code, retryable, details? }, auditId? }
```

Error details contain IDs, expected/actual versions, or confirmation requirements only. They never contain credentials, raw SQL, provider exceptions, or full memory contents.

Stable error codes:

- `invalid_request`
- `project_not_found`
- `task_not_found`
- `memory_not_found`
- `action_not_found`
- `version_conflict`
- `cross_project_reference`
- `confirmation_required`
- `permission_denied`
- `no_relevant_memory`
- `storage_failure`

`no_relevant_memory` is a successful empty search condition represented in `data`, not an invented recollection. The error code remains available internally for metrics and trace classification but does not convert the tool call into fabricated success content.

## Tool contracts

### `memory_search`

Input:

- `requestId`, `projectId`, optional `taskId`
- query text
- optional memory types
- `topK` limited to 1 through 10
- `asOf` timestamp

Behavior:

- restrict to the requested project and optional task;
- include only confirmed, non-deleted memories valid at `asOf`;
- exclude expired and superseded memories;
- combine deterministic lexical relevance, confidence, and recency with bounded weights;
- return at most `topK` results with memory ID, content, type, confidence, source IDs, version, and validity timestamps;
- return `items: []` and `reason: 'no_relevant_memory'` when none qualify;
- never mutate a memory because it was recalled.

Stage 2 does not use embeddings or a remote vector store.

### `memory_propose`

Input:

- request, project, optional task, and source IDs;
- content, memory type, confidence, validity, and optional expiry;
- actor and permission context.

Behavior:

- validate project/task ownership;
- create a `proposed` memory;
- never silently upgrade ordinary chat into durable state;
- sensitive and stable-preference content always remains proposed;
- write `created` and, when required, `confirmation_requested` events;
- return the candidate and whether confirmation is required.

Duplicate proposal detection may return the existing candidate ID but does not reinforce confidence.

### `state_update`

Input:

- request and source IDs;
- project ID and `expectedVersion`;
- one explicit operation: update project, update task, create/replace/revoke decision, complete task, or record blocker;
- actor and permission context.

Behavior:

- reject cross-project references;
- compare the aggregate version before mutation;
- replace decisions by creating a new versioned row and superseding the old one;
- record structured events and audit evidence atomically;
- return the updated aggregate and new version.

It does not accept arbitrary table names, SQL fragments, or free-form patches.

### `action_update`

Input:

- request and source IDs;
- project and optional task IDs;
- one operation: create, activate, complete, or cancel;
- action fields, `expectedVersion` for existing actions, actor, and permission context;
- optional confirmation reference.

Behavior:

- internal low-risk actions may be created as pending;
- external-write and high-risk actions become `pending_confirmation` without a valid confirmation reference;
- activation and completion enforce version and permission checks;
- cancellation is a traceable status transition, not deletion;
- entity, event, and audit writes are atomic.

## Permissions

Stage 2 uses an explicit permission object supplied by the host. Missing permission means deny. No tool can infer permission from natural-language content.

- read permission controls `memory_search`;
- memory proposal permission controls `memory_propose`;
- internal state-write permission controls `state_update`;
- action-write permission plus risk-specific confirmation controls `action_update`.

The Core returns `permission_denied` or `confirmation_required` before changing domain rows.

## Legacy migration boundary

A later migration module may read legacy tables and produce:

- proposed target entities;
- source mapping;
- conflicts and dropped-field warnings;
- a dry-run digest.

Applying the migration requires explicit authorization bound to that digest. Stage 2 designs this boundary but does not implement or execute the importer.

## Testing strategy

Tests use temporary SQLite databases and a deterministic clock/ID factory. Required coverage includes:

- migration idempotence and checksum mismatch;
- foreign keys and one-active-task invariant;
- optimistic version conflicts with no partial writes;
- decision supersession and historical visibility;
- empty, expired, superseded, and cross-project memory search;
- no recall-driven mutation;
- sensitive proposal confirmation state;
- ordinary-chat rejection;
- permission denial and confirmation gates;
- transaction rollback across entity, event, and audit writes;
- stable error envelopes without secret or raw-content leakage;
- compatibility with Stage 1 project/fact/source/artifact vocabulary.

## Stage 2 completion boundary

Stage 2 is complete when the additive schema, repository interfaces, four Core tool handlers, permission gates, audit trail, and tests are implemented behind a default-off feature flag.

Completion does not mean production Pi integration, legacy migration, 50-task evaluation, A/B/C baseline results, or real-user validation. Those remain later stages.

## Acceptance criteria

- Legacy tables and production chat remain unchanged.
- Margin Core contains no Pi imports.
- All entity changes are versioned and provenance-addressable.
- Every write is atomically paired with event and audit evidence.
- Search returns an explicit empty result when appropriate.
- Cross-project references, stale versions, missing permissions, and unconfirmed risk are rejected.
- Sensitive and durable proposals cannot be silently confirmed.
- No fixture, migration, or audit record contains credentials or real personal data.
