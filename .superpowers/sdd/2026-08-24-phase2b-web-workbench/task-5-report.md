# Task 5 Report — Run controls and Event Cursor Activity

## Delivered

- Added Run controls backed only by `run.list`, `run.create`, `run.start`, `run.pause`, `run.resume`, and `run.stop`.
- Commands use the selected Run DTO's `expectedVersion`, a new request ID per attempt, and a stable idempotency key for the same run action or create intent. New runs use worker kind `pi` and scope `Web Workbench interactive run`.
- Button availability is closed over the current Run status. No Run DTO is optimistically changed. Every command outcome reloads authoritative Run data plus Workstream list/detail state; version conflicts retain their stable user-facing error.
- Added `useEventPolling` with a 3000 ms default interval, sequential cursor commits, gap filling across paged results, visibility pause/resume, and unmount/selection stale-response guards.
- Added an Activity panel that queries `activity.list` only after the matching Event page has been handled, deduplicates by cursor, and renders only safe Activity title, summary, and time fields. Raw Events never become current state.
- Added responsive styles and stable `invalid_transition` presentation. No NeedsOwner resolution, Artifact, Conversation, or composition work was included.

## TDD evidence

1. RED: `test/webRunActivity.test.js` initially failed because `ActivityPanel` did not exist.
2. GREEN: Run command version/button behavior, conflict authority reload, visibility pause/resume, and safe Activity rendering passed after the minimal components and polling hook were added.
3. RED/GREEN follow-ups: a Workstream selection test exposed retained prior activity; resetting selected Activity state made it pass. A Run-success test exposed that only Workstream detail, not the list, was refreshed; `refreshAfterRunCommand` now reloads both list and selected detail.

## Verification

- Focused: `.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test\\webRunActivity.test.js` — 4 passing.
- Adjacent Web checks: `.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test\\webRunActivity.test.js test\\webWorkstreams.test.js test\\webShell.test.js test\\webApiClient.test.js` — 20 passing.
- Build: `npm run build` — passing.
- Full regression: `npm test` — 429 passing, 0 failing.
- `git diff --check` — clean.

## Scope/safety review

- Browser code uses only the Task 5 Run, Activity, and Event contract methods introduced here; it has no Core, repository, runtime, Pi, or browser-persistence access.
- Event cursor advancement occurs only after a matching Activity page has been processed. Duplicate activity cursors are not appended.
- Timers are cleared and async generations invalidated on visibility changes, selection changes, and unmount.

## Fix round 1

1. RED/GREEN: Run command completion now carries a selected-workstream generation. A command that resolves after selection changes cannot reload Runs or Workstreams, and cannot write its older submitting/error state into the new selection.
2. RED/GREEN: Event polling ownership is generation-specific. A pending Event request for a prior selection no longer blocks the new selection's immediate poll; old cleanup/finally paths cannot suppress the new generation.
3. RED/GREEN: Run loading requests the Contract's closed open-status set (`queued`, `running`, `paused`, `needs_owner`) with bounded pages and follows cursor pages. Terminal history therefore cannot displace an open Run from the controls.

### Fix verification

- Focused Task 5: 7 passing.
- Adjacent Web checks: 23 passing.
- `npm run build`: passing.
- Full `npm test`: 432 passing, 0 failing.
