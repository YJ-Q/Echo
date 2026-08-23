import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1_FAILURE_LABELS,
  STAGE1_PROTOCOL_VERSION,
  summarizeStage1Fixtures,
  validateStage1Fixture
} from '../src/evaluation/stage1Fixture.js';

function validFixture(overrides = {}) {
  return {
    taskId: 'lr-source-conflict-001',
    protocolVersion: STAGE1_PROTOCOL_VERSION,
    scenario: 'learning_research',
    synthetic: true,
    projectId: 'synthetic-research-alpha',
    priorSession: {
      kind: 'sustained_task',
      interruptionPoint: 'comparison_started',
      messages: ['Synthetic research context.']
    },
    currentFacts: [
      { id: 'fact-current', value: 'Use the 2026 source.', sourceId: 'session-a:event-4', version: 2 }
    ],
    distractors: [
      { id: 'fact-stale', kind: 'stale', value: 'Use the 2025 source.', sourceId: 'session-a:event-2', version: 1 }
    ],
    newSessionRequest: 'Continue the comparison and complete the evidence row.',
    oracle: {
      requiredFactIds: ['fact-current'],
      forbiddenFactIds: ['fact-stale'],
      artifact: { type: 'comparison_row', checks: ['names both alternatives', 'cites fact-current'] },
      allowedTools: ['memory_search'],
      confirmationRequiredFor: [],
      clarification: 'forbidden',
      expectedFailureLabels: [...STAGE1_FAILURE_LABELS]
    },
    risks: ['stale_state_override'],
    durableStateQualified: true,
    containsRealPersonalData: false,
    ...overrides
  };
}

function expectInvalid(fixture) {
  assert.throws(
    () => validateStage1Fixture(fixture),
    (error) => error.code === 'invalid_stage1_fixture' && !error.message.includes('Use the 2026 source.')
  );
}

test('valid fixture is normalized and deeply frozen', () => {
  const fixture = validateStage1Fixture(validFixture());
  assert.equal(fixture.taskId, 'lr-source-conflict-001');
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(Object.isFrozen(fixture.currentFacts), true);
  assert.equal(Object.isFrozen(fixture.currentFacts[0]), true);
});

test('validator rejects unknown scenarios and protocol drift', () => {
  expectInvalid(validFixture({ scenario: 'casual_chat' }));
  expectInvalid(validFixture({ protocolVersion: '2.0.0' }));
});

test('validator rejects missing sources, duplicate facts, and invalid versions', () => {
  expectInvalid(validFixture({ currentFacts: [{ id: 'fact-current', value: 'x', version: 2 }] }));
  expectInvalid(validFixture({ distractors: [{ id: 'fact-current', kind: 'stale', value: 'x', sourceId: 's:1', version: 1 }] }));
  expectInvalid(validFixture({ currentFacts: [{ id: 'fact-current', value: 'x', sourceId: 's:1', version: 0 }] }));
});

test('validator rejects empty artifact checks and unsupported tools', () => {
  const emptyChecks = validFixture();
  emptyChecks.oracle.artifact.checks = [];
  expectInvalid(emptyChecks);
  const unsafeTool = validFixture();
  unsafeTool.oracle.allowedTools = ['bash'];
  expectInvalid(unsafeTool);
});

test('validator rejects ordinary chat, real personal data, and unknown failure labels', () => {
  const ordinary = validFixture();
  ordinary.priorSession.kind = 'ordinary_chat';
  expectInvalid(ordinary);
  expectInvalid(validFixture({ containsRealPersonalData: true }));
  const unknownLabel = validFixture();
  unknownLabel.oracle.expectedFailureLabels = ['made_up_label'];
  expectInvalid(unknownLabel);
});

test('summary is deterministic by scenario and risk', () => {
  const career = validFixture({
    taskId: 'cp-resume-001',
    scenario: 'career_project',
    projectId: 'synthetic-career-alpha',
    risks: ['cross_project_contamination']
  });
  assert.deepEqual(summarizeStage1Fixtures([validFixture(), career]), {
    protocolVersion: '1.0.0',
    total: 2,
    byScenario: { career_project: 1, learning_research: 1 },
    byRisk: { cross_project_contamination: 1, stale_state_override: 1 }
  });
});
