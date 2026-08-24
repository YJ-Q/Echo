# Margin V1 Phase 2B Web Workbench Design

Date: 2026-08-24
Status: frozen and approved
Baseline: `8232fa484743dc65ebd844e1762845ba0bb6e07e`

## 1. Goal

Phase 2B makes the accepted Persistent Core and transport-neutral Application
Contract visible and operable through the first daily-usable Web Surface.

The result is a desktop-first, Workstream-first three-column Workbench that can:

- list, create, select, and reload Workstreams from the Persistent Core;
- display Workstream state, plan, next action, blockers, checkpoint, and
  workspace reference;
- create and control Runs;
- display and resolve NeedsOwner items;
- display Artifacts and user-safe Activity derived from Event Cursor;
- accept a minimal natural-language interaction through the Pi runtime;
- recover authoritative state after browser and server restart.

This phase does not make Conversation a persistent business object and does not
introduce a second state store.

## 2. Frozen principles

- One Core, Multiple Surfaces.
- Workstream-first.
- Chat is an interface, not the state database.
- Persistent State is more authoritative than UI State.
- Thin Adapter, Thin Client Logic.
- Stable State, Replaceable Runtime.
- `data/terminal-pilot/margin-core.sqlite` is the only V1 current-state Source
  of Truth for both Web and Terminal.
- The frozen Application Gateway remains exactly `execute`, `query`, and
  `events`.

## 3. Technology choice

The Web Surface uses:

- React and React DOM;
- Vite;
- plain JavaScript and JSX;
- CSS without a component framework or large design system;
- the existing Express dependency for a new isolated HTTP host;
- Node's built-in test runner and JSDOM.

The new HTTP host must not import the legacy `src/app.js`, legacy routes, or
legacy memory store. Using Express as a transport library does not restore the
old Express product path.

No Vitest, Playwright, Electron, Tailwind, state-management framework, SSE, or
WebSocket is introduced.

## 4. Process composition

`scripts/run-web-workbench.js` is the Phase 2B composition root. It:

1. opens one Margin Core at
   `data/terminal-pilot/margin-core.sqlite` unless an explicit test-only
   composition dependency supplies another path;
2. creates the Pi runtime coordinator when provider configuration is present;
3. creates one Application Gateway with that coordinator as its Run runtime
   boundary;
4. creates the Application Interaction Service;
5. creates the isolated HTTP Adapter;
6. serves the built Vite application in production or Vite middleware in
   development;
7. closes HTTP, runtime, and Core resources exactly once.

The production server binds to `127.0.0.1` by default. Remote-network exposure,
authentication, and multi-user authorization are outside Phase 2B.

## 5. HTTP Adapter

### 5.1 Routes

The stable transport routes are:

- `GET /api/health`
- `POST /api/commands`
- `POST /api/queries`
- `GET /api/events?afterCursor=&workstreamId=&limit=`
- `POST /api/interactions`

No convenience route may implement independent business logic. Additional
read-only health or static-asset routes are permitted.

### 5.2 Mapping

The three Contract routes perform only:

```text
HTTP input
→ bounded JSON/query parsing
→ server-owned invocation context
→ Gateway execute/query/events
→ stable envelope
→ HTTP status mapping
```

The Adapter never imports repositories, SQLite APIs, Pi internals, or legacy
state services.

### 5.3 Trusted context

The browser supplies the Contract envelope, including request and idempotency
identifiers, but cannot supply trusted actor, surface, capability, database, or
runtime values.

The server constructs:

```js
{
  actor: { type: 'user', subjectId: 'local-web-user' },
  surface: { kind: 'web', instanceId: '<server-owned-instance>' },
  requestId: '<validated request id>',
  correlationId: '<server-owned correlation id>',
  capabilities: ['<server-derived for request type>']
}
```

Mutation contexts are host-bound through the existing Core authority mechanism.
Capabilities are selected from a closed request-type map and are never copied
from request JSON.

### 5.4 HTTP status and error safety

Application envelopes are returned unchanged except for transport framing.
Suggested status mapping:

- success: `200`;
- invalid request: `400`;
- permission/capability failure: `403`;
- not found: `404`;
- version, idempotency, transition, or open-Run conflict: `409`;
- runtime unavailable or storage failure: `503`.

Responses never include SQL, stack traces, credentials, Pi objects, raw runtime
errors, hidden reasoning, or Chain-of-Thought. JSON bodies are bounded to 64 KiB.

## 6. Application Interaction Service

