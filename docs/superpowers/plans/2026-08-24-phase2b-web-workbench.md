# Margin V1 Phase 2B Web Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a daily-usable Web Workbench that controls and displays the accepted Persistent Core through a thin HTTP Adapter and the frozen Application Gateway.

**Architecture:** A new composition root opens the existing `margin-core.sqlite`, creates one Gateway and Pi Runtime Coordinator, and hosts an isolated Express Adapter plus React/Vite assets. Browser code owns only view state; every domain mutation/query/event passes through the Gateway or the application-level Interaction Service.

**Tech Stack:** Node.js 22.23.1, Express 4, SQLite, Pi Agent 0.84.2, React, React DOM, Vite, JavaScript/JSX, CSS, Node test runner, JSDOM.

## Global Constraints

- The accepted baseline is `8232fa484743dc65ebd844e1762845ba0bb6e07e` plus the frozen Phase 2B specification commit `82394b93b3a5689320ccadea2521d0f4e9b69649`.
- `data/terminal-pilot/margin-core.sqlite` is the only V1 current-state Source of Truth for Web and Terminal.
- The frozen Application Gateway remains exactly `execute`, `query`, and `events`.
- The HTTP Adapter must not import repositories, SQLite, Pi, `src/app.js`, legacy routes, or `src/storage/memoryStore.js`.
- The browser must not send or receive trusted actor, capability, host authority, database path, Pi session object, SQL, stack, prompt, hidden reasoning, or Chain-of-Thought data.
- Workstream and Run ids belong to Margin; Pi ids appear only in `runtimeReference`.
- React + Vite uses plain JavaScript/JSX; tests use Node test runner + JSDOM; do not add Vitest, Playwright, Electron, a UI framework, a state manager, SSE, or WebSocket.
- `npm run build` builds Web assets only; `npm start` serves an already-built production Workbench; `npm run dev` hosts Vite middleware plus HTTP; `npm run pilot:terminal` remains explicit.
- Live Pi uses the Process-level non-empty `YAPI_API_KEY`, an isolated temporary database, and sanitized evidence only.
- Do not implement Feishu, Scheduler, overnight work, Codex Worker, DeepSeek Harness, Temporal Council, multi-Agent UI, mobile app, arbitrary filesystem reads, or persistent Conversation history.
- Every behavior change follows RED → GREEN → refactor, and every task ends with focused tests and a commit.

---

### Task 1: Thin HTTP Adapter and trusted Web Gateway

**Files:**
- Create: `src/http/webCapabilities.js`
- Create: `src/http/webGateway.js`
- Create: `src/http/httpErrors.js`
- Create: `src/http/createWebHttpAdapter.js`
- Test: `test/webGateway.test.js`
- Test: `test/webHttpAdapter.test.js`

**Interfaces:**
- Consumes: `core.createApplicationContract()`, `core.bindHostContext()`, Contract request envelopes.
- Produces: `createWebGateway({ core, runtimeControl, instanceId, idFactory }) → { execute, query, events, internalQuery, internalEvents }` and `createWebHttpAdapter({ webGateway, interactionService, staticDir, viteMiddleware }) → Express app`.

- [ ] **Step 1: Write failing Web Gateway tests**

Assert that a browser command such as:

```js
await webGateway.execute({
  type: 'workstream.create', requestId: 'request-1', idempotencyKey: 'command-1',
  payload: { title: 'Research', goal: 'Finish review', scenario: 'learning_research' }
});
```

reaches the fake Gateway with `surface.kind === 'web'`, fixed
`actor.subjectId === 'local-web-user'`, server-derived
`['workstream:write']`, and a host-bound context. Assert caller-supplied
`actor`, `capabilities`, `databasePath`, and `hostAuthority` are rejected before
dispatch. Assert all frozen command/query/event types have one closed capability
mapping.

- [ ] **Step 2: Verify RED**

