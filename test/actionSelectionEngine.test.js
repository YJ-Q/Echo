import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCurrentAction, sortActions } from '../src/services/actionSelectionEngine.js';

test('selectCurrentAction prefers active over pending', () => {
  const current = selectCurrentAction([
    buildAction({ id: 1, status: 'pending', priority: 1 }),
    buildAction({ id: 2, status: 'active', priority: 5 })
  ]);

  assert.equal(current.id, 2);
});

test('selectCurrentAction prefers lower numeric priority within the same status', () => {
  const current = selectCurrentAction([
    buildAction({ id: 1, status: 'pending', priority: 3 }),
    buildAction({ id: 2, status: 'pending', priority: 1 })
  ]);

  assert.equal(current.id, 2);
});

test('selectCurrentAction prefers newer updated_at when priority ties', () => {
  const current = selectCurrentAction([
    buildAction({
      id: 1,
      status: 'pending',
      priority: 2,
      updated_at: '2026-07-08T10:00:00.000Z',
      created_at: '2026-07-08T09:00:00.000Z'
    }),
    buildAction({
      id: 2,
      status: 'pending',
      priority: 2,
      updated_at: '2026-07-08T11:00:00.000Z',
      created_at: '2026-07-08T08:00:00.000Z'
    })
  ]);

  assert.equal(current.id, 2);
});

test('selectCurrentAction ignores done and dismissed actions', () => {
  const current = selectCurrentAction([
    buildAction({ id: 1, status: 'done', priority: 1 }),
    buildAction({ id: 2, status: 'dismissed', priority: 1 }),
    buildAction({ id: 3, status: 'pending', priority: 4 })
  ]);

  assert.equal(current.id, 3);
});

test('sortActions uses the same deterministic ordering as current action selection', () => {
  const sorted = sortActions([
    buildAction({ id: 1, status: 'pending', priority: 2, updated_at: '2026-07-08T09:00:00.000Z' }),
    buildAction({ id: 2, status: 'active', priority: 5, updated_at: '2026-07-08T08:00:00.000Z' }),
    buildAction({ id: 3, status: 'pending', priority: 1, updated_at: '2026-07-08T10:00:00.000Z' }),
    buildAction({ id: 4, status: 'done', priority: 1, updated_at: '2026-07-08T11:00:00.000Z' })
  ]);

  assert.deepEqual(sorted.map((action) => action.id), [2, 3, 1, 4]);
});

function buildAction(overrides = {}) {
  return {
    id: 0,
    type: 'manual',
    title: 'Action',
    detail: '',
    source: 'manual',
    priority: 3,
    status: 'pending',
    created_at: '2026-07-08T00:00:00.000Z',
    updated_at: '2026-07-08T00:00:00.000Z',
    ...overrides
  };
}