`POST /api/interactions` maps to a separate application-level service because
the frozen Gateway intentionally has no natural-language method.

```text
Browser
→ HTTP Adapter
→ Interaction Service
→ Runtime Coordinator / Pi
→ governed Margin tools
→ Persistent Core and Event
```

The Interaction Service:

- accepts a bounded `workstreamId`, `runId`, and user message;
- queries the Workstream and Run through the Gateway;
- requires the Run to be running;
- plans bounded continuity context through the existing continuity service;
- sends only sanitized context and the user message to the Pi session associated
  with the Run's runtime reference;
- returns assistant display text plus sanitized tool result codes and entity
  coordinates;
- re-queries authoritative Workstream/Run state and Event Cursor after the turn.

It does not persist a conversation transcript or maintain Workstream state. Pi
tools remain governed by the existing trusted invocation context. Phase 2B Pi
tools can update only capabilities they actually expose; unsupported Artifact,
NeedsOwner, Decision, or Checkpoint claims must not be fabricated.

When Pi configuration is absent or invalid, the endpoint returns stable
`runtime_unavailable`; the Web does not simulate a live model.

## 7. Runtime Coordinator

One server-owned coordinator serves both Gateway Run control and Interaction.

- Margin owns Workstream and Run identifiers.
- Pi session identifiers appear only as `runtimeReference` values.
- Starting or resuming a Run creates or recovers a Pi session and returns its
  runtime identifier to the existing Run service.
- Pausing or stopping a Run halts the referenced session idempotently.
- Interaction resolves a session only through the persisted Run runtime
  reference.
- On server startup, persisted `running` Runs are reconciled to `paused` using
  the existing governed Run transition and checkpoint behavior before the HTTP
  server accepts requests. This prevents ghost runtimes after process death.

Runtime operations retain the existing business idempotency key contract. The
coordinator keeps no authoritative Workstream state.

## 8. Web application

### 8.1 Layout

The application uses a restrained three-column desktop layout:

- left: Workstreams;
- center: Current Workstream;
- right: Control and Context.

The layout may stack at narrow widths for basic accessibility, but Phase 2B is
not a mobile application.

### 8.2 Left column

Each Workstream row shows title, status, priority, next action, active Run,
NeedsOwner indicator, and updated time.

Rows are grouped deterministically:

- Running: `running`;
- Needs Owner: open NeedsOwner or `needs_owner`;
- Waiting: `ready`, `waiting`, `watching`, `blocked`;
- Paused: `paused`;
- Completed: `completed`.

The create form requires title, goal, and one of the existing scenarios:
`career_project` or `learning_research`.

### 8.3 Center column

The fixed summary shows title, goal, status, current state, plan, next action,
blockers, latest checkpoint, and workspace reference.

Tabs are:

- Conversation;
- Artifacts;
- Activity.

No Files tab is included because safe filesystem listing is not available
without expanding the security boundary.

### 8.4 Right column

The right column shows Run status, current plan, next action, unresolved
NeedsOwner items, and legal controls derived from current DTOs.

The client sends requested transitions but never assumes they succeeded. On
`version_conflict` or `invalid_transition`, it shows a stable message and
immediately reloads current state.

## 9. Client state and refresh

Browser-owned state is limited to:

- selected Workstream id;
- active tab;
- loading and error markers;
- temporary forms and current-page Conversation messages;
- the latest Event cursor for the selected Workstream.

Workstream, Run, Decision, NeedsOwner, Artifact, Checkpoint, and lifecycle state
are always reloaded from the Application Contract. A browser refresh may lose
Conversation display messages but must restore every persistent domain object.

The selected Workstream may be represented in the URL. No browser database or
domain-state cache is introduced.

## 10. Event polling and Activity

Activity comes only from the existing Event Contract and user-safe Activity DTO.

- poll interval: 3 seconds while the document is visible;
- pause polling while `document.hidden` is true;
- on visibility restoration, continue from the last cursor;
- deduplicate by stable cursor/id before rendering;
- on refresh, re-query current state and start a fresh cursor stream without
  treating Activity as the current-state authority.

No raw Pi event, tool spam, token record, prompt, or hidden reasoning is shown.

## 11. NeedsOwner and Artifacts

NeedsOwner is queried as a first-class application object. The Web supports:

- unresolved list and indicator;
- reason, options, consequence, and context summaries;
- option selection and resolve with `expectedVersion`;
- state/event refresh after resolution.

Artifacts display:

- title, type, source, version, created time, and associated Run;
- metadata and preview metadata as bounded JSON;
- the resource reference as inert text or a safe web URL.

