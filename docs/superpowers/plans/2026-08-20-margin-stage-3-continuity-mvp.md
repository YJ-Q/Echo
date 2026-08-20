# Margin Stage 3 Continuity MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated Pi-to-Margin adapter and source-addressable context planner that demonstrate one minimal Session A to Session B continuity loop without changing production chat.

**Architecture:** A thin Pi extension translates four registered tools into existing Margin Core handlers using host-owned permissions and provenance. A Pi-independent planner reads a bounded continuity snapshot, while an isolated harness proves that a second Session can receive state created from the first Session. Deterministic tests are the primary gate; a YAPI-backed live smoke is optional evidence.

**Tech Stack:** JavaScript ESM, Node.js 22.23.1, `@earendil-works/pi-coding-agent@0.84.2`, TypeBox, SQLite, `node:test`.

## Global Constraints

- Keep Pi pinned to `@earendil-works/pi-coding-agent@0.84.2` and Node to `22.23.1`.
- Do not import Pi from the context planner or Margin Core storage/tool modules.
- Do not modify `server.js`, chat routes, or legacy `src/storage/memoryStore.js`.
- Keep `MARGIN_CORE_ENABLED=false` as the default.
- Host callbacks, not model text, supply permissions, provenance, and trusted confirmations.
- Persist no credentials, raw provider errors, full prompts, or full sensitive memory contents in continuity traces.
- Do not claim task success, recall quality, or user validation from Stage 3 smoke evidence.

---

### Task 1: Read-only continuity snapshot and context planner

**Files:**
- Modify: `src/core/marginCoreStore.js`
- Create: `src/continuity/contextPlanner.js`
- Create: `test/contextPlanner.test.js`

**Interfaces:**
- Produces: `store.getContinuitySnapshot({ projectId, query, asOf, memoryTopK, recentDialogue })`.
- Produces: `planContinuityContext(snapshot, { maxItems }) -> { projectId, selected, excluded, digest }`.
- `selected` entries use `{ sourceType, entityType, entityId, version, sourceSessionId, reason, content }`.

- [ ] **Step 1: Write failing planner and snapshot tests**

```js
const snapshot = await store.getContinuitySnapshot({
  projectId: project.id,
  query: 'continue resume review',
  asOf: '2026-08-20T00:00:00.000Z',
  memoryTopK: 3,
  recentDialogue: [{ id: 'turn-1', content: 'Continue the review.' }]
});
const plan = planContinuityContext(snapshot, { maxItems: 5 });
assert.deepEqual(plan.selected.map((item) => item.sourceType), [
  'margin_project', 'margin_task', 'margin_decision', 'margin_memory', 'pi_recent_dialogue'
]);
assert.match(plan.digest, /^[a-f0-9]{64}$/u);
```

Cover project-not-found, cross-project task/memory exclusion, only confirmed/current decisions and memories, one active task, deterministic ordering, bounded selection, explicit exclusion reasons, and no database mutation.

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/contextPlanner.test.js
```

Expected: module-not-found or missing `getContinuitySnapshot`.

- [ ] **Step 3: Implement the snapshot query**

Add parameterized reads to `marginCoreStore.js`. The method returns this exact shape:

```js
{
  project,
  activeTask,
  decisions,
  memories,
  recentDialogue
}
```

Filter all entities by `projectId`; include only non-deleted active project/task rows, `confirmed` decisions that are not expired at `asOf`, and `confirmed` memories that are non-deleted, non-superseded, valid, and non-expired. Rank memories with the existing deterministic Stage 2 lexical/confidence/recency rule and never update recalled rows.

- [ ] **Step 4: Implement deterministic planning**

```js
export function planContinuityContext(snapshot, { maxItems = 8 } = {}) {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) {
    throw new ContinuityPlanError('invalid_context_budget');
  }
  const candidates = buildOrderedCandidates(snapshot);
  const selected = candidates.slice(0, maxItems);
  const excluded = candidates.slice(maxItems).map(({ entityId, sourceType }) => ({
    entityId, sourceType, reason: 'item_budget_exceeded'
  }));
  return { projectId: snapshot.project.id, selected, excluded, digest: digestInput({ selected, excluded }) };
}
```

Project, active task, decisions, memories, and dialogue must remain distinguishable source types. Content is used in-memory only; the digest is the trace-safe representation.

- [ ] **Step 5: Run tests and commit**

Run the focused tests, then:

```powershell
git add src/core/marginCoreStore.js src/continuity/contextPlanner.js test/contextPlanner.test.js
git commit -m "feat: add bounded continuity context planner"
```

### Task 2: Thin Pi extension adapter

**Files:**
- Create: `src/runtime/pi/marginPiAdapter.js`
- Create: `test/marginPiAdapter.test.js`

**Interfaces:**
- Consumes: `createMarginCore(...).tools` with the four snake-case handler names.
- Produces: `createMarginPiExtension({ tools, getInvocationContext }) -> async extension(pi)`.
- Produces: `toPiToolResult(coreResult) -> { content, details, isError }`.

- [ ] **Step 1: Write failing adapter tests**

```js
const registered = [];
await createMarginPiExtension({
  tools: fakeHandlers,
  getInvocationContext: async ({ toolName, toolCallId }) => ({
    actorType: 'agent',
    permissions: { memoryRead: true },
    sourceSessionId: 'session-a',
    sourceEventId: toolCallId,
    confirmations: []
  })
})({ registerTool: (tool) => registered.push(tool) });
assert.deepEqual(registered.map((tool) => tool.name).sort(), [
  'action_update', 'memory_propose', 'memory_search', 'state_update'
]);
```

Assert exact registration, host context overriding any model-supplied provenance/permissions, stable success/error conversion, bounded JSON output, missing host context default-deny, and no credential/raw exception leakage.

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/marginPiAdapter.test.js
```

