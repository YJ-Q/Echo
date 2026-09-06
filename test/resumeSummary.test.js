import assert from 'node:assert/strict';
import test from 'node:test';
import { PROGRESS_LIMIT, projectResumeSummary } from '../src/core/handoff/resume-summary.js';

const base = (overrides = {}) => ({
  goal: [{ text: 'Implement the selected slice', confidence: 'Inferred' }],
  nextStep: [],
  progress: [],
  ...overrides,
});

test('research-only summary stays historical, unknown, and never promotes research to implementation completion', () => {
  const result = projectResumeSummary(base({ progress: [{ kind: 'assistant-report', confidence: 'Inferred', temporalScope: 'historical', text: 'Assistant-reported research milestone: Enough evidence to implement.' }] }));
  assert.equal(result.goal.text, 'Implement the selected slice');
  assert.match(result.progress[0].text, /Assistant-reported research milestone/);
  assert.equal(result.currentApplicability.status, 'unknown');
  assert.equal(result.currentValidation.status, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /Implementation complete/i);
});

test('implementation summary preserves report and historical validation wording', () => {
  const result = projectResumeSummary(base({
    progress: [
      { kind: 'assistant-report', confidence: 'Inferred', temporalScope: 'historical', text: 'Assistant-reported milestone: Phase 1 Distiller PoC complete.' },
      { kind: 'historical-validation', confidence: 'Confirmed', temporalScope: 'historical', text: 'Historical validation: 5 focused test commands exited 0.' },
      { kind: 'current-validation', confidence: 'Uncertain', temporalScope: 'current', text: 'Current validation: unknown; historical tests have not been rerun against the current repository observation.' },
    ],
    nextStep: [{ basis: 'Next action inferred from the latest explicit assistant implementation/handoff commitment' }]
  }), { targetLinkage: { status: 'available' }, files: [{ status: 'exists', targetProvenance: [{}] }] });
  assert.match(result.progress[0].text, /^Assistant-reported/);
  assert.match(result.progress[1].text, /^Historical validation/);
  assert.match(result.currentValidation.text, /not been rerun/);
  assert.equal(result.currentApplicability.status, 'reconciled');
  assert.doesNotMatch(JSON.stringify(result), /^.*Phase completed/i);
});

test('observable structured targets reconcile even when historical intent was not recovered', () => {
  const result = projectResumeSummary(base(), {
    targetLinkage: { status: 'available' },
    files: Array.from({ length: 13 }, () => ({ status: 'exists', targetProvenance: [{}] })),
  });
  assert.equal(result.currentApplicability.status, 'reconciled');
  assert.equal(result.currentApplicability.text, '13/13 structured historical targets currently observable in the workspace.');
  assert.doesNotMatch(result.currentApplicability.text, /Historical intent has no structured repo target/i);
});

test('unavailable historical intent and repo linkage remain distinct unknown facts', () => {
  const noIntent = projectResumeSummary(base());
  assert.match(noIntent.currentApplicability.text, /Historical intent is unavailable/);
  const noLinkage = projectResumeSummary(base({ nextStep: [{ basis: 'Next action inferred from the latest explicit assistant implementation/handoff commitment' }] }), {
    targetLinkage: { status: 'unknown' }, files: [],
  });
  assert.match(noLinkage.currentApplicability.text, /Repo target linkage is unavailable/);
  assert.doesNotMatch(noLinkage.currentApplicability.text, /Historical intent/i);
});

test('progress selection has a deterministic upper bound and missing state is stable', () => {
  const progress = Array.from({ length: 10 }, (_, index) => ({ kind: 'structured-work', text: `Structured work evidence: ${index}`, confidence: 'Confirmed', temporalScope: 'historical' }));
  const result = projectResumeSummary(base({ progress }));
  assert.equal(result.progress.length, PROGRESS_LIMIT);
  assert.deepEqual(result.progress.map((item) => item.text), ['Structured work evidence: 0', 'Structured work evidence: 1', 'Structured work evidence: 2']);
  const empty = projectResumeSummary();
  assert.match(empty.goal.text, /No source-backed/);
  assert.match(empty.progress[0].text, /No source-backed/);
  assert.equal(empty.currentValidation.status, 'unknown');
});
