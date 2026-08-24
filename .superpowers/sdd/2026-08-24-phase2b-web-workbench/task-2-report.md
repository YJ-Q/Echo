# Task 2 — Pi Runtime Coordinator and Interaction Service

## Scope and design

- Added `createPiWebRuntimeCoordinator()` as the in-memory Pi lifecycle boundary. It deduplicates activate/halt by the persisted operation tuple, derives tool scope from the authoritative Run workstream ID, resolves interaction only through a persisted runtime reference, serializes startup reconciliation before activation, and sanitizes all exported tool metadata.
- Added `createInteractionService().submit()` as an application boundary. It validates bounded input, reads all authoritative Workstream/Run state through Web Gateway helpers, builds a 12-entry continuity context with no more than five open-action enrichments, invokes the coordinator, then returns only the refreshed Workstream, Run, event delta, assistant message, and safe tool metadata. It does not persist assistant dialogue.
- Corrected the reusable Pi terminal runtime so every Pi session owns its invocation-context and tool-result closures. This prevents a later session from overwriting another Run's authorization/workstream scope.

## TDD evidence

1. RED: `.runtime\\node-v22.23.1-win-x64\\node.exe --test test\\piWebRuntimeCoordinator.test.js test\\interactionService.test.js` failed with `ERR_MODULE_NOT_FOUND` for both new modules.
2. GREEN: the same focused command passed after the initial coordinator/service implementation.
3. RED: coordinator restart-race test failed with `1 !== 0`; activation created a session before reconciliation completed. GREEN after activation awaited reconciliation.
4. RED: interaction Gateway-failure test returned `runtime_unavailable` rather than `storage_failure`. GREEN after the service distinguished Gateway failures.
5. RED: nested metadata test exposed `requestShape.prompt`. GREEN after closed, bounded `requestShape` DTO sanitization.
6. RED: two-session Pi runtime test observed no call for the first session after the second opened, proving context overwrite. GREEN after per-session Pi services/extensions captured their own invocation context.
7. RED: close-during-activation test returned a live session. GREEN after late sessions are closed and activation returns sanitized `runtime_unavailable`.
8. RED: reconciliation test invoked `haltSession` twice when the governed pause callback owned halt. GREEN after reconciliation delegates lifecycle mutation to the governed callback.
9. RED: interaction event test expected a pre-turn cursor and post-turn delta but received only `afterCursor: 0`. GREEN after cursor capture/follow-up event read.

## Verification

- Focused: `.runtime\\node-v22.23.1-win-x64\\node.exe --test test\\piTerminalPilotRuntime.test.js test\\piWebRuntimeCoordinator.test.js test\\interactionService.test.js` — 15 passed.
- Full: `npm test` — 401 passed, 0 failed.
- `git diff --check` — clean.

## Files

- Added `src/runtime/pi/piWebRuntimeCoordinator.js`
- Added `src/application/interactionService.js`
- Added `test/piWebRuntimeCoordinator.test.js`
- Added `test/interactionService.test.js`
- Updated `src/runtime/pi/piTerminalPilotRuntime.js` and `test/piTerminalPilotRuntime.test.js` to guarantee per-session invocation-context isolation required by the coordinator.

## Self-review

- Independent review findings for multi-session context isolation, late session disposal, governed reconciliation, nested metadata sanitation, and event cursor freshness were addressed and regression-tested.
- No repository/SQLite access or assistant-message persistence was introduced. No HTTP route, UI, composition, legacy, scheduler, Feishu, or worker code was changed.

## Commit

`feat: add web runtime interaction boundary` (the final commit for this task).

## Concerns

No functional blockers. Pi services are intentionally created per session to preserve tool authorization isolation; this trades setup cost for strict Run scoping.

## Fix round 1 — independent review remediation

### Changes

- Web Gateway browser reads remain sanitized, while its existing server-internal query/event helpers now return the Core contract envelope unchanged. This supplies `runtimeReference` only to the application interaction boundary and retains browser disclosure protections.
- Coordinator session records now bind Pi session ID, runtime kind, Run ID, and Workstream ID. `interact` and tracked-session `halt` require an exact match; every coordinator-side runtime failure is reconstructed as a code-only `runtime_unavailable` error.
- Per-session turns are serialized through a promise tail, preventing overlapping Pi prompts and tool-result buffers.
- Interaction preserves safe Gateway error codes/retryability/current version, verifies the refreshed request tuple before reading/returning events, and restricts tool metadata to bounded scalar DTO fields.

### Additional RED/GREEN evidence

1. RED: real `createWebGateway()` integration test showed `runtimeReference` was stripped before `Interaction.submit()` and the runtime received `undefined`. GREEN after unsanitized internal dispatch only; browser `query()` remains stripped.
2. RED: cross-Run ownership test returned the owner session reply to an attacker. GREEN after session ownership binding and kind checks.
3. RED: safe Gateway failure test returned `not_found` for a `version_conflict`. GREEN after explicit safe-envelope propagation.
4. RED: post-turn Run mismatch test returned assistant text/events mixed with a different Workstream Run. GREEN after tuple revalidation before event retrieval.
5. RED: hostile tool metadata leaked object credentials, oversized IDs, and invalid scalar types. GREEN after closed scalar sanitization.

### Fix-round verification

- Focused: `.runtime\\node-v22.23.1-win-x64\\node.exe --test test\\piWebRuntimeCoordinator.test.js test\\interactionService.test.js test\\webGateway.test.js` — 23 passed.
- Full: `npm test` — 408 passed, 0 failed.

## Fix round 2 — queued-turn cancellation

- RED: with turn 1 blocked and turn 2 queued, halting the Run then releasing turn 1 allowed turn 2 to call Pi and return a message.
- GREEN: the queued callback now rechecks its record's closed state, map membership, and Run/Workstream/runtime-reference ownership immediately before `send`. A halted/closed session returns only stable `runtime_unavailable`; halt never waits for the active turn, avoiding a lifecycle deadlock.
- Focused verification: 24 passed. Full verification: `npm test` — 409 passed, 0 failed.
