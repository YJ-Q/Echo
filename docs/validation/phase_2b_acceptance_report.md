# Phase 2B Web Workbench Acceptance Report

Status: accepted on 2026-08-24. Commit range: 8a9a18b..HEAD (the Task 8 completion commit at HEAD). Phase 2B stops here; this change does not begin Phase 3, Feishu, Scheduler, or Worker work.

## Delivered surface

The default local surface is the Web Workbench. The production entrypoint serves a pre-built Vite application; the development entrypoint attaches Vite middleware. The browser supports Workstream creation and selection, Run create/start/pause/resume/stop transitions, NeedsOwner resolution, Artifact viewing, Activity refresh from Event Cursor, and a bounded governed interaction while an authoritative Run is running.

Browser state is a disposable view cache. It does not persist Contract DTOs or operate a second SQLite store. A browser or Web-host restart reopens the same configured Core database.

## HTTP, Gateway, and runtime boundary

createWebWorkbench opens exactly one configured Margin Core, then composes a trusted Web Gateway, Pi Web Runtime Coordinator, InteractionService, and HTTP adapter. Before the HTTP listener opens, durable running Runs are reconciled to paused. Default local binding is 127.0.0.1; Docker explicitly overrides that setting to 0.0.0.0 so its published port is reachable.

The HTTP host exposes bounded health, command, query, event, and interaction routes. Browser requests traverse the Gateway and cannot submit host-trusted identity, surface, capability, or correlation fields. The browser never calls Pi directly. Production startup fails with web_assets_missing when web/dist/index.html has not been built; npm start does not build assets.

Pi remains pinned to @earendil-works/pi-coding-agent 0.84.2. The process credential was checked only for existence and non-empty content; no credential value was printed, written to this report, or placed in Live evidence.

## Persistence and lifecycle evidence

The non-model HTTP E2E uses a temporary directory, real Core, fake runtime, ephemeral HTTP listener, and JSDOM/fetch. It creates a Workstream and Run, starts, pauses, restarts the Web host, verifies durable reconciliation to paused, resumes, creates an Artifact, resolves NeedsOwner, stops the Run, and reopens the same database. The E2E verifies strict unique increasing Event Cursors and Activity cursor agreement. It observes no echo.sqlite and no second/shadow state store.

The focused Phase 1 terminal restart suite also exercised pause, Core restart, checkpoint restoration, resume, stop, and persisted-runtime reconciliation.

NeedsOwner is first-class and resolves through its versioned Contract command. Artifact identity and safe metadata survive restart. Cursors remain derived from append-only Event history; no Activity table was introduced.

## Schema and legacy protection

Task 8 adds no Core schema migration and changes no Core persistence schema. The authoritative path remains data/terminal-pilot/margin-core.sqlite. data/echo.sqlite remains frozen: it is not migrated, merged, or double written.

The legacy server now exits on direct launch unless MARGIN_ENABLE_LEGACY_API=true. The deliberate legacy:api wrapper sets that flag and prints a deprecation warning. The Margin launcher and Docker use the Web Workbench; the Echo launcher explicitly selects the deprecated legacy wrapper and warns before doing so.

## Live Pi evidence

The isolated Live E2E used a temporary database, the real HTTP adapter, and Pi 0.84.2. It completed successfully. The flow created a governed Workstream/Run, performed one Web interaction, verified Workstream version and Event Cursor movement through Web queries, stopped the Run, and removed the temporary database.

Its persisted ignored evidence is restricted to final status, stable code, versions, cursors, and Margin identifiers. The recursive evidence guard rejects prompt/message/assistant/text/reasoning/session/token/apiKey/stack keys and credential-like values. No model response, prompt, Pi object, Chain-of-Thought, or credential is reported here.

## Verification

| Check | Result |
| --- | --- |
| npm run build | exit 0; Vite built the Web distribution |
| npm test | exit 0; 461 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo |
| npm run validate:stage1 | exit 0; 10/10 fixtures, manifest bound |
| npm run audit:pi | exit 0; Pi 0.84.2, Node 22.23.1, no audit failures |
| Focused Phase 1/2A/2B suites | exit 0; 27 passed, 0 failed |
| Real Live Pi E2E | exit 0; passed with sanitized evidence only |
| git diff --check | exit 0; no whitespace errors (Git line-ending notices only) |

The focused suite includes Phase 1 terminal restart/reconciliation, Phase 2A Contract restart and persistence, Web composition, non-model Web restart E2E, and Live-evidence guard coverage.

## Known gaps and stop condition

No screenshot was captured because this workspace has no browser screenshot tooling. Safe page behavior is covered by the production build and ephemeral HTTP tests. The Web host remains a local, single-user surface; remote exposure, authentication, multi-user authorization, Feishu, Scheduler, Worker, and Phase 3 changes remain out of scope.

Phase 2B is complete and intentionally stops at this acceptance boundary.
