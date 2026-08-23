# Margin V1 Phase 1–7 Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the verified Pi + terminal continuity pilot into Margin V1 through seven independently gated phases without rewriting the agent runtime or creating a second source of truth.

**Architecture:** Build a runtime-neutral Application Core around persistent Workstream, Run, Artifact, Checkpoint, Decision, Event, and DayPlan objects. Keep Pi behind an adapter, keep all surfaces stateless, and add Web, Workspace, Feishu, Scheduler, and Daily Loop only after the preceding persistence and control gates pass.

**Tech Stack:** Node.js ESM >=22.19.0, SQLite for the initial single-node core, `node:test`, Pi Agent `0.84.2` as the current runtime baseline; later surface/deployment stacks require their phase ADRs.

## Global Constraints

- Do not add new business behavior to the legacy `src/routes/`, `src/services/`, or `src/storage/memoryStore.js` path.
- Do not delete or merge `data/echo.sqlite` before an export, inventory, migration decision, and user approval.
- Pi Session is runtime state; Workstream and Run are Margin state.
- Event is append-only product evidence; Audit is authorization and invocation evidence.
- Every durable write uses request-ID idempotency, provenance, optimistic versioning, and a transaction.
- All automatic execution is observable, pausable, resumable, and auditable.
- External send/publish, important deletion, permission changes, strategic goals, and out-of-scope work remain denied or host-confirmed.
- Each phase needs a focused spec review before its first production-code task. This roadmap fixes boundaries and dependencies; it does not waive that gate.

---

## Dependency Flow

```text
Phase 1 Persistent Core
  -> Phase 2 Web Workbench
  -> Phase 3 Shared Workspace
  -> Phase 4 Feishu Surface
  -> Phase 5 Scheduler + Overnight Run
  -> Phase 6 Daily Operating Loop
  -> Phase 7 E2E / Reliability
```

Phase 2 and Phase 3 may overlap only after the Phase 1 API and control contracts are frozen. Phase 4 may start after the same API is stable. Phase 5 must not start unattended execution until Phase 3 checkpoint/stop behavior passes.

---

### Task 1: Freeze Phase 1 domain vocabulary and state machines

**Phase:** 1 — Persistent Core
**Complexity:** M
**Files:**
- Create: `docs/architecture/adr/001-workstream-run-state-model.md`
- Create: `src/domain/workstream.js`
- Create: `src/domain/run.js`
- Test: `test/workstreamDomain.test.js`
- Test: `test/runDomain.test.js`

**Interfaces:**
- Produces: `WORKSTREAM_STATUSES`, `transitionWorkstream(current, command)`.
- Produces: `RUN_STATUSES`, `transitionRun(current, command)`.
- Consumes: no runtime or database package.

- [ ] **Step 1: Write failing pure-domain tests**

```js
assert.equal(transitionWorkstream({ status: 'running' }, { type: 'pause' }).status, 'paused');
assert.throws(() => transitionRun({ status: 'completed' }, { type: 'resume' }), /invalid_run_transition/);
assert.equal(transitionRun({ status: 'running' }, { type: 'needs_owner' }).status, 'needs_owner');
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --test-name-pattern="workstream|run transition"`
Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement the closed state machines**

```js
export const WORKSTREAM_STATUSES = Object.freeze([
  'running', 'ready', 'waiting', 'watching', 'blocked', 'needs_owner', 'paused', 'completed'
]);
export const RUN_STATUSES = Object.freeze([
  'queued', 'running', 'paused', 'completed', 'failed', 'needs_owner', 'cancelled'
]);
```

The ADR must define mapping from current project/task/action terms and explicitly state that Chat and Pi Session are not domain entities.

