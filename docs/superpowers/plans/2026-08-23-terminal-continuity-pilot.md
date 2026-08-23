# Terminal Continuity Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local conversational terminal pilot that records and resumes one job-application project across distinct Agent Sessions.

**Architecture:** A Pi-independent controller owns commands, project state, context planning, and sanitized traces. A narrow runtime interface supplies Session creation and prompting; the first implementation wraps the existing restricted Pi runtime. Margin Core remains replaceable and writes to an ignored pilot-only SQLite database.

**Tech Stack:** Node.js 22.23.1, ES modules, SQLite, Node readline/promises, Node test runner, `@earendil-works/pi-coding-agent@0.84.2`.

## Global Constraints

- The pilot is local-only and supports one job-application project.
- Do not read arbitrary files, access recruitment sites or email, submit applications, send messages, import records, schedule reminders, serve a frontend, or support multiple users.
- Do not activate the legacy production `/chat` route.
- Expose only `memory_search`, `memory_propose`, `state_update`, and `action_update`; keep Pi built-in tools disabled.
- Use an ignored database under `data/terminal-pilot/`; never mutate the legacy Margin database.
- Pi is the first runtime, not a permanent architecture dependency.
- Reports exclude credentials, full prompts, full conversation text, and model reasoning.

---

### Task 1: Terminal command and presentation contract

**Files:**
- Create: `src/pilot/terminalCommands.js`
- Create: `test/terminalCommands.test.js`

**Interfaces:**
- Produces: `parseTerminalInput(text)` returning `{ type: 'message', text }` or `{ type: 'command', name }` for `state`, `memory`, `new`, and `exit`.
- Produces: `formatState(snapshot)` and `formatMemory(plan)` returning bounded human-readable strings with IDs, versions, and provenance.

- [ ] **Step 1: Write failing parser and formatter tests**

Test exact command recognition, whitespace normalization, unknown slash commands as explicit `unknown_command`, empty input as `empty`, state output containing project/action IDs and versions, and memory output containing source Session/selection reason or the explicit Chinese empty-recall message `未召回相关内容`.

- [ ] **Step 2: Verify RED**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test/terminalCommands.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/pilot/terminalCommands.js`.

- [ ] **Step 3: Implement the pure contract**

Implement a closed command map and pure JSON-to-text formatters. Limit each displayed collection to ten records and replace missing values with `-`; do not include arbitrary object serialization.

- [ ] **Step 4: Verify GREEN**

Run the focused test and expect all cases to PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add terminal pilot command contract`.

### Task 2: Runtime-neutral pilot controller

**Files:**
- Create: `src/pilot/terminalPilotController.js`
- Create: `test/terminalPilotController.test.js`

**Interfaces:**
- Consumes: a Core object with `store`, `tools`, and `planContext`; a `runtime.createSession({ tools, getInvocationContext })` adapter; injected `clock` and `idFactory`.
- Produces: `createTerminalPilotController(options)` with `start()`, `handle(text)`, and `close()`.
- `handle()` returns `{ kind, text, sessionId, trace }` without writing to stdout.

- [ ] **Step 1: Write failing lifecycle tests with a fake runtime**

Assert `start()` creates or resumes one `career_project`; a message receives bounded context; `/state` and `/memory` do not invoke the model; `/new` closes Session A, creates distinct Session B, and delivers the same project context; `/exit` closes once; provider failure returns `provider_unavailable` without changing the stored action; and sanitized trace contains IDs/digests/result codes but not message text.

- [ ] **Step 2: Verify RED**

Run the controller test and expect module-not-found failure.

- [ ] **Step 3: Implement minimal controller behavior**

Create/resume a pilot project with goal `持续完成简历投递并维护投递记录`, phase `pilot`, and one active task. Use `store.getContinuitySnapshot()` and `core.planContext()` before model turns. The runtime receives a host context granting only memory read/write, state write, and action write for the active Session/project. Map runtime/storage exceptions to stable result codes; never infer successful mutations from assistant prose.

- [ ] **Step 4: Verify GREEN and Core regression**

