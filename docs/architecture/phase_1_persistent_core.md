# Phase 1 Persistent Core Architecture

Status: current architecture as of 2026-08-23. This updates, but does not delete, the Phase 0 audit.

## Source of Truth

Margin V1 has one authoritative SQLite schema managed by `src/core/migrations/` and one repository boundary in `src/core/persistentWorkRepository.js`. Application services for Workstream, Run, Artifact, Checkpoint and continuity planning are exposed by `createMarginCore()`.

The terminal is the first client of these services. It no longer creates projects/tasks or queries actions through the Store/SQLite handle. The Store remains an internal compatibility implementation used by the repository and the four governed Margin tools; surfaces must not import or call it.

The old Express/Echo database is frozen legacy input, not a second V1 state store. Its disposition is documented in `docs/audit/legacy_data_disposition.md`.

## Entity boundaries

- Workstream: durable goal, plan, next action, state and workspace metadata. The existing `margin_projects` table is the migrated physical projection; the V1 service names it Workstream.
- Run: one controlled execution scoped to a Workstream. At most one open Run exists per Workstream.
- Session: runtime-owned interaction context referenced by `Run.runtime_session_id`; it is replaceable and never the Workstream itself.
- Event: append-only fact for each durable entity change.
- Audit: authorization/request evidence, separate from Event.
- Artifact: metadata and provenance for a result; no file content is copied into state.
- Checkpoint: durable recovery coordinates linked to Workstream and optional Run.

The legacy Task table is retained for compatibility with the four existing tools and old records, but the V1 terminal no longer creates a shadow Task for a Workstream. Its deletion condition is replacement of remaining task-based tool contracts by Workstream/Run contracts in a later approved phase.

## Runtime boundary

Pi Agent `0.84.2` remains behind `src/runtime/pi/`. The Application Core knows only a host runtime control contract:

- `activate(run) -> { runtimeSessionId }`
- `halt(run)`

Start/resume activates runtime before committing `running`; a failed commit triggers compensating halt. Pause/stop halt runtime before committing the stable state and checkpoint. Closing the terminal automatically pauses a running Run. This prevents a UI or Session lifecycle from becoming authoritative state.

Pi is therefore replaceable by a future Codex Worker or another runtime without changing Workstream/Run persistence.

## Phase 1 CLI controls

The terminal supports `start` on launch and host-owned `/status`, `/pause`, `/resume`, `/stop`, and `/checkpoint`, in addition to continuity and memory commands. Model tool calls cannot forge these host controls.

## Deferred compatibility debt

- Old Express routes/services/storage remain frozen and explicitly deprecated; they are not adapted into V1 in Phase 1.
- Existing project/task/decision/action/memory tool schemas still use legacy physical naming over the same canonical Core database.
- SQLite remains single-node; multi-process lease/scheduler behavior is Phase 5, not implied by current Run persistence.
