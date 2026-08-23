import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { createMemoryTools } from '../src/core/tools/memoryTools.js';

const base = { requestId: 'r', projectId: '', sourceSessionId: 's', sourceEventId: 'e' };
const context = { actorType: 'user', permissions: { memoryRead: true, memoryPropose: true } };

async function setup(t) {
  let id = 0;
  const fixture = await createMarginCoreTestDb({ clock: () => '2026-08-20T00:00:00.000Z', idFactory: (p) => `${p}-${++id}` });
  t.after(() => fixture.cleanup());
  const project = await fixture.store.createProject({ scenario: 'learning_research', goal: 'learn sqlite', phase: 'research' }, {
    requestId: 'seed', actorType: 'user', sourceSessionId: 's', sourceEventId: 'e', inputDigest: 'a'.repeat(64), permissionDecision: 'allowed'
  });
  return { fixture, project, tools: createMemoryTools({ store: fixture.store }) };
}

test('proposal is governed and sensitive content requests confirmation', async (t) => {
  const { project, tools } = await setup(t);
  const result = await tools.memoryPropose({ ...base, projectId: project.id, content: 'private constraint', memoryType: 'sensitive', confidence: 0.8, validFrom: '2026-08-20T00:00:00.000Z', durableIntent: true }, context);
  assert.equal(result.ok, true);
  assert.equal(result.data.memory.confirmation_status, 'proposed');
  assert.equal(result.data.confirmationRequired, true);
  const rejected = await tools.memoryPropose({ ...base, requestId: 'r2', projectId: project.id, content: 'hello', memoryType: 'context', confidence: 0.5, validFrom: '2026-08-20T00:00:00.000Z' }, context);
  assert.equal(rejected.error.code, 'invalid_request');
  assert.match(rejected.auditId, /^audit-/u);
});

test('a host-only trusted confirmation atomically promotes a proposed memory for later recall', async (t) => {
  const { fixture, project, tools } = await setup(t);
  const proposed = await tools.memoryPropose({
    ...base, projectId: project.id, content: 'sqlite research uses a migration checklist', memoryType: 'context',
    confidence: 0.8, validFrom: '2026-08-20T00:00:00.000Z', durableIntent: true
  }, context);
  const memory = proposed.data.memory;
  const beforeEvents = await fixture.store.db.get('SELECT COUNT(*) AS count FROM margin_events');
  const beforeAudits = await fixture.store.db.get('SELECT COUNT(*) AS count FROM margin_audit_log');

  const confirmed = await fixture.store.confirmMemory({
    memoryId: memory.id,
    expectedVersion: memory.version
  }, {
    requestId: 'host-confirm-1',
    actorType: 'user',
    sourceSessionId: 'trusted-host',
    sourceEventId: 'trusted-event-1',
    trustedConfirmation: {
      ref: 'trusted-confirmation-1', action: 'confirm_memory', memoryId: memory.id, projectId: project.id, actorType: 'user'
    }
  });

  assert.equal(confirmed.memory.confirmation_status, 'confirmed');
  assert.equal(confirmed.memory.version, 2);
  assert.match(confirmed.auditId, /^audit-/u);
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) AS count FROM margin_events')).count, beforeEvents.count + 1);
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) AS count FROM margin_audit_log')).count, beforeAudits.count + 1);
  const recalled = await tools.memorySearch({ ...base, projectId: project.id, query: 'migration checklist', topK: 1, asOf: '2026-08-20T00:00:00.000Z' }, context);
  assert.deepEqual(recalled.data.items.map((item) => item.id), [memory.id]);

  await assert.rejects(
    fixture.store.confirmMemory({ memoryId: memory.id, expectedVersion: 2 }, {
      requestId: 'forged', actorType: 'agent', sourceSessionId: 'model', sourceEventId: 'model-event',
      trustedConfirmation: { ref: 'model-text', action: 'confirm_memory', memoryId: memory.id, projectId: project.id, actorType: 'agent' }
    }),
    (error) => error.code === 'invalid_confirmation'
  );
});

