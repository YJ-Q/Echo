# Terminal-first Workspace Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete Margin frontend and presentation artifacts while preserving the Pi continuity core, legacy data compatibility, and a verifiable API-only runtime.

**Architecture:** The Express application becomes API-only and no longer serves `public/`. Electron packaging and launchers are removed. Core, continuity, Pi runtime, evaluation, audit, legacy API, and all user data remain intact until a later migration-backed cleanup.

**Tech Stack:** Node.js 22, CommonJS, Express, Node test runner, npm, pinned `@earendil-works/pi-coding-agent`.

## Global Constraints

- Use Pi terminal/runtime for the pilot; do not build a replacement frontend in this change.
- Delete only explicit tracked frontend and obsolete case-study paths.
- Do not delete or modify real databases, backups, or exports.
- Keep legacy routes, services, and storage temporarily.
- Preserve all Stage 0-3 Pi/Margin Core code, evaluations, and evidence.

---

### Task 1: Lock the API-only runtime contract

**Files:**
- Create: `test/apiOnlyRuntime.test.js`
- Modify: `src/app.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `createApp(dependencies)` from `src/app.js` and root `package.json`.
- Produces: an Express API without static frontend middleware and package metadata without Electron.

- [ ] **Step 1: Write the failing test**

Create a Node test that reads `package.json` and `src/app.js`, asserting that `main`, `scripts.desktop`, and `devDependencies.electron` are absent; `src/app.js` does not contain `express.static` or `publicDir`; and the health response does not claim a desktop frontend.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/apiOnlyRuntime.test.js`

Expected: FAIL because the current package and application still expose Electron/static UI behavior.

- [ ] **Step 3: Implement the minimal API-only change**

Remove the static-directory imports/middleware and change the health copy to `Margin API is running.` Remove Electron's package entry, desktop script, and dependency using `npm uninstall --save-dev electron` so the lockfile remains consistent.

- [ ] **Step 4: Run focused test**

Run: `node --test test/apiOnlyRuntime.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `refactor: make Margin runtime API only`.

### Task 2: Remove obsolete interface and showcase artifacts

**Files:**
- Delete: `public/`
- Delete: `electron/`
- Delete: `run-echo-desktop.cmd`
- Delete: `run-margin-desktop.cmd`
- Delete: `case-study/`
- Delete: `scripts/case-study/`
- Delete: `docs/frontend-mocks/`
- Delete: `docs/BACKEND_FRONTEND_SPLIT_GUIDE.md`
- Delete: `docs/FRONTEND_API_MAPPING.md`
- Delete: `docs/FRONTEND_DEVELOPMENT_BRIEF.md`
- Delete: `docs/FRONTEND_INFORMATION_ARCHITECTURE.md`
- Delete: `docs/superpowers/plans/2026-07-26-margin-case-study.md`
- Delete: `docs/superpowers/specs/2026-07-26-margin-case-study-design.md`
- Delete: frontend/case-study-only tests identified by repository search.

**Interfaces:**
- Consumes: the approved explicit deletion inventory.
- Produces: a smaller repository without a misleading frontend or obsolete portfolio build.

- [ ] **Step 1: Record the exact tracked deletion inventory**

Use `git ls-files` for each listed directory/file and save the console result in the task trace; verify no path is under `data/`, `src/core/`, `src/continuity/`, `src/runtime/pi/`, or `evaluation/`.

- [ ] **Step 2: Delete only the verified paths**

Use the patch mechanism for individual files and validated native PowerShell removal for the explicit directories. Remove only tests whose assertions depend exclusively on deleted UI/case-study files.

- [ ] **Step 3: Search for stale references**

Run a tracked-file search for `electron`, `public/`, `case-study`, desktop launchers, and old frontend-document names. Update current README/package references if found; historical audit statements may remain when clearly historical.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/apiOnlyRuntime.test.js`

Run: `npm test`

Expected: all remaining tests PASS.

- [ ] **Step 5: Commit**

Commit message: `chore: remove obsolete Margin frontend artifacts`.

### Task 3: Refresh operating documentation and verify protected assets

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `docs/audit/terminal_first_cleanup_report.md`

**Interfaces:**
- Consumes: the cleaned repository and existing Stage 0-3 commands.
- Produces: terminal-first instructions and an auditable keep/delete record.

- [ ] **Step 1: Write documentation assertions**

Extend `test/apiOnlyRuntime.test.js` to assert that README contains the Pi terminal/continuity command and does not instruct users to launch Electron or a bundled web UI.

- [ ] **Step 2: Verify the new assertion fails**

Run: `node --test test/apiOnlyRuntime.test.js`

Expected: FAIL until README is updated.

- [ ] **Step 3: Update documentation**

Document terminal-first status, explain that Pi has no reusable desktop web UI, retain API compatibility instructions, and write an audit report listing deleted categories, protected paths, deferred legacy backend scope, and verification commands.

- [ ] **Step 4: Run final verification**

Run: `npm test`

Run: `npm run validate:stage1`

Run: `npm run audit:pi`

Run: `git diff --check`

Expected: every command succeeds; no deleted frontend files remain; `data/` and all Pi/Margin Core paths remain present.

- [ ] **Step 5: Commit**

Commit message: `docs: record terminal-first cleanup`.
