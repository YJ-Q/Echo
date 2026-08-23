import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionRun, RUN_STATUSES } from '../src/domain/run.js';

test('run supports start pause resume stop and completion lifecycle', () => {
  assert.equal(transitionRun({ status: 'queued' }, { type: 'start' }).status, 'running');
  assert.equal(transitionRun({ status: 'running' }, { type: 'pause' }).status, 'paused');
  assert.equal(transitionRun({ status: 'paused' }, { type: 'resume' }).status, 'running');
  assert.equal(transitionRun({ status: 'running' }, { type: 'stop' }).status, 'cancelled');
  assert.equal(transitionRun({ status: 'running' }, { type: 'complete' }).status, 'completed');
  assert.equal(RUN_STATUSES.includes('needs_owner'), true);
});

test('terminal run states reject resume', () => {
  for (const status of ['completed', 'failed', 'cancelled']) {
    assert.throws(() => transitionRun({ status }, { type: 'resume' }), /invalid_run_transition/);
  }
});
