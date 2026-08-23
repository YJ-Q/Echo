# Phase 1 Acceptance Report

Date: 2026-08-23  
Scope: roadmap Tasks 1–5 only. Phase 2 was not started.

## Outcome

Phase 1 establishes a runtime-neutral Persistent Margin Core. Workstream, Run, Artifact and Checkpoint use versioned SQLite migrations, repository transactions, append-only Events, Audits and request-ID idempotency. The CLI is now an Application Core client and the default entry point.

The V1 Source of Truth is `data/terminal-pilot/margin-core.sqlite`. The old `data/echo.sqlite` is frozen legacy input: it was inventoried read-only, was not exported or migrated, and is accessible only through an explicitly deprecated API command.

## Relationships and control

- Workstream owns durable goal/plan/next action and references checkpoints.
- Run belongs to one Workstream and references only the current external runtime Session ID.
- Pi Session remains replaceable runtime context; it does not own Workstream state.
- Start/resume and pause/stop require a Core-bound host capability and are coordinated with runtime activation/halt.
- Pause, stop, complete and terminal close leave a durable checkpoint; terminal close pauses a running Run.
- `/status`, `/pause`, `/resume`, `/stop`, `/checkpoint` call Application Services, not SQLite.

Pi `0.84.2` remains the default general runtime behind the existing adapter. Core lifecycle tests do not require Pi or a model provider.

## Main implementation

- `src/domain/workstream.js`, `src/domain/run.js`
- `src/core/migrations/003-persistent-work.js`
- `src/core/persistentWorkRepository.js`
- `src/application/*Service.js`
- `src/pilot/terminalPilotController.js`, `src/pilot/terminalCommands.js`
- `scripts/inventory-legacy-data.js`, `scripts/export-legacy-data.js`
- `docs/architecture/adr/001-workstream-run-state-model.md`
- `docs/architecture/phase_1_persistent_core.md`
- `docs/audit/legacy_data_disposition.md`

## Verification

- Full regression: 286/286 passed.
- Frozen Stage 1 fixtures: 10/10, manifest bound.
- Pi baseline audit: passed for package/runtime `0.84.2`, MIT, Node `22.23.1`.
- `git diff --check`: passed.
- Restart E2E: real controller + real SQLite created Workstream and Run, paused with checkpoint, closed/reopened Core, restored the same IDs/checkpoint, resumed, and stopped. It uses a deterministic runtime control double so it does not claim a live model result.
- A real terminal/Pi-adapter command-only run was attempted but stopped with `pi_credentials_required` because `YAPI_API_KEY` was not present in this process environment. This does not invalidate the runtime-independent Persistent Core E2E; no live-provider result is claimed.

## Legacy inventory

The read-only inventory observed 10 tables and emitted only schema/count/hash metadata. No record content was printed by the inventory, and no data was changed. Detailed counts and proposed dispositions are in `legacy_data_disposition.md`.

## Remaining debt and risks

- Physical table names `margin_projects` and legacy Task-based tool contracts remain compatibility details inside the canonical database; they should be removed only after later contract migration.
- The deprecated Express/Echo path is not adapted to V1. It must remain frozen until explicit export/migrate/delete decisions are approved.
- SQLite is single-node. Scheduler leases, crash recovery for unattended work and multi-process concurrency are deferred.
- Workstream lifecycle mutation beyond creation/read and Run-owned controls is not yet exposed as a full public API.
- The V1 terminal deliberately denies legacy Task mutations; Workstream updates and Decision operations remain available through its governed state tool.
- No live-provider terminal control run was recorded in this environment, and no user-value claim follows from automated tests.

## Commits

- `04f5ea5` domain state models
- `0c0fdcd` persistent schema
- `27176cb` repository and application services
- `8a4c732` persistent Run controls
- `618c369` unified CLI and legacy inventory
- `268e98a` authority, migration, idempotency and restart reconciliation fixes
- `37c1e7f` host capability and Workstream–Run invariant fixes

## Phase 2 recommendation

Pause here. Before Web Workbench work, approve a focused frontend/API contract ADR. Phase 2 should consume the same Application Services and must not reintroduce a UI-owned or HTTP-owned state store.