Run:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webGateway.test.js
```

Expected: FAIL because `src/http/webGateway.js` does not exist.

- [ ] **Step 3: Implement the trusted wrapper**

`webCapabilities.js` exports frozen maps for every type in
`COMMAND_TYPES`, `QUERY_TYPES`, and `EVENT_QUERY_TYPES`. `webGateway.js`
validates the raw envelope is a plain object without trusted transport fields,
derives one capability, constructs a server-owned context, host-binds mutations,
and delegates unchanged envelopes to the frozen Gateway. Internal query/event
helpers generate request ids and use the same trusted path.

- [ ] **Step 4: Write failing HTTP mapping tests**

Use a fake Web Gateway and Supertest-free native `fetch` against an ephemeral
`http.createServer(app)`. Cover:

```text
POST /api/commands → webGateway.execute
POST /api/queries  → webGateway.query
GET /api/events    → webGateway.events({type:'event.list', ...})
```

Assert 64 KiB JSON bounds, JSON content type, contract-version propagation, and
status mapping for `invalid_request`, `permission_denied`, `not_found`,
`version_conflict`, `invalid_transition`, `runtime_unavailable`, and
`storage_failure`. Assert thrown errors return sanitized `storage_failure`
without message or stack.

- [ ] **Step 5: Verify RED, implement Adapter, and verify GREEN**

`createWebHttpAdapter.js` uses `express.json({limit:'64kb'})`, no CORS, and only
the routes in the specification. `httpErrors.js` maps stable error codes to HTTP
status without changing the response envelope. `/api/interactions` returns
`runtime_unavailable` when no service is configured.

Run both focused files; expected: PASS.

- [ ] **Step 6: Add a dependency-boundary source test and commit**

Read the four `src/http/` files as text and assert they do not import
`repository`, `sqlite`, `pi`, `../app.js`, `../routes/`, or
`../storage/memoryStore.js` except that the composition-free capability wrapper
may call methods on the injected `core` object.

Commit:

```powershell
git add src/http test/webGateway.test.js test/webHttpAdapter.test.js
git commit -m "feat: add thin web application adapter"
```

### Task 2: Pi Runtime Coordinator and Interaction Service

**Files:**
- Create: `src/runtime/pi/piWebRuntimeCoordinator.js`
- Create: `src/application/interactionService.js`
- Test: `test/piWebRuntimeCoordinator.test.js`
- Test: `test/interactionService.test.js`

**Interfaces:**
- Consumes: `createPiTerminalPilotRuntime()`, `webGateway`, `core.continuity`, `core.v1Tools`, `routeContinuityInput()`.
- Produces: `createPiWebRuntimeCoordinator({ runtime, tools, invocationContextFactory }) → { activate, halt, interact, reconcile, close }` and `createInteractionService({ webGateway, continuity, runtimeCoordinator, clock }) → { submit(input) }`.

- [ ] **Step 1: Write failing Runtime Coordinator tests**

Use a fake Pi runtime and assert:

- `activate(run, descriptor)` creates one session, binds project id from the Run,
  and returns `{runtimeSessionId}`;
- replay of the same `(operation,key,runtimeReference)` causes one effective
  activation/halt;
- `interact({run, context, message})` resolves only the Run's persisted runtime
  reference and returns sanitized text/tool metadata;
- `reconcile(runningRuns, pause)` calls the governed pause callback before the
  coordinator is marked ready;
- `close()` disposes all sessions exactly once.

- [ ] **Step 2: Verify RED and implement coordinator**

Run `test/piWebRuntimeCoordinator.test.js`; expected missing module. Implement a
bounded in-memory map of active Pi session handles keyed by runtime id. The map
is runtime process state, never Workstream state. Rejected runtime operations
map to stable `runtime_unavailable`; no Pi object escapes.

- [ ] **Step 3: Write failing Interaction Service tests**

Test `submit({workstreamId,runId,message})` for:

- missing/non-running/mismatched Run stable errors;
- Gateway-only Workstream/Run reads;
- continuity selection limited to 12 entries;
- runtime call with bounded message and digest;
- post-turn authoritative Workstream/Run re-query and Event Cursor read;
- result containing only `message`, `toolResults`, `workstream`, `run`, and
  `events`, with no runtime object or context internals.

- [ ] **Step 4: Implement Interaction Service and verify GREEN**

Use `continuity.snapshot/plan`, enrich at most five open actions, compute the
existing `digestInput`, and use `routeContinuityInput`. Reject messages above
2,000 characters. Never persist assistant messages.

Run both focused files; expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/runtime/pi/piWebRuntimeCoordinator.js src/application/interactionService.js test/piWebRuntimeCoordinator.test.js test/interactionService.test.js
git commit -m "feat: add web runtime interaction boundary"
```

### Task 3: React/Vite shell, API client, and view-state model

**Files:**
- Create: `web/index.html`
- Create: `web/vite.config.js`
- Create: `web/src/main.jsx`
- Create: `web/src/App.jsx`
- Create: `web/src/apiClient.js`
- Create: `web/src/workbenchState.js`
- Create: `web/src/styles.css`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Test: `test/webApiClient.test.js`
- Test: `test/webShell.test.js`

