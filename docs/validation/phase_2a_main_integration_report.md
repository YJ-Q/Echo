# Phase 2A Main Integration Validation Report

Date: 2026-08-24  
Branch: `codex/phase2a-main-integration`  
Pre-report verification HEAD: `b3c2861fdce3c2d1c139e484f2acfc11c87aea06`

## Authoritative baseline and strategy

`88df600ec30152afeb5cb82dfc0fc29672c3a8cf` is the accepted V1 product and architecture baseline. Its Persistent Core is the only V1 current-state source of truth and its transport-neutral Application Gateway is the only Surface contract. Integration started at local `main` commit `49da495c77f9a40534a828e8f0aba4b6f05fe43f`, then retained both histories in two-parent merge `ba7d5ae67c5d6d0d04c51ad0d1954202ad83fcf8`. The resolved runtime tree follows the accepted Phase 2A baseline; no Phase 2B work is included.

Integration commits through the pre-report verification HEAD:

| Commit | Purpose |
| --- | --- |
| `49da495` | updated local-main starting point |
| `dda3d40` | integration plan |
| `de83e72` | integration-boundary test |
| `781153d` | boundary-test isolation |
| `ba7d5ae` | history-preserving Phase 2A baseline merge |
| `2c88e74` | accepted documentation restoration |
| `c64abd3` | obsolete-artifact inventory refinement |
| `b3c2861` | obsolete frontend-product artifact removal |

## Unique remote-main assessment

The accepted Phase 2A branch already contained remote history through `18f7f13`; `49da495` was the only then-current remote-main unique commit. Its 124-file change is a coupled React/Electron/legacy-Express desktop migration. No code from that unique change was copied into the V1 runtime tree. It remains as an ancestor through the normal two-parent merge, not through reimplementation.

There are no non-frontend changes uniquely retained from `49da495`; earlier shared history remains retained. Naming and environment compatibility needed by V1 were already present more fully in the accepted baseline.

## Removed desktop/UI scope

No tracked `frontend/`, `electron/`, or `public/` directory remains. The removed implementation scope is React frontend, Electron desktop host/preload/settings, and static UI assets. `test/v1IntegrationBoundary.test.js` asserts the directory absence, no Electron main entry, no frontend scripts/dependencies, and terminal pilot startup.

The 16 deleted obsolete UI/product document categories are:

1. current UI design specification (HTML)
2. current UI design specification (Markdown)
3. design imagery
4. design-spec component mapping
5. development execution guide
6. dialogue rhythm
7. Gemini now-page HTML relay
8. now-page information architecture
9. now-page wireframe specification
10. current UI preview
11. Gemini design preview (HTML)
12. Gemini design preview (image)
13. Margin component UI specification
14. Margin design language
15. V2 product positioning
16. voice and guardrails

## Source of truth, legacy boundary, and shadow-state assessment

The V1 default database is `data/terminal-pilot/margin-core.sqlite`: `scripts/run-terminal-pilot.js` constructs that exact path before `createMarginCore`. `README.md` and `docs/audit/legacy_data_disposition.md` designate it as the only V1 source of truth for Workstream, Run, Event, Decision, Artifact, Checkpoint, Memory, and Action state.

`data/echo.sqlite` is a frozen legacy dataset, documented in `docs/audit/legacy_data_disposition.md`. Old Express is an explicit transition command only (`npm run legacy:api`); `package.json` maps both `start` and `dev` to `npm run pilot:terminal`. Its removal gate is: completed export, table-by-table user decision, and verification of each approved migration against IDs and counts.

Static review found no V1 reference to `echo.sqlite` under `src/core/`, `src/application/`, `src/pilot/`, or `scripts/run-terminal-pilot.js`; V1 startup opens one Margin Core database. Thus no V1 code writes both databases and legacy Express is not the default. This is a single-source-of-truth/no-double-write assessment, not deletion of legacy code or data.

`src/application/marginApplicationContract.js` returns a frozen Gateway containing only `execute`, `query`, and `events`. In `src/pilot/terminalPilotController.js`, persistent Workstream, Run, and Checkpoint reads and controls use its Gateway-backed `query` and `execute` helpers. `test/terminalApplicationContract.test.js` verifies this routing boundary.

## Validation results

Focused command, using pinned Node 22.23.1:

```powershell
& .\.runtime\node-v22.23.1-win-x64\node.exe --test test/terminalPersistentRestart.test.js test/runControl.test.js test/persistentWorkServices.test.js test/persistentCoreMigrations.test.js test/phase2aContractE2E.test.js test/phase2aPersistence.test.js test/applicationContractCommands.test.js test/applicationContractQueries.test.js test/applicationContractEvents.test.js test/terminalApplicationContract.test.js test/apiOnlyRuntime.test.js test/v1IntegrationBoundary.test.js
```

Result: 12 files; 90 tests passed; 0 failed, cancelled, skipped, or todo.

| Command | Exact result |
| --- | --- |
| `npm test` | 373 tests passed; 0 failed, cancelled, skipped, or todo. |
| `npm run validate:stage1` | passed: `ok=true`, protocol `1.0.0`, 10 fixtures (`career_project=5`, `learning_research=5`), manifest bound. |
| `npm run audit:pi` | passed: Pi `0.84.2`, pinned runtime Node `22.23.1`, no failures. |
| `git diff --check` | passed with exit code 0 and no output. |

## Known risks and boundary

Legacy Echo/Express code and `data/echo.sqlite` deliberately remain for frozen inventory, export, compatibility, and regression-test value. They remain technical debt until the removal gate is satisfied.

The accepted Phase 2A runtime and SQLite transaction limitations remain: local SQLite coordination and runtime activation/halt boundaries provide the tested retry, idempotency, rollback, and recovery guarantees, not a distributed scheduler or exactly-once external-runtime protocol. No HTTP adapter, web workbench, Feishu, scheduler, Codex worker, or other Phase 2B capability was started.

## Static evidence paths

- `scripts/run-terminal-pilot.js`
- `src/core/createMarginCore.js`
- `src/application/marginApplicationContract.js`
- `src/pilot/terminalPilotController.js`
- `package.json`
- `README.md`
- `docs/audit/legacy_data_disposition.md`
- `test/apiOnlyRuntime.test.js`
- `test/terminalApplicationContract.test.js`
- `test/v1IntegrationBoundary.test.js`
- `docs/superpowers/specs/2026-08-24-phase2a-main-integration-design.md`

