# Terminal-first workspace cleanup report

Date: 2026-08-23

Status: completed in the isolated `codex/margin-pi-stage-0` worktree. This is repository-maintenance evidence, not user-validation evidence.

## Decision

Margin will validate its continuity MVP through Pi's terminal/runtime path before designing another frontend. The pinned Pi package provides a terminal UI and runtime interfaces, but it does not provide a reusable ChatGPT-style desktop web interface.

## Removed

- the complete tracked `public/` static frontend;
- the complete tracked `electron/` shell, desktop launchers, package entry, script, dependency, and lockfile records;
- frontend-specific design handoff documents and mock payloads;
- the old UI-centred `case-study/` site, screenshots, diagrams, generated PDF files, and its build/capture scripts;
- tests that existed only to verify those deleted UI or case-study artifacts.

The removal deleted 68 tracked files in commit `7263f6e`. All removals remain recoverable from Git history.

## Preserved

- `src/core/` — governed Margin State/Memory implementation;
- `src/continuity/` — deterministic context planning and cross-session harness;
- `src/runtime/pi/` — bounded Pi adapter/runtime integration;
- `evaluation/` — frozen Stage 1 fixtures and manifest;
- current Pi architecture, audit, specification, and plan records;
- legacy routes, services, and `src/storage/memoryStore.js` for temporary compatibility and later migration;
- `data/`, including local databases, exports, backups, and ignored smoke evidence.

## Runtime behavior

`src/app.js` no longer imports filesystem path helpers or registers `express.static`. `GET /api` reports `api-ready` and `Margin API is running.` The API route set remains available temporarily. The current continuity validation entry point is `npm run spike:pi-continuity`.

## Verification

The cleanup contract is covered by `test/apiOnlyRuntime.test.js`. It verifies the absence of Electron package configuration and Express static serving, and verifies the terminal-first README boundary.

Final verification commands:

```powershell
npm test
npm run validate:stage1
npm run audit:pi
git diff --check
```

## Deferred cleanup

The legacy backend is intentionally retained until a terminal workflow can create or resume a project, inspect recall provenance, and update tasks/actions through Margin Core. Before removing that compatibility layer, existing data must be inventoried and given an explicit migration, export, or archive path.
