# Phase 2A Main Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the accepted Phase 1/Phase 2A V1 baseline into local `main`, remove obsolete frontend/product-direction assets, and prove the Persistent Core and Application Contract remain authoritative.

**Architecture:** Create one history-preserving two-parent integration merge whose resolved tree follows accepted commit `88df600ec30152afeb5cb82dfc0fc29672c3a8cf`. Do not port the unique `49da495` React/Electron migration; add only a narrow cleanup commit for obsolete UI documents and an integration report.

**Tech Stack:** Git, Node.js 22, Node test runner, SQLite, Pi Agent SDK 0.84.2, Markdown.

## Global Constraints

- One Core, Multiple Surfaces.
- Stable State, Replaceable Runtime.
- `data/terminal-pilot/margin-core.sqlite` is the only V1 current-state Source of Truth.
- `data/echo.sqlite` remains frozen legacy; no new V1 write or compatibility restoration is allowed.
- Application Gateway remains exactly `execute`, `query`, and `events`.
- Preserve Phase 1 and Phase 2A commit history; do not squash.
- Old React, Electron, static UI, UI adapters, and UI-only product documents are deleted, not made compatible.
- Do not begin Phase 2B.

---

### Task 1: Freeze the integration boundary with a failing test

**Files:**
- Create: `test/v1IntegrationBoundary.test.js`

**Interfaces:**
- Consumes: repository filesystem and `package.json`.
- Produces: a regression guard proving no bundled React/Electron/static Surface can become the default runtime.

- [ ] **Step 1: Write the failing boundary test**

