# Task 7 Report

Status: complete.

Implemented:
- Added `/api/interactions` as a closed, bounded browser request surface for `{ workstreamId, runId, message, requestId }`.
- Routed valid turns to `interactionService.submit` exactly once and sanitized stable success/error responses.
- Added the Web Workbench conversation panel with ephemeral mount-local messages, running-Run gating, bounded input, sanitized tool evidence, and synchronous duplicate-submit protection.
- Wired post-turn authoritative refresh across Workstreams, selected Workstream detail, Runs, NeedsOwner, Artifacts, and Activity/Event cursor reloads without optimistic domain DTO mutation.
- Preserved selection-change guards so stale turn results do not write into a newer Workstream selection.

Verification:
- Focused: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webInteractionHttp.test.js test/webConversation.test.js test/webHttpAdapter.test.js test/webShell.test.js`
- Build: `npm run build`
- Full: `npm test`

Concerns:
- None.

## Fix Round 1

Status: complete.

Fixed:
- Added a deferred selection-change regression test for interaction success resolving after the user switches from the original Workstream to another Workstream.
- Changed interaction post-turn refresh so it always refreshes global Workstreams/NeedsOwner, requeries the original Workstream without writing it into the current detail UI, and bumps current Workstream panels/activity for the active selection.
- Added a session-leak regression test covering `session`, `sessionId`, `sessionToken`, and `session_id` variants in nested interaction result DTOs.
- Extended browser response sanitization to remove normalized `session*` fields recursively.

Verification:
- RED observed:
  - `test/webConversation.test.js`: failed on missing global Workstreams refresh after stale turn completion.
  - `test/webInteractionHttp.test.js`: failed on nested session field leak.
- Focused: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webConversation.test.js test/webInteractionHttp.test.js test/webHttpAdapter.test.js test/webShell.test.js`
- Build: `npm run build`
- Full: `npm test`

Concerns:
- None.