**Interfaces:**
- Consumes: Phase 2B HTTP envelopes.
- Produces: `createApiClient({fetchImpl, baseUrl})`, pure state helpers, and a three-column `App` shell.

- [ ] **Step 1: Install the frozen dependencies**

Run:

```powershell
npm install react react-dom
npm install --save-dev vite jsdom
```

Verify no other direct dependency was added.

- [ ] **Step 2: Write failing API-client tests**

Cover `command`, `query`, `events`, and `interact`. Assert ids are generated or
accepted explicitly, stable envelopes are returned, transport failures become
`transport_unavailable`, and error envelopes retain `code`, `retryable`, and
`currentVersion` without stack/message leakage.

- [ ] **Step 3: Verify RED and implement API client**

Run `test/webApiClient.test.js`; expected missing module. Implement one bounded
fetch wrapper with no actor/capability/database fields.

- [ ] **Step 4: Write failing shell tests**

Create JSDOM, mount `<App api={fakeApi}/>` with `react-dom/client`, and assert:

- three named regions render;
- initial loading renders before fake query resolves;
- empty Workstream state renders after an empty page;
- stable query failure renders a retry action;
- no domain DTO is written to `localStorage`, IndexedDB, or sessionStorage.

- [ ] **Step 5: Implement shell and restrained CSS**

`App` owns selected id, active tab, form input, loading/error, ephemeral messages,
and cursor only. `workbenchState.js` exports deterministic status groups and
error labels. CSS uses neutral colors, status badges, clear typography, and no
animation framework or marketing gradients.

- [ ] **Step 6: Build, test, and commit**

Add only:

```json
"build": "vite build --config web/vite.config.js"
```

Add `web/dist/` to `.gitignore`; built assets are reproducible output, not
tracked product state.

Run focused tests and `npm run build`; expected PASS and `web/dist/` output.

Commit:

```powershell
git add package.json package-lock.json .gitignore web test/webApiClient.test.js test/webShell.test.js
git commit -m "feat: scaffold web workbench surface"
```

### Task 4: Workstream list, creation, and detail

**Files:**
- Create: `web/src/components/WorkstreamList.jsx`
- Create: `web/src/components/CreateWorkstreamForm.jsx`
- Create: `web/src/components/WorkstreamDetail.jsx`
- Create: `web/src/useWorkbenchData.js`
- Modify: `web/src/App.jsx`
- Modify: `web/src/styles.css`
- Test: `test/webWorkstreams.test.js`

**Interfaces:**
- Consumes: `api.query('workstream.list|get')`, `api.query('needs_owner.list')`, `api.command('workstream.create')`.
- Produces: grouped list, create flow, selected authoritative Workstream detail, and `refreshWorkstream()` for later tasks.

- [ ] **Step 1: Write failing rendering and creation tests**

Cover all five groups, fields, selected-row behavior, create validation, command
payload, empty/loading/error state, and reload after create. Include an open
NeedsOwner joined by `workstreamId` so the row moves to Needs Owner without
mutating the Workstream DTO.

- [ ] **Step 2: Verify RED and implement data hook/components**

The hook loads `workstream.list` and one global open `needs_owner.list`, joins in
view memory, and fetches selected `workstream.get`. The create form sends only
title, goal, scenario and stable ids; after success it discards local draft and
reloads from Core.

- [ ] **Step 3: Verify refresh semantics**

Unmount/remount `App` with the same fake server state and assert selected detail
comes from a new query, not prior React state.