Expected: module-not-found.

- [ ] **Step 3: Implement four explicit TypeBox contracts**

Use `defineTool` and `Type.Object` from the pinned Pi package. Do not accept `permissions`, `actorType`, `sourceSessionId`, `sourceEventId`, or `confirmations` in model-facing schemas. Each tool executor must call the matching Core handler as:

```js
const trusted = await getInvocationContext({ toolName, toolCallId });
const input = {
  ...params,
  sourceSessionId: trusted?.sourceSessionId,
  sourceEventId: trusted?.sourceEventId ?? toolCallId
};
const context = trusted ? {
  actorType: trusted.actorType,
  permissions: trusted.permissions,
  confirmations: trusted.confirmations ?? []
} : { actorType: 'agent', permissions: {}, confirmations: [] };
return toPiToolResult(await handler(input, context));
```

- [ ] **Step 4: Implement bounded result conversion**

```js
export function toPiToolResult(result) {
  const payload = result.ok
    ? { ok: true, data: result.data, auditId: result.auditId }
    : { ok: false, error: result.error, auditId: result.auditId };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    details: { ok: result.ok, auditId: result.auditId, code: result.ok ? 'allowed' : result.error.code },
    isError: !result.ok
  };
}
```

Reject serialized output above a fixed 32 KiB limit with stable `adapter_output_too_large`; do not copy caught exception messages.

- [ ] **Step 5: Run tests and commit**

```powershell
git add src/runtime/pi/marginPiAdapter.js test/marginPiAdapter.test.js
git commit -m "feat: add thin Margin Pi tool adapter"
```

### Task 3: Deterministic cross-Session continuity harness

**Files:**
- Create: `src/continuity/continuityHarness.js`
- Create: `test/continuityHarness.test.js`

**Interfaces:**
- Consumes: `store`, adapter-compatible `tools`, `planContinuityContext`.
- Produces: `runContinuityHarness({ store, tools, sessionFactory, projectSeed, continuationQuery, clock, idFactory })`.
- A `sessionFactory` returns `{ id, invokeTool(name,input), receiveContext(plan), close() }`.

- [ ] **Step 1: Write a failing Session A to Session B test**

```js
const result = await runContinuityHarness({
  store,
  tools,
  sessionFactory: createFakeSessionFactory(),
  projectSeed,
  continuationQuery: 'continue the resume review',
  clock,
  idFactory
});
assert.notEqual(result.sessionAId, result.sessionBId);
assert.equal(result.context.selected[0].sourceType, 'margin_project');
assert.equal(result.context.selected[1].sourceType, 'margin_task');
assert.equal(result.trace.toolResults.every((entry) => entry.auditId), true);
```

Cover distinct Session IDs, state written from Session A provenance, Session B context receipt, empty memory behavior, denied permission behavior, trace digest stability, and cleanup after failure.

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/continuityHarness.test.js
```

Expected: module-not-found.

- [ ] **Step 3: Implement the minimal orchestration**

The harness must:

1. create Session A;
2. create a project and active task through trusted tool calls or supplied seed setup;
3. close Session A;
4. create distinct Session B;
5. call `getContinuitySnapshot` and `planContinuityContext`;
6. deliver the plan to Session B;
7. return an in-memory trace containing only opaque IDs, versions, stable codes, audit IDs, and digests;
8. close both Sessions in `finally`.

Do not write trace files in this task.

- [ ] **Step 4: Run tests and commit**

```powershell
git add src/continuity/continuityHarness.js test/continuityHarness.test.js
git commit -m "feat: add deterministic cross-session harness"
```

### Task 4: Optional live Pi continuity smoke

**Files:**
- Create: `scripts/run-pi-continuity-smoke.js`
- Create: `src/runtime/pi/piContinuitySmoke.js`
- Create: `test/piContinuitySmoke.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `runPiContinuitySmoke({ repositoryRoot, dataDir, provider, modelId, customProvider })`.
- Adds script: `spike:pi-continuity` using the pinned repository Node executable.

- [ ] **Step 1: Write failing policy and report tests**

Assert that the smoke registers only the four Margin tools, disables all Pi built-ins and external resource discovery, creates distinct Session A/B IDs, delivers a planner digest to Session B, classifies credential/provider/adapter/continuity failures with stable codes, and writes no full prompts or credentials to its report.