- [ ] **Step 4: Run focused tests**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test\workstreamDomain.test.js test\runDomain.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add docs/architecture/adr/001-workstream-run-state-model.md src/domain test/workstreamDomain.test.js test/runDomain.test.js
git commit -m "feat: define workstream and run state models"
```

### Task 2: Add versioned Persistent Core schema

**Phase:** 1 — Persistent Core
**Complexity:** L
**Files:**
- Create: `src/core/migrations/003-persistent-work.js`
- Modify: `src/core/migrations/001-margin-core.js`
- Modify: `src/core/marginCoreStore.js`
- Test: `test/persistentCoreMigrations.test.js`

**Interfaces:**
- Consumes: domain status constants from Task 1.
- Produces: Workstream fields, `margin_runs`, `margin_artifacts`, `margin_checkpoints`, and idempotency indexes.

- [ ] **Step 1: Write a failing migration test**

```js
assert.deepEqual(await tableNames(db), expect.arrayContaining([
  'margin_runs', 'margin_artifacts', 'margin_checkpoints'
]));
assert.equal((await db.get('SELECT COUNT(*) count FROM margin_projects')).count, 1);
```

The fixture must start from migrations 1–2 with one real-shaped project/task/action and prove migration 3 preserves IDs, versions, events, and audit rows.

- [ ] **Step 2: Run and verify RED**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test\persistentCoreMigrations.test.js`
Expected: FAIL because migration 3 is absent.

- [ ] **Step 3: Implement migration 3**

Add durable columns for title, current plan, next action, blockers, dependencies, workspace path, autonomy level, artifact refs, and last checkpoint. Add Run scope/status/stop condition/action bounds/result/error/checkpoint/timestamps; Artifact URI/hash/provenance; Checkpoint state version/Git ref/created by. Use JSON text only for bounded lists and validate them at repository boundaries.

- [ ] **Step 4: Run migration and Core regressions**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test\persistentCoreMigrations.test.js test\marginCoreSchema.test.js test\marginCoreRepository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/core/migrations src/core/marginCoreStore.js test/persistentCoreMigrations.test.js
git commit -m "feat: add persistent work schema"
```

### Task 3: Introduce repository contracts and application services

**Phase:** 1 — Persistent Core
**Complexity:** L
**Files:**
- Create: `src/application/workstreamService.js`
- Create: `src/application/runService.js`
- Create: `src/application/artifactService.js`
- Create: `src/application/checkpointService.js`
- Create: `src/core/persistentWorkRepository.js`
- Modify: `src/core/createMarginCore.js`
- Test: `test/persistentWorkServices.test.js`

**Interfaces:**
- Produces: `createWorkstreamService({ repository, clock, idFactory })`.
- Produces: `createRunService({ repository, clock, idFactory, authorization })`.
- Produces: `createArtifactService(...)` and `createCheckpointService(...)`.
- All methods accept `{ requestId, actor, source }` and return `{ ok, data, auditId }`.

- [ ] **Step 1: Write failing service tests**

```js
const created = await workstreams.create({ requestId: 'r1', title: 'Margin V1', goal: 'ship core' }, actor);
const replay = await workstreams.create({ requestId: 'r1', title: 'Margin V1', goal: 'ship core' }, actor);
assert.equal(replay.data.id, created.data.id);
assert.equal(await eventCount(created.data.id, 'created'), 1);
```

Also test stale versions, cross-workstream references, invalid transitions, rollback on event failure, and one active Run lease per Workstream.

- [ ] **Step 2: Verify RED**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test\persistentWorkServices.test.js`
Expected: FAIL because services are absent.

- [ ] **Step 3: Implement minimal transaction-backed services**

Services contain use-case policy; repository contains SQL; Runtime and surfaces import services, never database handles.

- [ ] **Step 4: Run focused and existing Core tests**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test\persistentWorkServices.test.js test\marginCore*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/application src/core test/persistentWorkServices.test.js
git commit -m "feat: add persistent work application services"
```

### Task 4: Add host-owned pause, stop, resume, and checkpoint controls

**Phase:** 1 — Persistent Core
**Complexity:** L
**Files:**
- Modify: `src/application/runService.js`
- Modify: `src/application/checkpointService.js`
- Modify: `src/pilot/terminalCommands.js`
- Modify: `src/pilot/terminalPilotController.js`
- Test: `test/runControl.test.js`
- Test: `test/terminalPilotController.test.js`

**Interfaces:**
- Produces: `runs.pause({ runId, expectedVersion, requestId })`, `runs.stop(...)`, `runs.resume(...)`.
- Produces terminal host commands `/pause`, `/stop`, `/resume`; model tools cannot forge them.

- [ ] **Step 1: Write failing control tests**

```js
await runs.pause({ runId, expectedVersion: 1, requestId: 'pause-1' }, userActor);
assert.equal((await runs.get(runId)).status, 'paused');
assert.equal(await runtimeActive(runId), false);
assert.equal((await checkpoints.latest(runId)).runVersion, 2);
```

- [ ] **Step 2: Verify RED**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test\runControl.test.js test\terminalPilotController.test.js`
Expected: FAIL with missing Run control API.