Run the focused controller test, then `npm test`; expect all tests to PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add runtime-neutral terminal pilot controller`.

### Task 3: Restricted Pi session adapter

**Files:**
- Create: `src/runtime/pi/piTerminalPilotRuntime.js`
- Create: `test/piTerminalPilotRuntime.test.js`

**Interfaces:**
- Consumes: provider/model/custom-provider configuration, repository/agent paths, Margin tools, and `createMarginPiExtension()`.
- Produces: `createPiTerminalPilotRuntime(config)` with `createSession()` and `close()`; Session objects expose `id`, `send({ context, message })`, and `close()`.

- [ ] **Step 1: Write failing restricted-runtime tests**

Inject Pi service/session factories. Assert resource options disable extensions, skills, prompts, themes, and context files; active tools equal the four Margin tools; no built-in tool is available; invocation context binds source Session/event; and provider errors are returned without raw upstream body or credentials.

- [ ] **Step 2: Verify RED**

Run the focused adapter test and expect module-not-found failure.

- [ ] **Step 3: Implement the adapter**

Reuse `buildContinuityToolPolicy()`, `buildContinuityResourceOptions()`, and `createMarginPiExtension()`. Register a custom provider only from process-supplied configuration, use in-memory Session management, inject planned context as a hidden custom message, prompt with the user's text, and return only the assistant text plus sanitized tool result metadata.

- [ ] **Step 4: Verify GREEN and exact tool boundary**

Run the focused adapter test and `test/marginPiAdapter.test.js`; expect all cases to PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add restricted Pi terminal runtime`.

### Task 4: Interactive CLI and pilot report

**Files:**
- Create: `scripts/run-terminal-pilot.js`
- Create: `test/terminalPilotCli.test.js`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: environment configuration matching the existing YAPI/custom-provider smoke path.
- Produces: `npm run pilot:terminal`, using `data/terminal-pilot/margin-core.sqlite` and `data/terminal-pilot/report.json`.

- [ ] **Step 1: Write failing CLI contract tests**

Spawn the CLI with injected input/output and fake controller. Assert the welcome text identifies local-only permissions, commands work line-by-line, `Ctrl+C` and `/exit` call `close()`, credentials are never printed, and the report contains Session IDs, project ID, context digests, tool names, result codes, and safety checks only.

- [ ] **Step 2: Verify RED**

Run the CLI test and expect the missing script/export assertion to fail.

- [ ] **Step 3: Implement the CLI**

Use `node:readline/promises`, create the ignored pilot directory, open Margin Core with `enabled: true`, construct the Pi runtime/controller, loop over input, and write sanitized report JSON atomically. Resolve YAPI defaults exactly as the existing continuity smoke does. Return `pi_credentials_required` before opening an interactive loop when configuration is absent.

- [ ] **Step 4: Verify GREEN and non-billable suite**

Run the focused CLI test and `npm test`; expect all tests to PASS without a model call.

- [ ] **Step 5: Commit**

Commit: `feat: add interactive terminal continuity pilot`.

### Task 5: Operating guide and credential-gated hands-on check

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `docs/audit/terminal_continuity_pilot_report.md`
- Modify: `test/apiOnlyRuntime.test.js`

**Interfaces:**
- Produces: reproducible setup/use instructions and an evidence boundary for the later runtime comparison.

- [ ] **Step 1: Write failing documentation assertions**

Assert README documents `npm run pilot:terminal`, the four slash commands, local-only permission boundary, pilot database location, and the statement that Pi is not the final runtime decision.

- [ ] **Step 2: Verify RED**

Run `test/apiOnlyRuntime.test.js` and expect the new README assertions to fail.

- [ ] **Step 3: Update documentation and report template**

Document environment setup without credential values, startup/exit/retry behavior, how to reset only the explicit pilot database after user approval, and the later Pi/DeepSeek Harness/Codex evaluation dimensions. The audit report distinguishes automated evidence, a pending or completed credential-gated manual run, and prohibited product claims.

- [ ] **Step 4: Run final checks**

Run `npm test`, `npm run validate:stage1`, `npm run audit:pi`, and `git diff --check`. If credentials are present, run one `npm run pilot:terminal` hands-on Session A→`/new`→Session B flow and record only sanitized evidence; otherwise record `manual_run_pending_credentials` without claiming success.

- [ ] **Step 5: Commit**

Commit: `docs: document terminal continuity pilot`.
