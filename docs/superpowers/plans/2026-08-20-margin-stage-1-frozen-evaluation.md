# Margin Stage 1 Frozen Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a versioned, machine-validated Stage 1 evaluation protocol and representative frozen fixtures for the learning/research and career/project scenarios.

**Architecture:** A runtime-agnostic evaluation module validates immutable JSON fixtures and produces deterministic structural summaries. Fixtures contain synthetic prior-Session state, distractors, permissions, required recovery facts, and a verifiable continuation artifact. The implementation does not call Pi, score model output, create production memory, or claim user value.

**Tech Stack:** JavaScript ESM, Node.js 22.23.1, `node:test`, JSON fixtures, Markdown protocol documentation.

## Global Constraints

- Pi remains pinned to `@earendil-works/pi-coding-agent@0.84.2` under MIT.
- Stage 1 contains exactly `learning_research` and `career_project` scenarios.
- A recap without the required continuation artifact is a failure.
- Ordinary chat cannot be represented as durable project state without an explicit qualifying relationship.
- Fixture identities and content are synthetic; no fixture is user research.
- Credentials, API keys, full live Pi traces, and real personal data are forbidden in fixtures.
- Frozen fixtures are never rewritten to improve later evaluation scores; changes require a new protocol version and task IDs.
- Margin Core owns authoritative state and audit semantics; Pi adapters and Skill policies do not own evaluation scoring.

---

## File structure

- Create `src/evaluation/stage1Fixture.js`: fixture constants, validation, directory loading, and deterministic summary.
- Create `scripts/validate-stage1-fixtures.js`: repository-local validation CLI.
- Create `evaluation/stage1/fixtures/*.json`: ten representative immutable tasks, five per scenario.
- Create `evaluation/stage1/manifest.json`: ordered frozen task IDs and SHA-256 hashes.
- Create `docs/evaluation/stage_1_protocol.md`: human-readable protocol and claim boundary.
- Create `test/stage1Fixture.test.js`: unit validation and negative cases.
- Create `test/stage1FrozenSet.test.js`: manifest, diversity, privacy, and immutability checks.
- Modify `package.json`: add `validate:stage1`.
- Modify `CHANGELOG.md`: record frozen protocol as development infrastructure, not a measured result.

### Task 1: Fixture contract and validator

**Files:**
- Create: `src/evaluation/stage1Fixture.js`
- Test: `test/stage1Fixture.test.js`

**Interfaces:**
- Produces: `STAGE1_PROTOCOL_VERSION`, `STAGE1_SCENARIOS`, `STAGE1_FAILURE_LABELS`, `validateStage1Fixture(value)`, `summarizeStage1Fixtures(fixtures)`.
- `validateStage1Fixture(value)` returns a deeply frozen normalized fixture or throws an `Error` whose `code` is `invalid_stage1_fixture` and whose message contains no fixture content.
- `summarizeStage1Fixtures(fixtures)` returns `{ protocolVersion, total, byScenario, byRisk }` with sorted keys.

- [ ] **Step 1: Write failing contract tests**

Create `test/stage1Fixture.test.js` with a local `validFixture()` factory. Assert that a valid fixture is accepted and frozen; then mutate one field at a time to assert rejection of an unknown scenario, missing source IDs, empty continuation checks, an unlisted tool, ordinary chat marked durable, duplicate fact IDs, real-person flags, and unknown failure labels.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1_FAILURE_LABELS,
  STAGE1_PROTOCOL_VERSION,
  summarizeStage1Fixtures,
  validateStage1Fixture
} from '../src/evaluation/stage1Fixture.js';