There is no arbitrary local-file read or download endpoint.

## 12. Minimal Conversation

Conversation contains one bounded text input and current-page message display.
Submitting while no running Run exists gives a clear action-oriented error.

After every successful interaction the client refreshes:

- selected Workstream;
- Run;
- NeedsOwner;
- Artifacts;
- Activity after the last cursor.

Assistant text is display-only. Tool result codes and persisted DTO/Event
changes are the evidence of successful state mutation.

## 13. npm scripts and startup

- `npm run build`: build the Vite frontend only;
- `npm start`: start the production HTTP Adapter and serve an already-built
  Workbench; it does not run a hidden build pipeline;
- `npm run dev`: start the HTTP Adapter with Vite development middleware;
- `npm run pilot:terminal`: retain the Terminal debug/advanced Surface;
- `npm run legacy:api`: explicit deprecated legacy entrypoint only.

Production startup fails with a clear message when Web assets are not built.

## 14. Legacy hardening

The legacy server requires an explicit `MARGIN_ENABLE_LEGACY_API=true` gate.
The named legacy npm script may use a small wrapper that deliberately sets the
gate; normal Web startup never does.

Docker and `run-margin-local.cmd` are switched to the Web Workbench. The
deprecated Echo launcher may only point to the explicit legacy wrapper and must
print a warning. No legacy route or legacy store is imported by Phase 2B.

This is entrypoint hardening, not a legacy backend rewrite or data migration.

## 15. Testing

### 15.1 HTTP Adapter

Tests cover command/query/event mapping, context ownership, contract version,
HTTP error mapping, safe failures, bounded bodies, and source-level dependency
guards proving the Adapter does not import repository, SQLite, Pi, legacy app,
routes, or store.

### 15.2 Web

Node + JSDOM tests cover Workstream groups, list/detail rendering, reload,
controls, NeedsOwner resolution, Artifacts, Activity cursor polling and page
visibility, Conversation, conflicts, and empty/loading/error states.

### 15.3 Non-model E2E

An isolated temporary database and fake runtime execute:

```text
open Web
→ create/select Workstream
→ create/start Run
→ Activity
→ pause
→ browser and server restart
→ restore and resume
→ create Artifact
→ create and resolve NeedsOwner
→ stop Run
→ verify final DTOs and cursor
```

### 15.4 Live Pi E2E

Because the current Process has a non-empty `YAPI_API_KEY`, Phase 2B performs one
isolated live validation using Pi `0.84.2` and a temporary database:

```text
Web HTTP
→ Interaction Service
→ Pi Runtime
→ governed state tool
→ Margin Workstream/Event
→ Event Cursor
→ Web query refresh
```

The evidence file contains only Margin ids, stable result codes, versions,
cursors, and final status. It must not contain the key, full prompt, assistant
text, Pi internal objects, or hidden reasoning. Live failure is reported
honestly and is never replaced with fake success.

### 15.5 Regression

The existing 373 tests, focused Phase 1/2A tests, Stage 1 fixtures, Pi audit,
restart controls, cursor, idempotency, and concurrency tests must remain green.

## 16. Dependencies

New runtime dependencies:

- `react`;
- `react-dom`.

New development dependencies:

- `vite`;
- `jsdom`.

No extra request client, router, state manager, CSS framework, test framework,
browser automation, or process supervisor is added unless implementation proves
it unavoidable. Such a finding requires a specification update before adding it.

## 17. Non-goals

Phase 2B does not implement Feishu, Scheduler, overnight execution, Codex
Worker, DeepSeek Harness, Temporal Council, multi-Agent UI, Electron, mobile
app, arbitrary filesystem access, full editor, advanced diff UI, persistent
Conversation history, SSE, WebSocket, or a complete authorization product.

## 18. Acceptance

Phase 2B is complete when:

1. `npm run build` produces the Workbench and `npm start` serves it;
2. the Web displays and creates real Workstreams;
3. Workstream detail and Run controls operate through the Gateway;
4. refresh restores Core state;
5. Activity follows Event Cursor;
6. NeedsOwner is resolvable;
7. Artifact metadata is visible without arbitrary file access;
8. minimal Conversation works through the Interaction Service;
9. non-model restart E2E passes;
10. isolated Live Pi E2E records an honest sanitized result;
11. existing and new tests pass;
12. no legacy or browser shadow state becomes authoritative.

Completion produces a Phase 2B acceptance report and stops before any next
phase.
