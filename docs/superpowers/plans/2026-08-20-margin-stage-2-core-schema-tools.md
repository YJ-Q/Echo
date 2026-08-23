# Margin Stage 2 Core Schema and Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Build a default-off, runtime-agnostic Margin Core with additive SQLite storage, versioned provenance, permission/audit gates, and four stable tool handlers.

**Architecture:** New code lives under src/core and uses its own connection without modifying legacy memoryStore. Repository writes are transactional; tool handlers validate contracts and permissions. Pi and production chat remain untouched.

**Tech Stack:** JavaScript ESM, Node.js 22.23.1, sqlite/sqlite3, node:test, temporary databases.

## Global Constraints

- Keep Pi 0.84.2 and Node 22.23.1 pinned.
- Do not alter legacy tables, production chat, or real data.
- MARGIN_CORE_ENABLED defaults false.
- Margin Core contains no Pi imports.
- Existing aggregate writes require expectedVersion and increment once.
- Domain mutation, event, and audit success are atomic.
- Missing permission denies; text never grants permission.
- Stage 1 fixtures remain byte-identical.

---

### Task 1: Contracts and permissions

**Files:** Create src/core/contracts.js, src/core/permissions.js, test/marginCoreContracts.test.js.

**Interfaces:** ok(data,auditId), fail(code,options), digestInput(value), requireFields(input,names), decidePermission(input).

- [ ] Write failing tests for exact envelopes, canonical SHA-256 digest, redacted invalid requests, default deny, allowed reads/writes, and external/high-risk confirmation.

~~~js
assert.deepEqual(decidePermission({
  operation: 'action_update',
  permissions: { actionWrite: true },
  riskLevel: 'external_write'
}), { decision: 'confirmation_required', code: 'confirmation_required' });
~~~

- [ ] Run node --test test/marginCoreContracts.test.js and observe module-not-found.
- [ ] Implement recursively sorted object keys, stable errors, and this exact permission map:

~~~js
const permissionKeys = {
  memory_search: 'memoryRead',
  memory_propose: 'memoryPropose',
  state_update: 'stateWrite',
  action_update: 'actionWrite'
};
~~~

- [ ] Re-run focused tests and commit with feat: define Margin Core contracts and permissions.

### Task 2: Additive schema and migrations

**Files:** Create src/core/migrations/001-margin-core.js, src/core/marginCoreStore.js, test/helpers/marginCoreTestDb.js, test/marginCoreSchema.test.js.

**Interfaces:** MARGIN_CORE_MIGRATIONS and openMarginCoreStore({ dbPath, clock, idFactory, beforeEvidenceWrite }); store exposes close, migrate, transaction, getSchemaEvidence.

The migration creates exactly `margin_schema_migrations`, `margin_projects`, `margin_tasks`, `margin_decisions`, `margin_memories`, `margin_events`, `margin_actions`, and `margin_audit_log` using the columns and checks frozen in the approved Stage 2 specification.

- [ ] Write failing tests for all eight tables, foreign keys, migration idempotence, checksum mismatch, active-task uniqueness, and coexistence with legacy conversations.
- [ ] Run node --test test/marginCoreSchema.test.js and observe RED.
- [ ] Implement approved columns/checks/indexes, including:

~~~sql
CREATE UNIQUE INDEX margin_one_active_task_per_project
ON margin_tasks(project_id)
WHERE status = 'active' AND deleted_at IS NULL;
~~~

- [ ] Apply missing migrations transactionally and reject recorded version/name/checksum drift.
- [ ] Re-run focused tests and commit with feat: add additive Margin Core schema.

### Task 3: Versioned repositories and atomic evidence

**Files:** Modify src/core/marginCoreStore.js; create test/marginCoreRepository.test.js.

**Interfaces:** createProject, createTask, updateProject, updateTask, getProject, getTask. Context is { requestId, actorType, sourceSessionId, sourceEventId, inputDigest, permissionDecision }.

- [ ] Write failing tests for deterministic IDs/time, version-one creation, one increment, version_conflict, cross-project rejection, active-task uniqueness, and injected rollback.
- [ ] Query entity/event/audit tables in tests to prove no partial writes.
- [ ] Run node --test test/marginCoreRepository.test.js and observe RED.
- [ ] Implement parameterized repositories. Entity creation writes created; updates write the matching event. Audit metadata contains operation and IDs only.
- [ ] Re-run focused tests and commit with feat: add versioned Margin Core repositories.

### Task 4: Memory tools

**Files:** Create src/core/tools/memoryTools.js; modify store; create test/marginCoreMemoryTools.test.js.

