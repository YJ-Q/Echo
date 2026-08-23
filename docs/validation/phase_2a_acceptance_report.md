# Phase 2A Application Contract Acceptance Report

Status: accepted on 2026-08-24 against Task 6 baseline `1858e29`.

## Scope and completion matrix

| Work item | Result | Evidence |
| --- | --- | --- |
| Contract types, validators, DTOs | Complete | Closed inputs, bounded/frozen camelCase outputs, safe stable errors, and Runtime ID separation tests |
| Migration 004 and persistence | Complete | Additive Workstream/Artifact fields, `margin_needs_owner`, `margin_event_cursors`, trigger-backed cursor assignment, transaction tests |
| Gateway commands and queries | Complete | Real Services/Repository integration, capability and host-authority checks, idempotency and optimistic concurrency tests |
| Event and Activity contract | Complete | Whitelisted Event Envelope, deterministic Activity projection, stable pagination, privacy and audit-correlation tests |
| CLI migration | Complete | Terminal persistent Workstream/Run/Checkpoint operations use only `execute/query`; restart reconciliation remains host-owned |
| Restart acceptance | Complete | `test/phase2aContractE2E.test.js` exercises the full canonical lifecycle across a real close/reopen of one SQLite file |
| Phase 2B code | Not started | No HTTP/Web/Feishu/Scheduler/Worker implementation was added |

## Final architecture

```text
Surface Adapter (CLI now; Web/Feishu/Scheduler/Worker later)
  -> MarginApplicationContract.execute/query/events
  -> Workstream/Run/Artifact/Checkpoint/NeedsOwner Services
  -> PersistentWorkRepository
  -> one canonical Margin SQLite

Runtime Adapter <-> Run.runtimeReference
```

The Gateway is transport-neutral, has no database handle, cache, or aggregate map, and returns only validated frozen DTOs. Aggregate tables remain the current-state source of truth. `margin_events` remains the append-only factual/integration log; Activity is derived in memory from safe Event Envelopes and has no table or shadow state.

Phase 0/1 history is retained rather than replaced. Stage 0 established the pinned Pi SDK/runtime and isolated audit boundary; Stage 1 retained its frozen ten-fixture protocol. The Phase 1 Persistent Core, host-owned Run control, checkpoint recovery, and runtime-neutral adapter remain the base on which Phase 2A adds a shared application boundary.

## Schema increment and transaction boundary

Migration 004 is additive:

- `margin_projects`: `priority`, `current_state`;
- `margin_artifacts`: `metadata`, `preview_metadata`;
- `margin_needs_owner`: persistent NeedsOwner identity, status, resolution, version, and source evidence;
- `margin_event_cursors`: `sequence` to unique `event_id`, backfilled by Event row order and assigned by an `AFTER INSERT` trigger.

Repository mutations commit aggregate state, audit evidence, the Event row, and trigger-assigned cursor in the same SQLite transaction. Run activation/halt remains an external Runtime boundary: activation is compensated by halt if persistence fails, but SQLite and an external Runtime cannot provide a distributed atomic transaction.

Explicit `checkpoint.create` emits `checkpoint.created`. Lifecycle checkpoints created by `run.pause` or `run.stop` are part of the Run transition transaction and are represented in the stream by `run.paused` or `run.stopped`, not by a second checkpoint event.

NeedsOwner and Decision remain distinct. NeedsOwner is an unresolved request for owner approval, input, decision, or conflict handling, with its own lifecycle and optimistic version. Decision is an already established durable decision exposed read-only through `decision.list` and Decision events in Phase 2A. Resolving NeedsOwner records its resolution but does not create or mutate a Decision; a future governed Decision write path requires separate scope.

## Restart and consistency evidence

The new E2E uses real `createMarginCore`, Services, Repository, Gateway, and SQLite. Only Runtime `activate/halt` are replaced with a deterministic fake. It performs:

1. Workstream create;
2. Run create and start;
3. Artifact, explicit Checkpoint, and NeedsOwner create;
4. Run pause and automatic recovery checkpoint;
5. Core close and reopen against the same SQLite file;
6. Workstream, Run, Artifact, latest Checkpoint, and NeedsOwner queries;
7. Run resume, NeedsOwner resolve, and Run stop;
8. Event and Activity reads.

The assertions prove that pause creates a second recovery checkpoint with the paused Run version, and that both checkpoint rows survive reopen. They also prove identical persisted IDs and versions after reopen, unchanged `runtimeReference`, the expected final Run/NeedsOwner versions, no Decision side effect from NeedsOwner resolution, one-to-one Event/cursor rows, unique strictly increasing cursors, matching Event/Activity ordering, and zero SQLite tables whose name contains `activity`.

Idempotency, concurrency, and cursor guarantees are also covered by the owning tests: repeated business keys replay transaction snapshots without duplicate Runtime or persistence side effects; changed input/actor/type conflicts; stale expected versions write no state or evidence; concurrent Run control serializes through SQLite; cursor pagination and restart produce no gaps or duplicates in the accepted stream.

## TDD record and deviations

The Task 6 acceptance test was written before any production change. Its first required run passed against the assembled Tasks 1–5 baseline, so no integration defect was observed and no production RED/GREEN fix cycle was needed. No Command, DTO, transport, UI, Scheduler, or Worker surface was expanded.

The only documented expression difference is the lifecycle-checkpoint event behavior described above. It does not create shadow state or weaken recovery: the checkpoint row and Run event share the Run transition transaction.

## Verification evidence

Commands were run from `D:\Echo` on 2026-08-24:

- `npm test -- test/phase2aContractE2E.test.js`: exit 0; because the repository test script includes `test/*.test.js`, the run executed the complete suite; `333` tests passed, `0` failed, including the restart E2E.
- `npm test`: exit 0; `333` tests passed, `0` failed, `0` skipped, `0` todo.
- `npm run validate:stage1`: exit 0; JSON reported `ok:true`, protocol `1.0.0`, total `10`, `career_project:5`, `learning_research:5`, `manifestBound:true`.
- `npm run audit:pi`: exit 0; Pi baseline `v0.84.2`, package `0.84.2`, MIT license, required Node `22.19.0`, observed runtime `22.23.1`, empty failures, `ok:true`.
- `git diff --check`: exit 0 with no whitespace errors; Git emitted only the repository's LF-to-CRLF working-copy notices for the three modified existing Markdown files.
- `git diff --cached --check` after staging all five Task 6 deliverables: exit 0 with no output, covering both newly added files as well as the tracked modifications.

These commands verify repository tests, the synthetic Stage 1 fixture set, and the installed Pi/runtime baseline. They do not constitute a Live model result.

## Known risks and validation gap

- YAPI Live Pi was not invoked for Phase 2A. No live result is claimed; credential-gated Live validation remains a known gap before a Runtime-dependent Web E2E.
- Runtime calls and SQLite cannot share a distributed transaction. Existing compensation covers failed persistence after activation; future remote Runtime adapters need explicit reconciliation and observability.
- Phase 2A capability checks and opaque host authority are in-process boundaries, not HTTP authentication or multi-user RBAC.
- SQLite cursor behavior is accepted for the current single-node Core. Phase 2B should load-test paging and connection contention before selecting an update transport.

## Phase 2B recommendation

Proceed with a separate Phase 2B design for a thin HTTP adapter and the minimum Workbench only after preserving this Gateway as the sole application boundary. Start with Workstream list/detail, Run controls, and Activity updates driven by Event cursor; keep browser state as a cache of DTOs, never an authority. Defer Feishu, Scheduler, Worker, workspace editing, and multi-Agent UI to later scoped decisions.