- [ ] **Step 4: Run focused tests/build and commit**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webShell.test.js test/webWorkstreams.test.js
npm run build
git add web test/webWorkstreams.test.js
git commit -m "feat: add workstream web views"
```

### Task 5: Run controls and Event Cursor Activity

**Files:**
- Create: `web/src/components/RunControls.jsx`
- Create: `web/src/components/ActivityPanel.jsx`
- Create: `web/src/useEventPolling.js`
- Modify: `web/src/App.jsx`
- Modify: `web/src/useWorkbenchData.js`
- Modify: `web/src/styles.css`
- Test: `test/webRunActivity.test.js`

**Interfaces:**
- Consumes: `run.list/create/start/pause/resume/stop`, `activity.list`, and `event.list` through the API client.
- Produces: current Run control view and `useEventPolling({workstreamId,cursor,visible,intervalMs:3000})`.

- [ ] **Step 1: Write failing Run-control tests**

Assert create/start/pause/resume/stop payloads use the current DTO version,
derive allowed buttons from status, show stable invalid-transition errors, and
reload Run/Workstream after success or `version_conflict`.

- [ ] **Step 2: Implement minimal controls and verify GREEN**

Run creation uses `workerKind:'pi'` and scope `Web Workbench interactive run`.
The client never changes the DTO status optimistically.

- [ ] **Step 3: Write failing cursor-polling tests**

Use a fake clock to prove the hook polls after cursor N, pauses when
`document.hidden`, resumes from N on visibility, appends unique Activity items,
and never treats Activity as current Workstream state.

- [ ] **Step 4: Implement Activity and verify GREEN**

Activity renders safe title/summary/time from `activity.list`; raw Event remains
available only to the polling cursor machinery. Clean intervals on unmount and
selection change.

- [ ] **Step 5: Commit**

Run focused tests and build, then:

```powershell
git add web test/webRunActivity.test.js
git commit -m "feat: add run controls and activity polling"
```

### Task 6: NeedsOwner and Artifact panels

**Files:**
- Create: `web/src/components/NeedsOwnerPanel.jsx`
- Create: `web/src/components/ArtifactPanel.jsx`
- Modify: `web/src/App.jsx`
- Modify: `web/src/useWorkbenchData.js`
- Modify: `web/src/styles.css`
- Test: `test/webNeedsOwnerArtifacts.test.js`

**Interfaces:**
- Consumes: `needs_owner.list/resolve`, `artifact.list`.
- Produces: first-class resolution flow and safe Artifact metadata display.

- [ ] **Step 1: Write failing NeedsOwner tests**

Cover unresolved reason/options/consequence/context, option selection, resolve
with `expectedVersion`, no-option input items, conflict reload, and resolved item
removal only after authoritative re-query.

- [ ] **Step 2: Implement NeedsOwner panel and verify GREEN**

The panel never converts the item to a chat message and never synthesizes a
Decision. It displays the Core resolution result and refreshes Activity.

- [ ] **Step 3: Write failing Artifact tests**

Cover title/type/source/version/date/run, bounded metadata and preview metadata,
safe `https:` URL links, and inert display for `file:`, local paths, unknown
schemes, or invalid URLs. Assert there is no file-content fetch route.

- [ ] **Step 4: Implement Artifact panel, test/build, and commit**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webNeedsOwnerArtifacts.test.js
npm run build
git add web test/webNeedsOwnerArtifacts.test.js
git commit -m "feat: expose needs owner and artifacts"
```

### Task 7: Minimal Conversation through Interaction Service

**Files:**
- Create: `web/src/components/ConversationPanel.jsx`
- Modify: `web/src/App.jsx`
- Modify: `web/src/useWorkbenchData.js`
- Modify: `web/src/styles.css`
- Modify: `src/http/createWebHttpAdapter.js`
- Test: `test/webConversation.test.js`
- Test: `test/webInteractionHttp.test.js`

**Interfaces:**
- Consumes: `POST /api/interactions` and Task 2 `interactionService.submit()`.
- Produces: bounded current-page Conversation UI and safe HTTP interaction mapping.

- [ ] **Step 1: Write failing HTTP interaction tests**

Assert bounded `{workstreamId,runId,message,requestId}` mapping, stable runtime
failure status, and sanitization of thrown errors. Assert the Adapter passes no
browser actor/capability/runtime values to the service.

- [ ] **Step 2: Implement HTTP route and verify GREEN**

The route delegates once to `interactionService.submit` and returns its stable
application response. It never imports Pi.

- [ ] **Step 3: Write failing Conversation UI tests**

Cover input bounds, disabled submit without a running Run, ephemeral user and
assistant display, runtime error, tool-result evidence, post-turn refresh of all
domain panels, and remount losing Conversation while retaining queried Core
state.

