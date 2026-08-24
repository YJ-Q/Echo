# Margin Phase 2B Final Fix Report

Date: 2026-08-24
Scope: five Important findings from the final branch review only
Baseline HEAD before this wave: `4304632`
Final fix commit: pending

## Scope and outcome

This wave keeps the frozen Phase 1, Phase 2A, and Phase 2B Core semantics intact while correcting the final Workbench review findings:

1. Docker publishes host port 3000 only on `127.0.0.1`; the container listener remains `0.0.0.0`.
2. The HTTP boundary recognizes every known safe Application error code, preserves safe retryability, maps conflicts to 409 and storage/runtime availability failures to 503, and carries only bounded `version_conflict.details.currentVersion` detail.
3. The real App implements the frozen three-column IA: Workstreams; fixed Current Workstream summary with Conversation, Artifacts, and Activity tabs; and Control and Context with Run controls/status, current plan, next action, and unresolved NeedsOwner.
4. Activity retains the selected Workstream cursor and dedup state across authority refresh tokens. Refresh tokens poll immediately from the retained cursor; only a Workstream selection change resets cursor and Activity display.
5. The non-model E2E mounts the real App against an ephemeral HTTP listener and real Core, uses DOM interactions for Workstream creation/selection, Run controls, tabs, NeedsOwner resolution, and restart/reopen, and retains fake-runtime and persistence coverage.

No Core schema, repository, Application Contract, Phase 1, or Phase 2A behavior was changed.

## RED evidence

### Aggregate transport/client RED

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webWorkbenchComposition.test.js test/webHttpAdapter.test.js test/webApiClient.test.js test/webShell.test.js test/webRunActivity.test.js test/phase2bWebE2E.test.js
```

Observed expected failures before production edits:

- API client expected `open_run_conflict` but received collapsed `storage_failure`.
- HTTP mapping expected `capability_required` 403 but received 500.
- Safe error preservation expected `{code:'version_conflict', retryable:true, details:{currentVersion:7}}` but received retryable false with no details.
- Real Core idempotency conflict expected 409 but received 500.
- The initial mounted E2E could not find the new Activity tab.

The first aggregate RED runner was stopped after the relevant failures were recorded because a deliberately failing shell assertion exited before cleanup and left an Activity timer open. The test cleanup was placed in `finally` before subsequent RED/GREEN runs; this was test-harness correction, not a product change.

### Docker composition RED

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test --test-name-pattern="package, Docker" test/webWorkbenchComposition.test.js
```

Result: 0 passed, 1 failed. The expected `127.0.0.1:3000:3000` mapping was absent and the source still contained `3000:3000`.

### Three-column IA RED

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webShell.test.js
```

Result: 3 passed, 3 failed. The initial tab was `overview`; regions were Workstreams/Workbench/Activity; and Current Workstream/Control and Context plus tab structure were absent.

### Cursor retention RED

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webWorkbenchComposition.test.js test/webShell.test.js test/webRunActivity.test.js
```

The focused refresh-token subtest failed with actual `afterCursor` values `[0,0,0]` instead of `[3,3,3]`, proving routine authority refresh replayed selected Workstream history.

### Real mounted App E2E RED

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/phase2bWebE2E.test.js
```

After correcting the harness to wait for enabled Run buttons, result was 0 passed, 1 failed at `Missing or disabled DOM control: [data-workbench-tab="activity"]`. Before that point the mounted App had already created/selected a real Workstream and created, started, paused, and resumed a real persisted Run through DOM controls.

## GREEN evidence

### Focused fix and regression suite

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/webWorkbenchComposition.test.js test/webHttpAdapter.test.js test/webApiClient.test.js test/webShell.test.js test/webRunActivity.test.js test/webWorkstreams.test.js
```

Result: 51 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo.

This includes real Core -> Web Gateway -> HTTP idempotency, version, invalid transition, `open_run_exists`, and `open_run_conflict` coverage; safe envelope coverage; composition publication assertions; tab interaction/structure; and cursor/dedup retention across three authority refresh tokens.

### Real mounted App restart E2E

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/phase2bWebE2E.test.js
```

Result: 1 passed, 0 failed, with no React act warnings.

The test uses a real Core, fake runtime, ephemeral HTTP listener, real API client, and real App mounted in JSDOM. DOM interactions cover Workstream creation/selection, Run create/start/pause/resume, Activity and Artifact tabs, reopened Run controls, NeedsOwner resolution, and stop. Direct API setup is limited to Artifact and NeedsOwner creation because Phase 2B intentionally has no browser creation control for those objects. Final assertions cover cancelled Run, resolved NeedsOwner, persisted Artifact, strict unique increasing cursors, Activity/Event cursor agreement, runtime halt evidence, empty browser storage, and absence of `echo.sqlite`.

## Full validation

### Web build

Command: `npm run build`

Result: exit 0. Vite 7.3.6 transformed 37 modules and produced `dist/index.html`, CSS, and JavaScript assets.

### Complete test suite

Command: `npm test`

Result: exit 0; 467 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. Duration: 9.20 seconds.

### Stage 1 fixtures

Command: `npm run validate:stage1`

Result: exit 0; `ok:true`, protocol 1.0.0, 10/10 total, five `career_project`, five `learning_research`, manifest bound.

### Pi audit

Command: `npm run audit:pi`

Result: exit 0; `ok:true`, Pi package/installed version 0.84.2, MIT, Node/runtime 22.23.1, no failures.

### Focused Phase 1/2A/2B regression

Command:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/terminalPersistentRestart.test.js test/phase2aContractE2E.test.js test/phase2aPersistence.test.js test/webWorkbenchComposition.test.js test/phase2bWebE2E.test.js test/phase2bLiveEvidence.test.js
```

Result: 28 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo.

### Source/staging checks

`git diff --check`: exit 0, no whitespace errors; only Git CRLF conversion notices were emitted.

The exact staged file list, `git diff --cached --check`, and final status were reviewed immediately before commit.

## Independent read-only review

The mandatory independent review reported:

- Critical: none.
- Important: none.
- Minor: the acceptance report contains `PENDING_FINAL_FIX_HEAD` while declaring validation complete.
- Verdict: ready on correctness, security, regression, and test validity after final documentation handling.

The pending marker is retained because the task explicitly permits a pending HEAD marker when the exact final commit cannot be known before committing the report itself. It no longer falsely identifies the prior Task 8 commit as HEAD.

## Documentation reconciliation

`docs/validation/phase_2b_acceptance_report.md` now:

- uses `82394b9..PENDING_FINAL_FIX_HEAD` rather than falsely naming the prior Task 8 commit as HEAD;
- records Docker container binding separately from loopback-only host publication;
- describes the real mounted-App DOM E2E;
- records 467 full tests and 28 focused tests;
- records the complete safe HTTP error semantics;
- records the two deferred Minor findings honestly.

## Concerns and deferred Minors

- Successful assistant text above 2,000 characters still becomes an empty display message rather than explicit truncation. This was not changed because it is a reviewed Minor outside the five-item final fix wave.
- The process-local runtime operation replay cache remains lifetime-unbounded. It is not authoritative Workstream state, but bounding it requires a separate test-first policy decision and was not added opportunistically.
- The Live Pi E2E was not rerun during this final fix wave. The existing acceptance result and recursive evidence guard remain intact; this wave did not read, print, or modify Live evidence/model text.
- No screenshot was added; the environment still has no configured browser screenshot tooling. JSDOM structure/interaction and the production build are green.

No merge, push, Phase 3, Feishu, Scheduler, Worker, Live evidence disclosure, or model text disclosure occurred.
