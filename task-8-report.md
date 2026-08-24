# Task 8 Report

Status: complete.

- Implemented the Phase 2B Web Workbench composition, production/development entrypoints, legacy gate, safe Live-evidence runner, and acceptance material.
- TDD evidence: the Docker bind override was added only after its new composition assertion failed, then passed. The worktree already contained uncommitted Task 8 implementation and focused tests when work began; those files were preserved and independently verified rather than overwritten.
- Validation: build passed; full suite passed 461/461; Stage 1 passed 10/10; Pi audit passed; focused Phase 1/2A/2B suite passed 27/27; git diff --check passed.
- Live result: process YAPI_API_KEY was present/non-empty (value not read into output); real isolated Live Pi HTTP E2E passed with sanitized ignored evidence.
- Concern: browser screenshot tooling was not available. No Phase 3, Feishu, Scheduler, or Worker scope was started.

## Recovery Verification (2026-08-24)

- Recovered the uncommitted Task 8 worktree after the prior completion report. Inspected the brief, all tracked and untracked Task 8 changes, source boundaries, ignored Live evidence, and acceptance material. No production correction was required, so no new TDD cycle was applicable during recovery.
- `npm test`: exit 0; 461 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo.
- `npm run build`: exit 0; Vite production distribution built successfully.
- `npm run validate:stage1`: exit 0; 10/10 fixtures and manifest binding passed.
- `npm run audit:pi`: exit 0; Pi 0.84.2 and Node 22.23.1 baseline passed with no audit failures.
- Focused Phase 1/2A/2B restart, reconciliation, composition, Web E2E, and Live-evidence checks: exit 0; 27 passed, 0 failed.
- Reused the existing ignored `data/phase2b-live/latest.json` only after confirming that it contains the allowed final status, Pi version, Margin identifiers, versions, cursors, and stable result code. It records `passed`; no credentialed Live interaction was rerun and no key, prompt, model response, Pi object, or reasoning content was read into this report.
- `git diff --check`: exit 0; no whitespace errors. The expected Git line-ending notices were non-failing.

## Fix Round 1 (2026-08-24)

- Finding: development Vite middleware intercepted `/api/*` before the HTTP adapter, returning SPA HTML to API clients.
- TDD RED: added `development routes health, commands, queries, and events before the Vite SPA fallback` in `test/webWorkbenchComposition.test.js`; `& .\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webWorkbenchComposition.test.js` exited 1 with `Unexpected token '<'`, because `/api/health` returned the synthetic Vite HTML fallback.
- Fix: `src/http/createWebHttpAdapter.js` now bypasses `/api/*` only for Vite middleware. API route order, browser envelope handling, Core boundaries, and static middleware behavior remain unchanged.
- TDD GREEN: `& .\\.runtime\\node-v22.23.1-win-x64\\node.exe --test test/webWorkbenchComposition.test.js test/webHttpAdapter.test.js` exited 0; 20 passed, 0 failed. The development regression exercises health, command, query, and event routes against an injected SPA fallback.
- Final validation: `npm test` exited 0; 462 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. `npm run build` exited 0; Vite production build completed.