- [ ] **Step 4: Implement Conversation panel, test/build, and commit**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webInteractionHttp.test.js test/webConversation.test.js
npm run build
git add src/http/createWebHttpAdapter.js web test/webInteractionHttp.test.js test/webConversation.test.js
git commit -m "feat: add web runtime conversation"
```

### Task 8: Composition root, restart E2E, Live Pi, legacy hardening, and acceptance

**Files:**
- Create: `src/http/createWebWorkbench.js`
- Create: `scripts/run-web-workbench.js`
- Create: `scripts/run-legacy-api.js`
- Create: `scripts/run-phase2b-live-e2e.js`
- Modify: `src/server.js`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `run-margin-local.cmd`
- Modify: `run-echo-local.cmd`
- Modify: `.env.example`
- Modify: `README.md`
- Create: `test/webWorkbenchComposition.test.js`
- Create: `test/phase2bWebE2E.test.js`
- Create: `test/phase2bLiveEvidence.test.js`
- Create: `docs/validation/phase_2b_acceptance_report.md`

**Interfaces:**
- Consumes: Tasks 1–7, `createMarginCore`, Pi provider configuration, Vite build output.
- Produces: executable `npm start`, `npm run dev`, isolated Web E2E, sanitized Live Pi evidence, and acceptance report.

- [ ] **Step 1: Write failing composition tests**

Inject fake Core/runtime/Vite factories and assert one Core path, Gateway creation,
startup reconciliation before listen, loopback default, graceful close once,
production missing-build failure, and dev middleware composition. Assert no
legacy app/routes/store import.

- [ ] **Step 2: Implement composition and scripts**

`createWebWorkbench()` accepts dependencies for tests. Production uses the
shared Core path, YAPI defaults from the terminal pilot without logging its key,
the Task 2 coordinator, Interaction Service, Task 1 Adapter, and built assets.

Set scripts exactly:

```json
{
  "build": "vite build --config web/vite.config.js",
  "start": ".\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-web-workbench.js",
  "dev": ".\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-web-workbench.js --dev",
  "pilot:terminal": ".\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-terminal-pilot.js"
}
```

- [ ] **Step 3: Write failing legacy-entrypoint tests and harden**

Assert direct `src/server.js` exits unless
`MARGIN_ENABLE_LEGACY_API=true`; named wrapper deliberately sets it and prints a
deprecated warning. Change Docker and Margin launcher to Web. Keep Echo launcher
explicitly legacy and warning-labeled. No legacy data migration occurs.

- [ ] **Step 4: Write and run non-model Web E2E**

Use a temporary directory, real Core, fake runtime, ephemeral HTTP port, and
JSDOM/fetch to execute the full acceptance sequence. Close server/Core, reopen
the same database, and prove state/cursor recovery. Assert final Run stopped,
NeedsOwner resolved, Artifact present, and Activity cursor strictly increases.

- [ ] **Step 5: Write sanitized Live Pi evidence guard**

`test/phase2bLiveEvidence.test.js` rejects evidence containing keys named
`prompt`, `message`, `assistant`, `text`, `reasoning`, `session`, `token`,
`apiKey`, `stack`, or credential-like values. It requires Margin ids, stable
codes, versions, cursor, and final status only.

- [ ] **Step 6: Run isolated real Live Pi E2E**

Run:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe scripts/run-phase2b-live-e2e.js
```

The script uses a temporary database, real HTTP Adapter and Pi `0.84.2`, creates
a Workstream/Run, sends a bounded instruction that requires a governed
Workstream state update, verifies version/cursor change through Web queries, and
deletes the temporary database after writing sanitized evidence under ignored
`data/phase2b-live/`. Do not print model output or the credential. If the live
provider fails, record the stable failure code honestly and investigate within
the frozen runtime boundary; do not substitute a fake result.

- [ ] **Step 7: Run full validation**

Run:

```powershell
npm run build
npm test
npm run validate:stage1
npm run audit:pi
git diff --check
git status --short
```

Also run the focused Phase 1/2A and Phase 2B files. Expected: all existing 373
tests plus all new tests pass; Stage 1 10/10; Pi audit `ok:true`.

- [ ] **Step 8: Capture page evidence and write acceptance report**

Start the Workbench against an isolated populated fixture, capture one desktop
screenshot showing the three columns without secrets or model text, and record:
HTTP structure, Web architecture, dependencies, exact tests, E2Es, NeedsOwner,
cursor, Artifact, Live result, legacy hardening, known gaps, and commit range.

- [ ] **Step 9: Commit and stop**

```powershell
git add src/http/createWebWorkbench.js scripts src/server.js package.json Dockerfile docker-compose.yml run-margin-local.cmd run-echo-local.cmd .env.example README.md test docs/validation/phase_2b_acceptance_report.md
git commit -m "feat: complete phase2b web workbench"
```

Do not merge automatically and do not begin Phase 3, Feishu, Scheduler, or a
Worker integration.