```js
assert.deepEqual(buildContinuityToolPolicy(), {
  noTools: 'builtin',
  tools: ['memory_search', 'memory_propose', 'state_update', 'action_update']
});
```

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/piContinuitySmoke.test.js
```

Expected: module-not-found.

- [ ] **Step 3: Implement isolated Pi runtime composition**

Reuse the Stage 0 `SessionManager`, `SettingsManager`, `createAgentSessionServices`, `createAgentSessionFromServices`, provider registration pattern, safe path checks, and atomic JSON evidence writing. Use a temporary or explicitly provided Margin Core database under `data/pi-continuity-smoke`; never open the production database by default.

The report shape is:

```js
{
  ok,
  runId,
  createdAt,
  baseline,
  observed: { provider, modelId, sessionAId, sessionBId, enabledTools },
  checks: { toolsRegistered, sessionBoundary, contextDelivered, provenancePresent, safetyPolicy },
  trace: { projectId, taskId, contextDigest, auditIds, resultCodes }
}
```

- [ ] **Step 4: Add CLI environment wiring**

Read only `MARGIN_PI_PROVIDER`, `MARGIN_PI_MODEL`, `MARGIN_PI_BASE_URL`, `MARGIN_PI_API`, `MARGIN_PI_API_KEY_ENV`, and the referenced key environment variable. Default YAPI compatibility exactly as the Stage 0 runner does. Print the sanitized report and set a nonzero exit code for a blocked or failed smoke.

- [ ] **Step 5: Run tests and commit**

```powershell
git add scripts/run-pi-continuity-smoke.js src/runtime/pi/piContinuitySmoke.js test/piContinuitySmoke.test.js package.json
git commit -m "feat: add optional Pi continuity smoke"
```

Do not run the live provider command as part of the deterministic test gate. Run it only when the environment credential is available and record the result as integration evidence, not product performance.

### Task 5: Default-off closure and MVP audit

**Files:**
- Modify: `src/core/createMarginCore.js`
- Modify: `CHANGELOG.md`
- Create: `docs/audit/stage_3_continuity_mvp_report.md`
- Create: `test/stage3Documentation.test.js`

**Interfaces:**
- `createMarginCore({ enabled:true, ... })` additionally exposes `planContext(input, options)` without importing Pi.
- Production server remains unaware of this facade.

- [ ] **Step 1: Write failing closure tests**

Assert:

- disabled mode performs no I/O;
- enabled Core still exposes exactly four tool handlers plus a separate `planContext` method;
- no Pi import exists under `src/core` or `src/continuity/contextPlanner.js`;
- `server.js`, chat routes, `memoryStore.js`, and Stage 1 fixture hashes are unchanged from the Stage 2 boundary;
- the audit report lists all exclusions and contains no measured percentage claims.

- [ ] **Step 2: Run focused closure tests and observe RED**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/stage3Documentation.test.js test/marginCoreComposition.test.js
```

- [ ] **Step 3: Compose the planner and write the audit report**

Document implemented adapter, planner, harness, deterministic key-path evidence, optional live smoke result or explicit not-run status, and these exclusions: production chat activation, legacy migration, 50-task evaluation, A/B/C comparison, recall metrics, and user research.

- [ ] **Step 4: Run all verification gates**

```powershell
$testFiles = Get-ChildItem -LiteralPath test -Filter *.test.js -File | Sort-Object Name | Select-Object -ExpandProperty FullName
& .\.runtime\node-v22.23.1-win-x64\node.exe --test $testFiles
.\.runtime\node-v22.23.1-win-x64\node.exe scripts\validate-stage1-fixtures.js
.\.runtime\node-v22.23.1-win-x64\node.exe scripts\audit-pi-baseline.js
git diff --check
git status --short
```

Expected: all tests pass, Stage 1 returns `"ok":true`, Pi audit returns `"ok":true`, diff check is empty, and status contains only planned Stage 3 files before commit.

- [ ] **Step 5: Scan the evidence boundary**

Search Stage 3 source, tests, and reports for API-key patterns, provider exception text, raw SQL leakage, real personal data, percentage claims, and unintended imports from production chat. Remove any unsafe evidence rather than redacting after commit.

- [ ] **Step 6: Commit**

```powershell
git add src/core/createMarginCore.js CHANGELOG.md docs/audit/stage_3_continuity_mvp_report.md test/stage3Documentation.test.js
git commit -m "docs: close Margin Stage 3 continuity MVP"
```

## Completion gate

- Pi registers exactly four Margin tools through a thin adapter.
- Host-owned context controls permissions, provenance, and confirmations.
- The planner is deterministic, bounded, read-only, and source-addressable.
- A deterministic Session A to Session B harness passes.
- Permission denial, confirmation gating, and empty recall remain covered.
- Optional live smoke is runnable without making it a mandatory product-quality claim.
- Production chat, legacy storage, and Stage 1 fixtures remain unchanged.
- Full regression, Stage 1 validation, Pi audit, and independent review have no unresolved Critical or Important findings.
