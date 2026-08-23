import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionWorkstream, WORKSTREAM_STATUSES } from '../src/domain/workstream.js';

test('workstream supports host-owned pause and resume transitions', () => {
  assert.equal(transitionWorkstream({ status: 'running' }, { type: 'pause' }).status, 'paused');
  assert.equal(transitionWorkstream({ status: 'paused' }, { type: 'resume' }).status, 'running');
  assert.equal(WORKSTREAM_STATUSES.includes('needs_owner'), true);
});

test('completed workstream cannot resume', () => {
  assert.throws(() => transitionWorkstream({ status: 'completed' }, { type: 'resume' }), /invalid_workstream_transition/);
});
