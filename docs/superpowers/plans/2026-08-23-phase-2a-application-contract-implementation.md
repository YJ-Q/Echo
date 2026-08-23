# Margin Phase 2A Application Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1 Persistent Core 上实现 transport-neutral Application Gateway、冻结 DTO/Validator、稳定 Event Cursor、NeedsOwner 以及 CLI Contract 迁移，并用可重启的 Contract tests 证明只有一套权威状态。

**Architecture:** `createMarginApplicationContract()` 作为无状态 Gateway，把闭合 Command/Query/Event 请求映射到现有 Application Services 与唯一 Persistent Repository。SQLite aggregate tables 继续提供当前状态，`margin_events` 继续提供事实历史，新增 cursor 表只给现有事件分配稳定 sequence；所有 mutation 的状态、事件、审计和 cursor assignment 保持在同一事务边界。

**Tech Stack:** JavaScript ESM、Node.js 22 built-in test runner、sqlite/sqlite3、手写运行时 validator、JSDoc contract types。

## Global Constraints

- 设计依据固定为 `docs/architecture/adr/002-transport-neutral-application-contract.md` 与 `docs/superpowers/specs/2026-08-23-phase-2a-application-contract-design.md`，基线提交为 `4845064414fe27faf2e5b40df248f81cfc870e88`。
- One Core, Multiple Surfaces. Stable State, Replaceable Runtime.
- Persistent Core aggregate state 是 current-state Source of Truth；Event Log 只是 append-only factual history/integration stream；禁止新增 Activity 或 Surface shadow store，禁止改造成 Event Sourcing。
- 同一次成功 mutation 的 aggregate update/insert、Domain/Application Event 与 Audit 必须在同一个 SQLite transaction；event cursor 由同事务 trigger 分配。
- Gateway、DTO、Event 不导入或暴露 Pi Session 对象、SQLite row、snake_case、Chain-of-Thought、隐藏推理、prompt、凭据、stack 或大文件正文。
- Run control 继续要求 Phase 1 私有宿主 Authority；伪造 actor/capability/同名 JSON 字段不能绕过治理。Phase 2A 不给 Scheduler/system actor 无人执行权限。
- Mutation Command 的 `requestId` 必须与 Context `requestId` 一致；`idempotencyKey` 映射为底层业务重放键；同键同输入返回第一次结果且不重复副作用，同键不同输入/主体/scope 返回 `idempotency_conflict`。
- 修改既有 aggregate 必须携带 integer `expectedVersion`；不匹配返回 `version_conflict`，不得修改状态、追加 Event 或覆盖最新值。
- NeedsOwner 表示待用户输入/确认/批准/选择；Decision 表示已形成的长期决定。两者保持独立，Phase 2A resolve NeedsOwner 不自动创建 Decision。
- Event cursor 使用 SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` sequence；禁止从 timestamp/eventId 推导顺序；restart 和分页不得重复或遗漏。
- 不实现 HTTP Server、React/Web UI、飞书、Scheduler、Codex Worker、DeepSeek Harness、WebSocket/SSE、完整 Event Sourcing 或大型权限系统。
- 所有生产行为遵循 TDD：先运行新增测试并观察预期失败，再写最小实现，再运行 focused tests 和回归。

---

### Task 1: Add the additive Phase 2A schema and atomic repository primitives

**Files:**
- Create: `src/core/migrations/004-application-contract.js`
- Modify: `src/core/migrations/001-margin-core.js`
- Modify: `src/core/persistentWorkRepository.js`
- Test: `test/phase2aPersistence.test.js`

**Interfaces:**
- Consumes: `openMarginCoreStore()` migration transaction、`createPersistentWorkRepository(store)`、现有 `evidence()`/`replay()`。
- Produces: migration version 4；repository 的 `listRuns(input)`、`listArtifacts(input)`、`listDecisions(input)`、`listNeedsOwner(input)`、`getNeedsOwner(id)`、`createNeedsOwner(input, actor)`、`resolveNeedsOwner(input, actor)`、`latestCheckpointFor(input)`、`listEventRows(input)`；所有 mutation 返回 `{ data, auditId }`。

- [ ] **Step 1: Write migration and atomicity tests that fail before Migration 004 exists**

```js
test('migration 004 adds contract fields, NeedsOwner, and a stable event sequence', async () => {
  const f = await fixture();
  const names = (await f.core.store.db.all("SELECT name FROM pragma_table_info('margin_projects')")).map((row) => row.name);
  assert.ok(names.includes('priority'));
  assert.ok(names.includes('current_state'));
  assert.ok(await f.core.store.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='margin_needs_owner'"));
  assert.ok(await f.core.store.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='margin_event_cursors'"));
});

test('NeedsOwner create commits state event audit and cursor atomically', async () => {
  const result = await f.core.repository.createNeedsOwner(input, actor);
  assert.equal(result.data.status, 'open');
  assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_needs_owner WHERE id=?', result.data.id)).count, 1);
  assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events WHERE entity_id=?', result.data.id)).count, 1);
  assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_event_cursors c JOIN margin_events e ON e.id=c.event_id WHERE e.entity_id=?', result.data.id)).count, 1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="migration 004|NeedsOwner create" test/phase2aPersistence.test.js`

Expected: FAIL because Migration 004/table/repository methods do not exist.

- [ ] **Step 3: Add Migration 004 and register it**

```js
const sql = `
ALTER TABLE margin_projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE margin_projects ADD COLUMN current_state TEXT;
ALTER TABLE margin_artifacts ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE margin_artifacts ADD COLUMN preview_metadata TEXT NOT NULL DEFAULT '{}';
CREATE TABLE margin_needs_owner (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES margin_projects(id),
  run_id TEXT REFERENCES margin_runs(id),
  type TEXT NOT NULL CHECK (type IN ('decision','approval','input','conflict')),
  reason TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  consequence_summary TEXT,
  context_summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','cancelled')),
  resolution TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  source_session_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE margin_event_cursors (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE REFERENCES margin_events(id)
);
INSERT INTO margin_event_cursors(event_id)
  SELECT id FROM margin_events ORDER BY rowid;
CREATE TRIGGER margin_assign_event_cursor
AFTER INSERT ON margin_events
BEGIN
  INSERT INTO margin_event_cursors(event_id) VALUES (NEW.id);
END;
`;
```

Export `{ version: 4, name: 'margin-application-contract', sql, checksum }` and append it to `MARGIN_CORE_MIGRATIONS` after version 3.

- [ ] **Step 4: Implement repository reads and atomic NeedsOwner mutations**

Implement bounded SQL with parameterized filters and deterministic order. `createNeedsOwner()` validates Workstream/Run scope inside the transaction, inserts the row, then calls `evidence()` before commit. `resolveNeedsOwner()` performs replay before lookup, checks `expectedVersion`, updates only an open item, then appends evidence in the same transaction. Evidence payload must be a bounded JSON object containing operation-relevant fields such as `{ command, status, correlationId, surfaceKind }`, not prompt/tool input.

同时把受 Migration 004 影响的 positional INSERT 改为显式列名：Workstream create/update 写入 `priority/current_state/current_plan/next_action/autonomy_level/workspace_path` 的闭合字段；Artifact create 写入 `metadata/preview_metadata`。Workstream update 保留 Phase 1 状态机/open-Run 检查，并在同一条 optimistic transaction 中更新上述非状态字段。Aggregate 列表使用 `(updated_at,id)` keyset 条件和 URL-safe base64 JSON cursor，不使用 offset；保留现有无参 Service 调用的兼容默认值。

```js
resolveNeedsOwner: (input, actor) => store.transaction(async (tx) => {
  const prior = await replay(tx, 'needs_owner_resolve', input.requestId, 'margin_needs_owner', input, actor);
  if (prior) return prior;
  const current = await tx.get('SELECT * FROM margin_needs_owner WHERE id=?', input.needsOwnerId);
  if (!current) throw new CoreContractError('not_found', 'NeedsOwner not found');
  if (current.version !== input.expectedVersion) throw versionConflict(current.version);
  if (current.status !== 'open') throw new CoreContractError('invalid_transition', 'NeedsOwner is not open');
  // update + evidence() occur before this transaction returns
});
```

- [ ] **Step 5: Add replay/conflict/rollback and cursor paging tests**

Cover: same request input returns same NeedsOwner/audit; changed payload or subject returns `idempotency_conflict`; stale resolve returns `version_conflict` with unchanged row/event count; injected evidence failure rolls back the row; cursor rows are monotonic for events sharing one timestamp; reopening the DB preserves sequence.

- [ ] **Step 6: Run focused and existing persistence tests**

Run: `npm test -- test/phase2aPersistence.test.js test/persistentCoreMigrations.test.js test/persistentWorkServices.test.js`

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/migrations/004-application-contract.js src/core/migrations/001-margin-core.js src/core/persistentWorkRepository.js test/phase2aPersistence.test.js
git commit -m "feat: add phase 2a persistent contract schema"
```

---

### Task 2: Implement closed validators and DTO mappers

**Files:**
- Create: `src/contracts/contractTypes.js`
- Create: `src/contracts/validation.js`
- Create: `src/contracts/dtoMappers.js`
- Test: `test/applicationContractValidation.test.js`

**Interfaces:**
- Consumes: repository/domain rows from Task 1 and frozen spec DTO shapes.
- Produces: `CONTRACT_VERSION`, command/query/event enums, `validateInvocationContext()`, `validateCommand()`, `validateQuery()`, `validateEventQuery()`, `validateContractOutput()`, `toWorkstreamDTO()`, `toRunDTO()`, `toArtifactDTO()`, `toDecisionDTO()`, `toNeedsOwnerDTO()`, `toCheckpointDTO()`, `deepFreeze()`.

- [ ] **Step 1: Write validator and mapper tests first**

```js
test('InvocationContext is closed and requires matching stable identity fields', () => {
  assert.throws(() => validateInvocationContext({ ...context, extra: true }), hasCode('invalid_request'));
  assert.throws(() => validateInvocationContext({ ...context, actor: { type: 'user' } }), hasCode('invalid_request'));
});

test('RunDTO separates Margin id from runtimeReference and contains no snake_case', () => {
  const dto = toRunDTO({ id: 'run-1', runtime_kind: 'pi', runtime_session_id: 'pi-1', workstream_id: 'w-1', status: 'queued', version: 1 });
  assert.equal(dto.id, 'run-1');
  assert.deepEqual(dto.runtimeReference, { kind: 'pi', id: 'pi-1' });
  assert.equal(JSON.stringify(dto).includes('runtime_session_id'), false);
  assert.ok(Object.isFrozen(dto));
});
```

Also test closed command payloads, command/context request mismatch, required idempotencyKey, required expectedVersion, bounded arrays/metadata, non-integer cursor/limit, forbidden output keys, and artifact DTO excluding body/Buffer/runtime object.

- [ ] **Step 2: Run validator tests and verify RED**

Run: `npm test -- test/applicationContractValidation.test.js`

Expected: FAIL because `src/contracts/*` exports do not exist.

- [ ] **Step 3: Implement constants and composable validators**

Use hand-written helpers (`assertClosedObject`, `requireString`, `optionalString`, `requireInteger`, `boundedStringArray`, `boundedJsonObject`) that either return normalized data or throw `ContractValidationError` with `code='invalid_request'`. Command validators are a closed dispatch map; mutation shape is `{ type, requestId, idempotencyKey, expectedVersion?, payload }`; Query shape is `{ type, requestId, payload }`.

```js
export function validateCommand(command, context) {
  const base = assertClosedObject(command, ['type','requestId','idempotencyKey','expectedVersion','payload']);
  if (base.requestId !== context.requestId) throw invalid('requestId must match context');
  return COMMAND_VALIDATORS[requireEnum(base.type, COMMAND_TYPES)](base);
}
```

- [ ] **Step 4: Implement explicit row-to-DTO mappers and output scanning**

Each mapper constructs a new camelCase plain object and deep-freezes it. JSON columns parse through bounded parsers; malformed persisted JSON produces stable `storage_failure`, not partial DTO. `runtime_session_id` maps only to `{ kind: runtime_kind, id }`. Artifact source uses `runtimeReference`, never `sourceSessionId`. Decision status maps `confirmed` to `active`; no NeedsOwner field is merged into Decision.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- test/applicationContractValidation.test.js`

Expected: all tests pass with pristine output.

- [ ] **Step 6: Commit**

```bash
git add src/contracts/contractTypes.js src/contracts/validation.js src/contracts/dtoMappers.js test/applicationContractValidation.test.js
git commit -m "feat: define phase 2a contract validation and dtos"
```

---

### Task 3: Implement NeedsOwner service and the transport-neutral Gateway

**Files:**
- Create: `src/application/needsOwnerService.js`
- Create: `src/application/marginApplicationContract.js`
- Modify: `src/application/workstreamService.js`
- Modify: `src/application/runService.js`
- Modify: `src/application/artifactService.js`
- Modify: `src/application/checkpointService.js`
- Modify: `src/core/createMarginCore.js`
- Test: `test/applicationContractCommands.test.js`
- Test: `test/applicationContractQueries.test.js`

**Interfaces:**
- Consumes: Task 1 repository APIs; Task 2 validators/mappers; existing private `bindHostActor()` authority.
- Produces: `createMarginApplicationContract({ services, repository, runtimeControl, authorizeContext, toActor })` returning only `{ execute, query, events }`; Core exposes `createApplicationContract({ runtimeControl })` and `bindHostContext(context)` while retaining existing Services for compatibility tests.

- [ ] **Step 1: Write Gateway command/query tests before implementation**

```js
test('same idempotencyKey replays run.create without a second Run or event', async () => {
  const first = await gateway.execute(command, hostContext);
  const retry = await gateway.execute({ ...command, requestId: 'call-2' }, { ...hostContext, requestId: 'call-2' });
  assert.equal(retry.data.id, first.data.id);
  assert.equal((await db.get('SELECT COUNT(*) count FROM margin_runs')).count, 1);
  assert.equal((await eventCount(first.data.id)), 1);
});

test('stale workstream update returns version_conflict without state or event changes', async () => {
  const before = await gateway.query(getWorkstream, readContext);
  const conflict = await gateway.execute({ ...update, expectedVersion: before.data.version - 1 }, writeContext);
  assert.equal(conflict.error.code, 'version_conflict');
  assert.deepEqual((await gateway.query(getWorkstream, readContext)).data, before.data);
  assert.equal(await eventCount(before.data.id), beforeEventCount);
});
```

Cover all command routes, stable response envelopes, unknown types, missing capability rejected before repository reads, forged user/hostAuthority rejected for Run control, scheduler-shaped start rejected, Decision read distinct from NeedsOwner, and restart queries returning the same DTO IDs/versions.

- [ ] **Step 2: Run Gateway tests and verify RED**

Run: `npm test -- test/applicationContractCommands.test.js test/applicationContractQueries.test.js`

Expected: FAIL because Gateway/NeedsOwner service/Core factory do not exist.

- [ ] **Step 3: Implement NeedsOwner service and missing bounded service reads**

`createNeedsOwnerService({ repository })` validates create/resolve input, delegates mutation to Task 1 atomic repository methods, and exposes list/get. Resolve requires `expectedVersion`; it records resolution only and never inserts/updates `margin_decisions`.

- [ ] **Step 4: Implement Gateway authorization, routing, and stable envelopes**

Use closed dispatch maps. Execution order is validate context → validate request → check capability/host Authority → map input (`idempotencyKey` becomes service `requestId`, Gateway request/correlation/surface enter actor evidence metadata) → call service → map/validate/freeze DTO → return envelope. Map known `CoreContractError` codes without hiding them; unexpected persistence exceptions become retryable `storage_failure` and never expose message/stack.

```js
return Object.freeze({
  execute: (command, context) => dispatchMutation(validateCommand(command, validateInvocationContext(context)), context),
  query: (request, context) => dispatchQuery(validateQuery(request, validateInvocationContext(context)), context),
  events: (request, context) => dispatchEvents(validateEventQuery(request, validateInvocationContext(context)), context)
});
```

- [ ] **Step 5: Bind host Authority without making it serializable**

Keep a private Symbol in `createMarginCore()`. `bindHostContext()` validates a host-user context and returns a new context bearing that Symbol. `toActor()` only calls the existing `bindHostActor()` when the Symbol identity is present; JSON cloning, `hostAuthority: true`, actor type, or string capabilities alone cannot produce a Run-authorized actor.

- [ ] **Step 6: Run command/query tests and Phase 1 control regressions**

Run: `npm test -- test/applicationContractCommands.test.js test/applicationContractQueries.test.js test/persistentWorkServices.test.js test/runControl.test.js`

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/application/needsOwnerService.js src/application/marginApplicationContract.js src/application/workstreamService.js src/application/runService.js src/application/artifactService.js src/application/checkpointService.js src/core/createMarginCore.js test/applicationContractCommands.test.js test/applicationContractQueries.test.js
git commit -m "feat: add transport neutral application gateway"
```

---

### Task 4: Implement safe Event Envelope, stable cursor reads, and Activity projection

**Files:**
- Create: `src/contracts/eventEnvelope.js`
- Modify: `src/application/marginApplicationContract.js`
- Modify: `src/core/persistentWorkRepository.js`
- Test: `test/applicationContractEvents.test.js`

**Interfaces:**
- Consumes: Task 1 `listEventRows()` sequence rows; Task 2 output validation; Task 3 `events()`/`activity.list` dispatch slots.
- Produces: `toEventEnvelope(row)`、`toActivityDTO(envelope)`；`events({type:'event.list', ...}, context)` and `query({type:'activity.list', ...}, context)`.

- [ ] **Step 1: Write event ordering, mapping, privacy, and restart tests**

```js
test('event cursor is monotonic, restart-stable, and paginates without gaps or duplicates', async () => {
  const first = await gateway.events(eventList(0, 2), eventContext('e-1'));
  await restartCore();
  const second = await gateway.events(eventList(first.data.nextCursor, 2), eventContext('e-2'));
  assert.deepEqual([...first.data.items, ...second.data.items].map((e) => e.cursor), [1, 2, 3, 4]);
  assert.equal(new Set([...first.data.items, ...second.data.items].map((e) => e.eventId)).size, 4);
});

test('event and activity outputs exclude runtime internals and hidden reasoning', async () => {
  const serialized = JSON.stringify(await gateway.events(eventList(0, 50), context));
  for (const forbidden of ['chainOfThought','prompt','runtime_session_id','apiKey','sessionObject']) assert.equal(serialized.includes(forbidden), false);
});
```

Also assert state mutation and mapped event have matching aggregate ID/version, replay creates no event, conflict creates no event, empty page preserves supplied cursor, same timestamp remains ordered, and Activity has no backing table.

- [ ] **Step 2: Run event tests and verify RED**

Run: `npm test -- test/applicationContractEvents.test.js`

Expected: FAIL because Event Envelope mapping and Gateway event dispatch are absent.

- [ ] **Step 3: Implement a whitelist Event mapper**

Map only known `(entity_type,event_type,payload.command/status)` combinations to the frozen types: Workstream created/updated, Run created/started/progressed/paused/resumed/stopped/completed/failed, Artifact created, Checkpoint created, Decision created/superseded/revoked, NeedsOwner created/resolved/cancelled. Unknown internal events are skipped with a structured diagnostic count; raw payload is never passed through. `actor.subjectId` may be null when old evidence cannot safely correlate it.

- [ ] **Step 4: Implement sequence paging and Activity derivation**

`listEventRows()` joins `margin_event_cursors` to `margin_events`, filters by `sequence > ?`, orders ascending, and fetches `limit + 1` to compute `hasMore`. `nextCursor` is last emitted/scanned sequence; when no rows exist it equals `afterCursor`. Activity maps from the already-sanitized Event Envelope with deterministic templates and no DB table/cache.

- [ ] **Step 5: Run event and mutation consistency tests**

Run: `npm test -- test/applicationContractEvents.test.js test/applicationContractCommands.test.js test/phase2aPersistence.test.js`

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/contracts/eventEnvelope.js src/application/marginApplicationContract.js src/core/persistentWorkRepository.js test/applicationContractEvents.test.js
git commit -m "feat: expose stable application event cursor"
```

---

### Task 5: Migrate the terminal CLI to the Application Contract

**Files:**
- Modify: `src/pilot/terminalPilotController.js`
- Modify: `test/terminalPilotController.test.js`
- Modify: `test/terminalPersistentRestart.test.js`
- Test: `test/terminalApplicationContract.test.js`

**Interfaces:**
- Consumes: Core `createApplicationContract({ runtimeControl })` and `bindHostContext()` from Task 3. Natural-language Pi tools continue using governed `core.v1Tools`; CLI Workstream/Run/checkpoint reads and controls use only Gateway methods.
- Produces: Terminal controller as the first Surface Adapter over `execute/query`; no direct calls to `core.workstreams`, `core.runs`, `core.checkpoints`, repository, store, or SQLite for migrated operations.

- [ ] **Step 1: Write a CLI contract-spy test before changing the controller**

```js
test('terminal lifecycle uses only Application Contract for persistent Workstream Run and checkpoint operations', async () => {
  const core = contractOnlyCoreFixture();
  const controller = createTerminalPilotController(dependencies(core));
  await controller.start();
  await controller.handle('/pause');
  await controller.handle('/resume');
  await controller.handle('/checkpoint');
  await controller.handle('/stop');
  assert.deepEqual(core.calls.map((call) => call.type), [
    'workstream.get','workstream.list','run.list','run.create','run.start',
    'run.pause','run.resume','checkpoint.create','run.stop'
  ]);
});
```

The fixture intentionally omits `core.workstreams/runs/checkpoints`; old direct calls must fail the RED run.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `npm test -- test/terminalApplicationContract.test.js`

Expected: FAIL because the controller still calls Phase 1 Services directly.

- [ ] **Step 3: Instantiate the Gateway after runtimeControl is available**

The controller builds CLI Context per call with stable actor/surface/correlation/capabilities, then obtains trusted host binding through `core.bindHostContext()`. Generate a fresh Gateway `requestId` per call and a stable business `idempotencyKey` for a single parsed command; do not reuse keys across distinct user commands.

- [ ] **Step 4: Replace persistent direct calls with execute/query**

Map controller fields to camelCase DTOs. Startup discovers/creates Workstream and open Run through Gateway, reconciles a persisted running Run before opening a new Pi Session, then starts/resumes through the same Gateway. `/status`, `/pause`, `/resume`, `/stop`, `/checkpoint`, close, and restart all use Contract. Pi tool invocation remains `core.v1Tools` because it is the governed Runtime tool boundary, not a Surface state API.

- [ ] **Step 5: Run terminal focused tests**

Run: `npm test -- test/terminalApplicationContract.test.js test/terminalPilotController.test.js test/terminalPersistentRestart.test.js test/terminalPilotCli.test.js`

Expected: all selected tests pass; restart still halts the persisted runtime reference before opening a new Session.

- [ ] **Step 6: Commit**

```bash
git add src/pilot/terminalPilotController.js test/terminalPilotController.test.js test/terminalPersistentRestart.test.js test/terminalApplicationContract.test.js
git commit -m "refactor: route terminal persistence through contract"
```

---

### Task 6: Prove restart consistency, update architecture evidence, and run Phase 2A acceptance

**Files:**
- Create: `test/phase2aContractE2E.test.js`
- Create: `docs/validation/phase_2a_acceptance_report.md`
- Modify: `docs/architecture/adr/002-transport-neutral-application-contract.md`
- Modify: `docs/superpowers/specs/2026-08-23-phase-2a-application-contract-design.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed Gateway/DTO/Event/CLI behavior from Tasks 1–5.
- Produces: executable acceptance evidence and final Phase 2A documentation; no Phase 2B code.

- [ ] **Step 1: Write the real restart E2E test**

```js
test('one canonical Core survives command event cursor and CLI restart', async () => {
  // create Workstream -> create/start Run -> create Artifact/Checkpoint/NeedsOwner
  // pause -> close Core -> reopen same SQLite -> query same IDs/versions
  // resume -> resolve NeedsOwner -> stop -> read ordered events/activity
  assert.equal(reopenedWorkstream.id, createdWorkstream.id);
  assert.equal(reopenedRun.runtimeReference.id, startedRun.runtimeReference.id);
  assert.equal(await countTablesNamedLikeActivity(db), 0);
  assert.equal(new Set(allEventCursors).size, allEventCursors.length);
});
```

Use the real SQLite fixture and fake Runtime Adapter only for activate/halt; do not mock Services/Repository/Gateway.

- [ ] **Step 2: Run the E2E and verify the complete cross-task path**

Run: `npm test -- test/phase2aContractE2E.test.js`

Expected on the assembled Tasks 1–5 implementation: PASS. If it fails, the observed assertion becomes the mandatory RED evidence for Step 3.

- [ ] **Step 3: Fix only integration defects with a failing regression test first**

For each defect, add a focused assertion to `phase2aContractE2E.test.js` or the owning Task test, observe it fail for the defect, then make the smallest production change. Do not add new commands, DTO fields, transports, schedulers, workers, or UI.

- [ ] **Step 4: Update ADR/spec status and write the acceptance report**

Mark ADR status as implemented by the final commit, retain Phase 0/1 history, and document: final Contract structure; Migration 004; CLI migration; state/event transaction boundary; NeedsOwner vs Decision; idempotency/concurrency/cursor evidence; deviations; known risks; YAPI Live Pi gap; explicit Phase 2B recommendation without starting it.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm test
npm run validate:stage1
npm run audit:pi
git diff --check
```

Expected: at least the 286-test baseline plus all Phase 2A tests pass; Stage 1 fixture 10/10 passes; Pi audit passes; diff check is clean. Record exact counts/output in the acceptance report without inventing live-model results.

- [ ] **Step 6: Commit**

```bash
git add test/phase2aContractE2E.test.js docs/validation/phase_2a_acceptance_report.md docs/architecture/adr/002-transport-neutral-application-contract.md docs/superpowers/specs/2026-08-23-phase-2a-application-contract-design.md CHANGELOG.md
git commit -m "docs: finalize phase 2a contract acceptance"
```

- [ ] **Step 7: Stop before Phase 2B**

Report the plan completion matrix, final architecture, schema increment, CLI migration, consistency guarantees, test evidence, known risks, complete Git hash, and a Phase 2B recommendation. Do not create HTTP/Web/Feishu/Scheduler/Worker code.