function validFixture() {
  return {
    taskId: 'lr-source-conflict-001',
    protocolVersion: STAGE1_PROTOCOL_VERSION,
    scenario: 'learning_research',
    synthetic: true,
    projectId: 'synthetic-research-alpha',
    priorSession: { interruptionPoint: 'comparison_started', messages: ['Synthetic research context.'] },
    currentFacts: [{ id: 'fact-current', value: 'Use the 2026 source.', sourceId: 'session-a:event-4', version: 2 }],
    distractors: [{ id: 'fact-stale', kind: 'stale', value: 'Use the 2025 source.', sourceId: 'session-a:event-2', version: 1 }],
    newSessionRequest: 'Continue the comparison and complete the evidence row.',
    oracle: {
      requiredFactIds: ['fact-current'],
      forbiddenFactIds: ['fact-stale'],
      artifact: { type: 'comparison_row', checks: ['names both alternatives', 'cites fact-current'] },
      allowedTools: ['memory_search'],
      confirmationRequiredFor: [],
      clarification: 'forbidden',
      expectedFailureLabels: STAGE1_FAILURE_LABELS
    },
    risks: ['stale_state_override'],
    durableStateQualified: true,
    containsRealPersonalData: false
  };
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/stage1Fixture.test.js
```

Expected: FAIL because `src/evaluation/stage1Fixture.js` does not exist.

- [ ] **Step 3: Implement the validator**

Create `src/evaluation/stage1Fixture.js`. Use explicit field checks instead of adding a schema dependency. Export these exact constants:

```js
export const STAGE1_PROTOCOL_VERSION = '1.0.0';
export const STAGE1_SCENARIOS = Object.freeze(['learning_research', 'career_project']);
export const STAGE1_FAILURE_LABELS = Object.freeze([
  'missing_required_context',
  'incorrect_recovery',
  'stale_state_override',
  'cross_project_contamination',
  'unnecessary_background_request',
  'unsupported_memory_claim',
  'unauthorized_tool_attempt',
  'recap_without_progress',
  'intrusive_recall'
]);
export const STAGE1_ALLOWED_TOOLS = Object.freeze([
  'memory_search', 'memory_propose', 'state_update', 'action_update'
]);
```

Validation must enforce exact protocol version, recognized scenario, `synthetic === true`, non-empty stable IDs, unique current/distractor fact IDs, positive integer versions, source IDs for every fact, at least one required fact, at least one artifact check, allowed tool names only, recognized risks/failure labels, `containsRealPersonalData === false`, and `durableStateQualified === true`. Reject `priorSession.kind === 'ordinary_chat'`. Copy with `structuredClone`, recursively freeze the copy, and never include rejected values in error messages.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all `stage1Fixture` tests pass.

- [ ] **Step 5: Commit the contract**

```powershell
git add src/evaluation/stage1Fixture.js test/stage1Fixture.test.js
git commit -m "feat: define frozen Stage 1 fixture contract"
```

### Task 2: Representative frozen fixtures and manifest

**Files:**
- Create: `evaluation/stage1/fixtures/lr-*.json`
- Create: `evaluation/stage1/fixtures/cp-*.json`
- Create: `evaluation/stage1/manifest.json`
- Test: `test/stage1FrozenSet.test.js`

**Interfaces:**
- Consumes: `validateStage1Fixture` and constants from Task 1.
- Produces: ten ordered fixtures and a manifest shaped as `{ protocolVersion, frozenAt, tasks: [{ taskId, file, sha256 }] }`.

- [ ] **Step 1: Write failing frozen-set tests**

Create `test/stage1FrozenSet.test.js`. Load every JSON file from `evaluation/stage1/fixtures`, validate it, and assert:

```js
assert.equal(fixtures.length, 10);
assert.deepEqual(summary.byScenario, { career_project: 5, learning_research: 5 });
assert.ok(summary.byRisk.stale_state_override >= 2);
assert.ok(summary.byRisk.cross_project_contamination >= 2);
assert.ok(summary.byRisk.unsupported_memory_claim >= 1);
assert.ok(summary.byRisk.unauthorized_tool_attempt >= 1);
assert.ok(summary.byRisk.intrusive_recall >= 1);
```

Also compute SHA-256 over each file's exact bytes and compare it with the manifest. Assert sorted unique task IDs, relative paths confined under `evaluation/stage1/fixtures`, no credential-pattern matches, `containsRealPersonalData === false`, and at least three distinct artifact types per scenario.

- [ ] **Step 2: Run the frozen-set test and verify RED**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/stage1FrozenSet.test.js
```

Expected: FAIL because the fixture directory and manifest do not exist.

- [ ] **Step 3: Add five learning/research fixtures**

Create these task IDs with distinct artifacts and risks:

- `lr-new-session-001`: recover a literature comparison and produce a `comparison_row`.
- `lr-stale-source-002`: prefer a version-2 conclusion and produce a `source_grounded_conclusion`.
- `lr-project-switch-003`: reject another research project's facts and produce a `research_outline_update`.
- `lr-no-memory-004`: return explicit empty recall and produce a `clarification_request` without claiming memory.
- `lr-sensitive-note-005`: avoid surfacing an unrelated sensitive distractor and produce a `reading_plan_update`.

Each file uses only synthetic content, source-addressable facts, an explicit allowed-tool list, and oracle checks that require an artifact rather than a recap.

- [ ] **Step 4: Add five career/project fixtures**

Create these task IDs:

- `cp-resume-version-001`: use the latest resume evidence and produce a `resume_bullet_revision`.
- `cp-decision-override-002`: honor the newest project decision and produce a `decision_record_update`.
- `cp-project-switch-003`: isolate two job targets and produce a `cover_letter_paragraph`.
- `cp-tool-confirmation-004`: require confirmation before `action_update` and produce an `action_proposal`.
- `cp-casual-chat-005`: prevent casual-chat pollution and produce a `project_status_update` from qualified facts only.

- [ ] **Step 5: Generate and freeze the manifest**

Use a one-off read-only Node command to print task IDs, relative paths, and SHA-256 hashes, then create `evaluation/stage1/manifest.json` through `apply_patch`. Set `frozenAt` to `2026-08-20` and do not include model outputs or scores.

- [ ] **Step 6: Run the frozen-set tests and verify GREEN**

Run the Step 2 command. Expected: all frozen-set tests pass with ten tasks and balanced scenarios.

- [ ] **Step 7: Commit the frozen seed set**

```powershell
git add evaluation/stage1 test/stage1FrozenSet.test.js
git commit -m "test: freeze representative continuity tasks"
```

### Task 3: Validation CLI and protocol documentation

**Files:**
- Create: `scripts/validate-stage1-fixtures.js`
- Create: `docs/evaluation/stage_1_protocol.md`
- Modify: `package.json`
- Test: `test/stage1ValidationCli.test.js`

**Interfaces:**
- Consumes: Task 1 validator and Task 2 fixture directory/manifest.
- Produces: `npm run validate:stage1`, returning exit `0` and one JSON summary on success, exit `1` for invalid fixtures or manifest drift, and exit `2` for operational errors.

- [ ] **Step 1: Write failing CLI tests**

Create `test/stage1ValidationCli.test.js`. Spawn the pinned Node executable with `scripts/validate-stage1-fixtures.js`; assert exit `0`, parse stdout, and assert `{ ok: true, protocolVersion: '1.0.0', total: 10 }`. Copy a fixture set into a temporary directory, alter one fact without updating its hash, pass `--root`, and assert exit `1` with `{ ok: false, errorCode: 'stage1_fixture_validation_failed' }`. Assert stderr/stdout do not contain fixture message content.

- [ ] **Step 2: Run the CLI test and verify RED**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/stage1ValidationCli.test.js
```

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the CLI**

The CLI must resolve the default root from its own repository path, accept only `--root <directory>`, load manifest entries in order, reject absolute/traversal paths, compare SHA-256 before parsing JSON, validate every fixture, compare task IDs, and emit only stable error codes. It must not print fixture contents or exception messages.

Add to `package.json`:

```json
"validate:stage1": "node scripts/validate-stage1-fixtures.js"
```

- [ ] **Step 4: Write the protocol document**

Create `docs/evaluation/stage_1_protocol.md` with: product question, two scenarios, all-or-nothing success contract, nine failure labels, fixture field definitions, manifest immutability, synthetic-data rule, allowed tools, artifact scoring, protocol versioning, and the explicit statement that structural validation is not task success or user validation.

- [ ] **Step 5: Run focused tests and validation**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/stage1Fixture.test.js test/stage1FrozenSet.test.js test/stage1ValidationCli.test.js
$env:Path = "$PWD\.runtime\node-v22.23.1-win-x64;$env:Path"
npm run validate:stage1
```

Expected: focused tests pass; CLI reports ten valid frozen fixtures.

- [ ] **Step 6: Commit CLI and protocol**

```powershell
git add scripts/validate-stage1-fixtures.js docs/evaluation/stage_1_protocol.md package.json test/stage1ValidationCli.test.js
git commit -m "chore: add Stage 1 evaluation validation gate"
```

### Task 4: Stage 1 evidence closure

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/audit/stage_1_freeze_report.md`
- Test: `test/stage1Documentation.test.js`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: an auditable freeze report that distinguishes structural readiness from measured model performance.

- [ ] **Step 1: Write failing documentation tests**

Assert the protocol and report name both scenarios, `recap_without_progress`, `Margin Core`, `Pi Extension Adapter`, `Skill Policy`, `synthetic`, `not user validation`, and the ten manifest task IDs. Assert they contain no percentage claims matching `/\b\d+(?:\.\d+)?%/u` and no pre-written precision, recall, adoption, or success-rate result.

- [ ] **Step 2: Run the documentation test and verify RED**

```powershell
.\.runtime\node-v22.23.1-win-x64\node.exe --test test/stage1Documentation.test.js
```

Expected: FAIL because the freeze report does not exist.

- [ ] **Step 3: Create the freeze report and update changelog**

Record protocol version, commit-reproducible manifest, task distribution, risk coverage, validation commands, and remaining work. State explicitly that Stage 1 has not run the A/B/C baselines, does not implement production State/Memory, and provides no user outcome metrics.

- [ ] **Step 4: Run the complete verification suite**

```powershell
$env:Path = "$PWD\.runtime\node-v22.23.1-win-x64;$env:Path"
npm test
npm run validate:stage1
npm run audit:pi
git diff --check
```

Expected: all tests pass, ten fixtures validate, Pi baseline audit passes, and no whitespace errors are reported.

- [ ] **Step 5: Scan changed files for credentials and forbidden claims**

Inspect `git diff --cached` or the exact changed paths. Reject API-key-like values, bearer tokens, real identities, percentage outcome claims, and language claiming production Pi integration or user validation.

- [ ] **Step 6: Commit Stage 1 closure**

```powershell
git add CHANGELOG.md docs/audit/stage_1_freeze_report.md test/stage1Documentation.test.js
git commit -m "docs: close Stage 1 evaluation freeze"
```

## Completion gate

Stage 1 is complete only when:

- the ten seed tasks validate against protocol `1.0.0`;
- both scenarios contain five tasks and at least three artifact types;
- manifest hashes bind every exact fixture byte sequence;
- the nine frozen failure labels are represented in the contract;
- security/privacy and ordinary-chat gates have negative tests;
- the full repository test suite and Pi baseline audit pass;
- documentation contains no fabricated outcome metrics;
- the worktree is clean after the final commit.

The next plan may design Stage 2 Margin Core schemas and four production tool contracts. It must not modify frozen Stage 1 fixtures merely to accommodate implementation behavior.
