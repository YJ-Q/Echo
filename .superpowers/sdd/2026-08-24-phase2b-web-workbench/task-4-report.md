# Task 4 Report — Workstream list, creation, and detail

## Delivered

- Added deterministic Running, Needs Owner, Waiting, Paused, and Completed Workstream groups.
- Added in-memory joining of one global `needs_owner.list` open page by `workstreamId`; the received Workstream DTOs remain unchanged.
- Added create validation for title, goal, and scenario. Creation sends only the closed `{ title, goal, scenario }` payload with generated `requestId` and `idempotencyKey`, then clears the draft, reloads authoritative lists, and re-queries/selects the created Workstream.
- Added authoritative selected-detail loading from `workstream.get`, including an exported `refreshWorkstream` hook API for later work.
- Added fixed Workstream detail fields and neutral, responsive presentation styles.
- Kept the Activity region as the existing placeholder. No Run controls, NeedsOwner resolution, Artifacts, or Conversation were added.

## TDD evidence

1. RED: added `test/webWorkstreams.test.js` before component or data-hook implementation. The focused run failed with missing grouped rows, absent selectable Workstream controls, and absent create form.
2. GREEN: implemented the data hook and Workstream components, then reran the focused shell and Workstream tests: 9 passing.
3. REFACTOR/self-review: kept components in Node-loadable `.js` modules with the required `.jsx` public wrappers, kept the query boundary closed to the four Task 4 operations, and verified the web source has no browser storage or Core/repository/Pi imports.

## Verification

- Focused: `.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test\\webWorkstreams.test.js test\\webShell.test.js` — 9 passing.
- Build: `npm run build` — passing.
- Full regression: `npm test` — 422 passing, 0 failing.
- `git diff --check` — clean.

## Scope and safety review

- The browser consumes only `workstream.list`, `workstream.get`, `needs_owner.list`, and `workstream.create` for this task.
- List grouping has no optimistic status change and does not alter Workstream DTOs.
- All queried data is React in-memory state only; unmount/remount tests prove selected detail is fetched again rather than restored from browser or prior React state.
- No local storage, session storage, IndexedDB, repository/Core, or Pi direct access was added.

## Fix round 1

1. RED/GREEN: an open NeedsOwner now takes precedence over `running` during deterministic list grouping, while the Workstream DTO status remains unchanged.
2. RED/GREEN: a create intent now retains one business `idempotencyKey` while its trimmed title, goal, and scenario are unchanged; each attempt receives a new request ID. A failed, conflicting, or otherwise uncertain command refreshes authoritative lists and any selected detail before exposing the retry. The regression test simulates a server that created the Workstream but lost the first response, and proves retry does not create a duplicate; changing the draft produces a new business key.
3. RED/GREEN: list refreshes have a monotonic generation and mount guard. A stale deferred response cannot replace a newer response, and deferred list responses after unmount are ignored without state writes. Detail refreshes share the mount guard.

### Fix verification

- Focused shell/Workstream tests: 12 passing.
- `npm run build`: passing.
- Full `npm test`: 425 passing, 0 failing.