**Interfaces:** createMemoryTools({store}) returns memorySearch and memoryPropose. Empty search returns { items: [], reason: 'no_relevant_memory' }.

- [ ] Write failing tests for topK, default deny, project/task isolation, confirmed/current/non-expired filtering, source fields, empty result, no recall mutation, sensitive proposal, ordinary-chat rejection, duplicate proposal, and rollback.
- [ ] Run node --test test/marginCoreMemoryTools.test.js and observe RED.
- [ ] Implement deterministic retrieval:

~~~js
score = lexicalOverlap * 0.6 + confidence * 0.3 + recencyBucket * 0.1;
~~~

- [ ] Tie-break by score descending, updated_at descending, ID ascending. Do not add embeddings or recall reinforcement. Proposals start proposed; sensitive and preference require confirmation.
- [ ] Re-run focused tests and commit with feat: add governed Margin memory tools.

### Task 5: State update tool

**Files:** Create src/core/tools/stateTool.js; modify store; create test/marginCoreStateTool.test.js.

**Interface:** createStateTool({store}).stateUpdate(input,context). Allowed operations are update_project, create_task, update_task, record_blocker, complete_task, replace_decision, revoke_decision.

- [ ] Write failing tests for operation allowlist, permission denial, version conflict, blockers, completion, decision replacement/revocation, cross-project rejection, and rollback.
- [ ] Run node --test test/marginCoreStateTool.test.js and observe RED.
- [ ] Implement a closed switch. Replacement inserts a new confirmed decision and supersedes the old row atomically. Reject free-form patches, table names, and SQL.
- [ ] Re-run focused tests and commit with feat: add version-safe Margin state tool.

### Task 6: Action update tool

**Files:** Create src/core/tools/actionTool.js; modify store; create test/marginCoreActionTool.test.js.

**Interface:** createActionTool({store}).actionUpdate(input,context). Operations are create, activate, complete, cancel. Risks are read_only, internal_write, external_write, high_risk.

- [ ] Write failing tests for internal pending creation, risky pending_confirmation, valid confirmation, missing permission, stale version, all transitions, cross-project task rejection, cancellation history, and rollback.
- [ ] Run node --test test/marginCoreActionTool.test.js and observe RED.
- [ ] Implement only these transitions:

~~~text
proposed -> pending_confirmation | pending | cancelled
pending_confirmation -> pending | cancelled
pending -> active | completed | cancelled
active -> completed | cancelled
~~~

- [ ] Never delete actions or infer confirmation from text.
- [ ] Re-run focused tests and commit with feat: add confirmed Margin action tool.

### Task 7: Default-off composition and closure

**Files:** Create src/core/createMarginCore.js; modify src/config/env.js, .env.example, CHANGELOG.md; create docs/audit/stage_2_core_report.md, test/marginCoreComposition.test.js, test/stage2Documentation.test.js.

**Interfaces:** createMarginCore({ enabled, dbPath, clock, idFactory }) returns { enabled:false } without I/O or { enabled:true, store, tools, close }. loadRuntimeConfig exposes marginCoreEnabled.

- [ ] Write failing tests for flag parsing, invalid boolean, disabled no-I/O, exactly four enabled handlers, no Pi imports under src/core, unchanged Stage 1 hashes, no Stage 2 diff to memoryStore, and no measured claims.
- [ ] Run node --test test/marginCoreComposition.test.js test/stage2Documentation.test.js and observe RED.
- [ ] Compose the modules without importing the facade from server/chat. Add MARGIN_CORE_ENABLED=false to .env.example as development-only.
- [ ] Write the audit report with implemented evidence and exclusions: Pi adapter, legacy migration, 50-task set, A/B/C evaluation, and user research.
- [ ] Run:

~~~powershell
npm test
npm run validate:stage1
npm run audit:pi
git diff --check
~~~

- [ ] Scan for credentials, raw provider errors, real personal data, percentage claims, and Pi imports under src/core.
- [ ] Commit with docs: close Margin Core Stage 2.

## Completion gate

- Migrations are additive, idempotent, and checksum-bound.
- Legacy tables and production chat are untouched.
- Four handlers exist behind a default-off facade.
- Versioning, provenance, isolation, permissions, confirmation, events, audits, and rollback have negative tests.
- Empty search is explicit and recall causes no mutation.
- Stage 1 remains manifest-bound.
- Full tests, Stage 1 validation, and Pi audit pass.
- Independent review has no unresolved Critical or Important findings.

The next plan may implement the internal Pi Extension Adapter and cross-Session context planner.