- [ ] **Step 3: Implement cancellation-first control flow**

Persist requested transition, interrupt/close the runtime, write checkpoint and final event, then expose the resulting stable status. A failed runtime interrupt must be visible and retryable; it must not report paused while execution remains active.

- [ ] **Step 4: Run focused tests and full suite**

Run: `npm test`
Expected: PASS with no ghost-run regression.

- [ ] **Step 5: Commit**

```powershell
git add src/application src/pilot test/runControl.test.js test/terminalPilotController.test.js
git commit -m "feat: add persistent run controls"
```

### Task 5: Migrate CLI to the unified Application Core and inventory legacy data

**Phase:** 1 — Persistent Core
**Complexity:** M
**Files:**
- Modify: `src/pilot/terminalPilotController.js`
- Create: `scripts/inventory-legacy-data.js`
- Create: `scripts/export-legacy-data.js`
- Create: `docs/audit/legacy_data_disposition.md`
- Test: `test/legacyDataInventory.test.js`
- Test: `test/terminalPersistentRestart.test.js`

**Interfaces:**
- CLI consumes Application Services only.
- Inventory emits counts, schema, hashes, and proposed disposition without conversation content.

- [ ] **Step 1: Write failing restart and inventory tests**

```js
const before = await pilotA.startWorkstream(seed);
await pilotA.close();
const after = await pilotB.resumeWorkstream(before.id);
assert.equal(after.nextAction, before.nextAction);
assert.equal(after.lastCheckpointId, before.lastCheckpointId);
```