test('confirmed Chinese memory is recalled across wording variants', async (t) => {
  const { fixture, project, tools } = await setup(t);
  await fixture.store.db.run(`INSERT INTO margin_memories VALUES
    ('zh-memory', ?, NULL, '昨天完成了新版简历并优化项目经历，后续使用新版简历投递', 'context', .9, 'confirmed', '2026-01-01T00:00:00.000Z', NULL, NULL, 2, 'session-zh', 'event-zh', '2026-01-01T00:00:00.000Z', '2026-08-22T00:00:00.000Z', NULL)`, project.id);
  const recalled = await tools.memorySearch({ ...base, projectId: project.id, query: '继续简历投递', topK: 5, asOf: '2026-08-23T00:00:00.000Z' }, context);
  assert.deepEqual(recalled.data.items.map((item) => item.id), ['zh-memory']);
});

test('search is isolated, deterministic, bounded, and does not mutate memories', async (t) => {
  const { fixture, project, tools } = await setup(t);
  await fixture.store.db.run(`INSERT INTO margin_memories VALUES
    ('m1', ?, NULL, 'sqlite migration research', 'fact', .9, 'confirmed', '2026-01-01T00:00:00.000Z', NULL, NULL, 1, 's1', 'e1', '2026-01-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL),
    ('m2', ?, NULL, 'unrelated note', 'context', .8, 'confirmed', '2026-01-01T00:00:00.000Z', NULL, NULL, 1, 's2', 'e2', '2026-01-01T00:00:00.000Z', '2026-08-18T00:00:00.000Z', NULL),
    ('m3', ?, NULL, 'sqlite expired', 'fact', 1, 'confirmed', '2026-01-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL, 1, 's3', 'e3', '2026-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', NULL)`, project.id, project.id, project.id);
  const before = await fixture.store.db.get("SELECT * FROM margin_memories WHERE id='m1'");
  const result = await tools.memorySearch({ ...base, projectId: project.id, query: 'sqlite research', topK: 1, asOf: '2026-08-20T00:00:00.000Z' }, context);
  assert.deepEqual(result.data.items.map((item) => item.id), ['m1']);
  assert.equal(result.data.items[0].sourceSessionId, 's1');
  assert.deepEqual(await fixture.store.db.get("SELECT * FROM margin_memories WHERE id='m1'"), before);
});

test('empty and denied search never invent memory', async (t) => {
  const { project, tools } = await setup(t);
  const empty = await tools.memorySearch({ ...base, projectId: project.id, query: 'none', topK: 5, asOf: '2026-08-20T00:00:00.000Z' }, context);
  assert.deepEqual(empty.data, { items: [], reason: 'no_relevant_memory' });
  const denied = await tools.memorySearch({ ...base, projectId: project.id, query: 'x', topK: 5, asOf: '2026-08-20T00:00:00.000Z' }, { actorType: 'agent', permissions: {} });
  assert.equal(denied.error.code, 'permission_denied');
});

test('search separates invalid input from storage failure', async (t) => {
  const { fixture, project, tools } = await setup(t);
  const invalid = await tools.memorySearch({ ...base, projectId: project.id, query: 'x', topK: 0, asOf: '2026-08-20T00:00:00.000Z' }, context);
  assert.equal(invalid.error.code, 'invalid_request');
  assert.equal(invalid.error.retryable, false);
  const originalAll = fixture.store.db.all.bind(fixture.store.db);
  fixture.store.db.all = async () => { throw new Error('injected read failure'); };
  const failed = await tools.memorySearch({ ...base, projectId: project.id, query: 'x', topK: 1, asOf: '2026-08-20T00:00:00.000Z' }, context);
  fixture.store.db.all = originalAll;
  assert.equal(failed.error.code, 'storage_failure');
  assert.equal(failed.error.retryable, true);
});