Create a Node test that checks `frontend/`, `electron/`, and `public/` do not
exist; that `package.json` has no React, Vite, Electron, desktop, or UI build
entry; and that `start` points to `pilot:terminal`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/v1IntegrationBoundary.test.js`  
Expected: FAIL because commit `49da495` still contains the old frontend and
desktop dependencies.

- [ ] **Step 3: Commit the failing contract test**

Run:

```powershell
git add test/v1IntegrationBoundary.test.js
git commit -m "test: freeze phase2a integration boundary"
```

### Task 2: Create the history-preserving authoritative merge

**Files:**
- Merge from: commit `88df600ec30152afeb5cb82dfc0fc29672c3a8cf`
- Preserve: `docs/superpowers/specs/2026-08-24-phase2a-main-integration-design.md`
- Preserve: `docs/superpowers/plans/2026-08-24-phase2a-main-integration.md`
- Preserve: `test/v1IntegrationBoundary.test.js`

**Interfaces:**
- Consumes: accepted Phase 2A Git tree and Task 1 regression guard.
- Produces: a two-parent merge commit whose runtime tree is the accepted V1 baseline plus this integration’s plan and test.

- [ ] **Step 1: Start a non-fast-forward, no-commit merge**

Run:

```powershell
git merge --no-ff --no-commit 88df600ec30152afeb5cb82dfc0fc29672c3a8cf
```

Expected: conflicts limited to the known old-frontend versus V1 divergence.

- [ ] **Step 2: Resolve the merge to the accepted Phase 2A tree**

Reset the merge index and working tree to the accepted Phase 2A tree, then
restore the three integration-owned files from the pre-merge integration HEAD.
Verify that `MERGE_HEAD` still names `88df600...` before committing.

- [ ] **Step 3: Verify GREEN before committing**

Run:

```powershell
node --test test/v1IntegrationBoundary.test.js
npm test
npm run validate:stage1
npm run audit:pi
git diff --check --cached
```

Expected: boundary test PASS, full suite PASS, Stage 1 reports 10/10, Pi audit
reports success, and diff check is clean.

- [ ] **Step 4: Commit the merge**

Run:

```powershell
git commit -m "merge: establish phase2a persistent core baseline"
```

### Task 3: Remove obsolete UI product documents

**Files:**
- Delete: `docs/CURRENT_UI_DESIGN_SPEC.html`
- Delete: `docs/CURRENT_UI_DESIGN_SPEC.md`
- Delete: `docs/DESIGN_IMAGERY.md`
- Delete: `docs/DESIGN_SPEC_COMPONENT_MAPPING.md`
- Delete: `docs/DEVELOPMENT_EXECUTION_GUIDE.md`
- Delete: `docs/DIALOGUE_RHYTHM.md`
- Delete: `docs/GEMINI_NOW_PAGE_HTML_RELAY.md`
- Delete: `docs/NOW_PAGE_INFORMATION_ARCHITECTURE.md`
- Delete: `docs/NOW_PAGE_WIREFRAME_SPEC.md`
- Delete: `docs/current-ui-preview.png`
- Delete: `docs/gemini-design-preview.html`
- Delete: `docs/gemini-design-preview.png`
- Delete: `docs/margin-component-ui-spec.html`
- Modify: `test/v1IntegrationBoundary.test.js`

**Interfaces:**
- Consumes: merged V1 tree.
- Produces: a repository without obsolete UI design artifacts while retaining technical audit and migration history.

- [ ] **Step 1: Extend the boundary test and verify RED**

Add the exact obsolete document list above to the absence assertions. Run
`node --test test/v1IntegrationBoundary.test.js` and expect failure while the
documents remain.

- [ ] **Step 2: Delete only the listed documents**

Use `apply_patch` for text files and `git rm` for tracked binary previews. Do
not delete architecture, audit, migration, Phase 1, or Phase 2A records.

- [ ] **Step 3: Verify GREEN and references**

Run the boundary test, then search non-historical current docs for references to
the deleted files. References inside committed historical implementation plans
may remain as historical facts.

- [ ] **Step 4: Commit cleanup**

Run:

```powershell
git add test/v1IntegrationBoundary.test.js docs
git commit -m "chore: remove obsolete frontend product artifacts"
```

### Task 4: Validate the integrated V1 baseline and report

**Files:**
- Create: `docs/validation/phase_2a_main_integration_report.md`

**Interfaces:**
- Consumes: Tasks 1–3 and existing Phase 1/Phase 2A tests.
- Produces: reproducible integration evidence and explicit remaining legacy debt.

- [ ] **Step 1: Run focused Persistent Core and Contract validation**

Run focused Node tests covering persistent restart, run control, Application
Contract commands/queries/events, Phase 2A persistence/E2E, terminal Contract,
event cursor, idempotency, and optimistic concurrency. Expected: all PASS.

- [ ] **Step 2: Run complete validation**

Run:

```powershell
npm test
npm run validate:stage1
npm run audit:pi
git diff --check
git status --short
```

Expected: full suite PASS, Stage 1 10/10, Pi audit success, no whitespace
errors, and only the uncommitted report before its commit.

- [ ] **Step 3: Write and commit the integration report**

Record deleted UI/code/doc categories, the decision not to port `49da495`,
legacy Echo/Express debt, Source-of-Truth and no-shadow-state checks, exact test
results, and commit IDs.

Run:

```powershell
git add docs/validation/phase_2a_main_integration_report.md
git commit -m "docs: record phase2a main integration"
```

### Task 5: Merge into local main and revalidate

**Files:**
- Modify through Git merge only: local branch `main`.

**Interfaces:**
- Consumes: verified `codex/phase2a-main-integration`.
- Produces: clean local `main` at the accepted integrated V1 baseline.

- [ ] **Step 1: Merge without squashing**

Switch to `main` and merge `codex/phase2a-main-integration` with `--no-ff` if a
fast-forward is not already structurally sufficient. Do not rewrite Phase 1 or
Phase 2A commits.

- [ ] **Step 2: Run post-merge validation**

Run `npm test`, `npm run validate:stage1`, `npm run audit:pi`,
`git diff --check`, and `git status --short`. Expected: all checks pass and the
working tree is clean.

- [ ] **Step 3: Stop before Phase 2B**

Report local `main` HEAD, integration commit, exact test results, conflicts,
legacy debt, shadow-state assessment, and clean status. Do not create Phase 2B
files or implementation.