- [ ] **Step 2: Verify RED**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test\legacyDataInventory.test.js test\terminalPersistentRestart.test.js`
Expected: FAIL until the scripts and unified path exist.

- [ ] **Step 3: Implement read-only inventory and explicit export**

Do not auto-import legacy profile, summary, or conversation records into long-term memory. Classify each table as migrate, archive, or delete-candidate and require user approval before material deletion.

- [ ] **Step 4: Pass Phase 1 exit test**

Run: `npm test; npm run validate:stage1; npm run audit:pi; git diff --check`
Expected: all pass; a service restart resumes the same Workstream and no second business database receives new V1 writes.

- [ ] **Step 5: Commit**

```powershell
git add src/pilot scripts docs/audit/legacy_data_disposition.md test
git commit -m "feat: unify cli on persistent core"
```

---

## Phase 1 Exit Gate

- One canonical V1 write path.
- Workstream, Run, Event, Decision, Artifact metadata and Checkpoint persist across restart.
- Pause/Stop/Resume are host-owned and leave no ghost execution.
- Legacy data has a reversible disposition plan.
- Pi remains an adapter; all Core tests run without Pi.

---

### Task 6: Build the Web Workbench MVP

**Phase:** 2 — Web Workbench
**Complexity:** XL
**Dependencies:** Phase 1 exit gate; frontend-stack ADR approved.

**Files:**
- Create: `docs/architecture/adr/002-web-workbench-stack.md`
- Create: `src/http/workstreamApi.js`
- Create: `src/http/runControlApi.js`
- Create: `web/` after ADR selects the framework
- Test: `test/workstreamApi.test.js`
- Test: `test/workbenchContract.test.js`

**Interfaces:**
- `GET /v1/workstreams`, `GET /v1/workstreams/:id`, `POST /v1/runs/:id/{pause|stop|resume}`.
- UI renders Workstreams, Current Work, Artifacts/Files/Activity, and Control/Context from these APIs only.

- [ ] Freeze API response schemas and frontend stack in ADR 002.
- [ ] Write failing API contract tests for list/detail/control and stale versions.
- [ ] Implement read APIs and host control endpoints against Application Services.
- [ ] Build the three-column Workbench with Goal/State/Next Action and four tabs.
- [ ] Add accessibility, narrow-desktop, reconnect, empty/error, and no-private-reasoning tests.
- [ ] Run `npm test` plus the selected frontend test/build command; require PASS.
- [ ] Commit each independently reviewable API, shell, current-work, artifact/files, and control slice.

**Exit gate:** A user can understand and control one persistent Workstream without reading terminal logs; no complete IDE is implemented.

### Task 7: Add Human-Agent Shared Workspace safety

**Phase:** 3 — Shared Workspace
**Complexity:** XL
**Dependencies:** Phase 1 controls and checkpoints; Workbench Activity surface.

**Files:**
- Create: `src/workspace/workspaceCapability.js`
- Create: `src/workspace/changeDetector.js`
- Create: `src/workspace/gitCheckpointProvider.js`
- Create: `src/application/workspaceService.js`
- Test: `test/workspaceCapability.test.js`
- Test: `test/humanEditConflict.test.js`

**Interfaces:**
- `workspace.read`, `workspace.proposeWrite`, `workspace.commitWrite`, `workspace.status` scoped by `{ workstreamId, runId, root, expectedHash }`.
- A hash mismatch transitions the Run to `paused` or `needs_owner` before any overwrite.

- [ ] Write failing path-escape, unauthorized-root, stale-hash, user-edit, checkpoint, and restore tests.
- [ ] Implement read-only capability first and verify it cannot escape `workspacePath`.
- [ ] Add staged write with expected hash and Git checkpoint.
- [ ] Detect external edits and abort stale writes before mutation.
- [ ] Surface Diff, checkpoint, user-edit and conflict Events in Workbench Activity.
- [ ] Run focused destructive-safety tests in temporary repositories and the full suite.

**Exit gate:** One real project supports scoped read/change/verify/Artifact; user edits are authoritative; Pause/Stop leaves no continued writes.

### Task 8: Add the Feishu surface

**Phase:** 4 — Feishu
**Complexity:** L
**Dependencies:** Stable Application API; deployment/auth ADR.

**Files:**
- Create: `docs/architecture/adr/003-feishu-auth-and-deployment.md`
- Create: `src/surfaces/feishu/feishuAdapter.js`
- Create: `src/surfaces/feishu/commands.js`
- Create: `src/surfaces/feishu/renderers.js`
- Test: `test/feishuAdapter.test.js`

**Interfaces:**
- Converts verified Feishu events into authenticated Margin commands.
- Renders Morning Brief, Evening Review, Night Plan approval, Needs Owner and Artifact links; stores no independent business state.

- [ ] Freeze bot/app mode, callback verification, account binding, secret storage and deployment in ADR 003.
- [ ] Write failing signature, replay, wrong-user, idempotency and approval-binding tests.
- [ ] Implement quick input and read-only summaries before mutation commands.
- [ ] Add host-bound Night Plan approval and Needs Owner resolution.
- [ ] Verify duplicate callbacks do not duplicate Event/Action/Run writes.

**Exit gate:** A bound user can view and approve the defined mobile flows; Feishu remains a Surface, not Source of Truth.

### Task 9: Add Scheduler and bounded Overnight Runs

**Phase:** 5 — Scheduler + Overnight Run
**Complexity:** XL
**Dependencies:** Run controls, checkpoints, Workspace safety, host confirmation.

**Files:**
- Create: `src/scheduler/schedulerService.js`
- Create: `src/scheduler/runLeaseRepository.js`
- Create: `src/application/nightPlanService.js`
- Create: `src/application/nightRunRecordService.js`
- Test: `test/schedulerRecovery.test.js`
- Test: `test/overnightAuthorization.test.js`

**Interfaces:**
- `scheduler.enqueue(runId, wakeAt)`, `claim(workerId, leaseUntil)`, `heartbeat`, `complete`, `release`.
- Night Plan requires scope, allowed/forbidden actions, expected outcome, stop condition, budget and checkpoint.

- [ ] Write failing crash/restart, expired lease, duplicate claim, stop-condition, budget, scope and Needs Owner tests.
- [ ] Implement a single-worker persistent queue before concurrency.
- [ ] Add lease recovery and idempotent side-effect keys.
- [ ] Bind every Run to a user-confirmed Night Plan version.
- [ ] Generate structured Completed/Partial/Failed/Needs Owner records.
- [ ] Run fault-injection tests before enabling unattended execution.

**Exit gate:** Closing clients does not stop an authorized Run; restart does not duplicate effects; all out-of-scope paths stop as Needs Owner.

### Task 10: Build the Daily Operating Loop

**Phase:** 6 — Daily Operating
**Complexity:** XL
**Dependencies:** Feishu, Scheduler, Workstream/Event/Decision.

**Files:**
- Create: `src/application/dayPlanService.js`
- Create: `src/application/dailyReviewService.js`
- Create: `src/integrations/calendar/calendarAdapter.js`
- Create: `src/application/briefService.js`
- Test: `test/dailyLoop.test.js`

**Interfaces:**
- `buildMorningBrief({ date, userId })`, `reviseDayPlan(...)`, `recordDayEvent(...)`, `buildEveningReview(...)`.
- DayPlan revisions write Decision/Event evidence; briefs are derived views.

- [ ] Freeze Calendar provider, read scope, timezone and refresh policy in a focused ADR.
- [ ] Write failing prior-night, unfinished-item, calendar-conflict, plan-revision and plan-vs-actual tests.
- [ ] Implement read-only Calendar ingest with deduplication and source timestamps.
- [ ] Generate 2–4 proposed outcomes without auto-approving them.
- [ ] Apply Local Change automatically only within an explicit policy; require user confirmation for Plan Change and discussion for Goal Conflict.
- [ ] Generate Evening Review from structured state, not chat history.

**Exit gate:** Morning Brief consumes the previous Night Run; user changes write back; daytime replanning preserves before/reason/after evidence; Evening Review reflects plan versus actual.

### Task 11: Run E2E and reliability gates

**Phase:** 7 — E2E / Reliability
**Complexity:** XL
**Dependencies:** Phases 1–6.

**Files:**
- Create: `evaluation/v1/e2e-daily-loop.json`
- Create: `evaluation/v1/e2e-persistent-work.json`
- Create: `evaluation/v1/e2e-overnight.json`
- Create: `scripts/run-v1-e2e.js`
- Create: `docs/audit/v1_e2e_report.md`
- Test: `test/v1E2eHarness.test.js`

**Interfaces:**
- Produces a sanitized episode package with input fixture version, entity IDs/versions, Events, Audit IDs, Artifact hashes, result classification and configuration digest.

- [ ] Freeze the three E2E fixtures before optimization.
- [ ] Add deterministic harness tests for exact control and evidence fields.
- [ ] Run E2E-1 Daily Loop, E2E-2 Persistent Work and E2E-3 Overnight with the same frozen configuration.
- [ ] Inject service restart, provider failure, stale file, duplicate callback, expired lease and denied action failures.
- [ ] Record failures and fixes without changing frozen success criteria.
- [ ] Run full regression, security boundary checks, backup/restore drill and `git diff --check`.
- [ ] Publish only observed technical results; do not claim user value or reliability rate without the later study.

**Exit gate:** All three loops work end to end with traceable state and bounded failure behavior; at least one real failure has a documented fix/regression closure.

---

## Phase-level stop conditions

| Phase | Stop and reassess when |
| --- | --- |
| 1 | Migration cannot preserve IDs/evidence, or two write paths remain active |
| 2 | UI requires bypassing Application API or exposes private reasoning |
| 3 | User edits can be overwritten or stop cannot halt writes |
| 4 | Feishu identity/approval cannot be strongly bound |
| 5 | Run effects are not idempotent across restart or lease expiry |
| 6 | Brief/review requires treating chat summaries as authoritative state |
| 7 | Tests need mutable success criteria or evidence cannot be reproduced |

## Recommended execution order now

Only Tasks 1–5 (Phase 1) should enter a detailed execution cycle after user approval. Before Task 6, write and approve the frontend-stack ADR and Phase 2 focused spec. Repeat the same focused-spec gate for Workspace, Feishu, Scheduler, Daily Loop, and E2E so later product decisions can refine those phases without invalidating the Persistent Core.
