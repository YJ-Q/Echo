import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateCommand,
  validateContractOutput,
  validateEventQuery,
  validateInvocationContext,
  validateQuery
} from '../src/contracts/validation.js';
import {
  toArtifactDTO,
  toCheckpointDTO,
  toDecisionDTO,
  toNeedsOwnerDTO,
  toRunDTO,
  toWorkstreamDTO
} from '../src/contracts/dtoMappers.js';

const context = {
  actor: { type: 'user', subjectId: 'margin-user' },
  surface: { kind: 'cli', instanceId: 'terminal-1' },
  requestId: 'request-1',
  correlationId: 'correlation-1',
  capabilities: ['workstream:write', 'run:control']
};

const hasCode = (code) => (error) => error?.code === code;

test('InvocationContext is closed and requires matching stable identity fields', () => {
  const authority = Symbol('trusted-host-authority');
  const input = { ...context, hostAuthority: 'forged-json-field' };
  Object.defineProperty(input, authority, { value: { trusted: true } });
  const normalized = validateInvocationContext(input);
  assert.deepEqual(normalized.actor, context.actor);
  assert.notEqual(normalized, input);
  assert.notEqual(normalized.actor, input.actor);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.actor), true);
  assert.equal(normalized[authority], input[authority]);
  assert.equal('hostAuthority' in normalized, false);
  assert.throws(() => validateInvocationContext({ ...context, extra: true }), hasCode('invalid_request'));
  assert.throws(() => validateInvocationContext({ ...context, actor: { type: 'user' } }), hasCode('invalid_request'));
  assert.throws(() => validateInvocationContext({ ...context, surface: { kind: 'unknown' } }), hasCode('invalid_request'));
});

test('command validators reject unknown keys and mismatched request identity', () => {
  const valid = {
    type: 'run.pause', requestId: 'request-1', idempotencyKey: 'retry-1', expectedVersion: 2,
    payload: { runId: 'run-1' }
  };
  const normalized = validateCommand(valid, context);
  assert.deepEqual(normalized, valid);
  assert.notEqual(normalized, valid);
  assert.notEqual(normalized.payload, valid.payload);
  assert.equal(Object.isFrozen(normalized), true);
  assert.throws(() => validateCommand({ ...valid, payload: { runId: 'run-1', runtimeSessionId: 'pi-1' } }, context), hasCode('invalid_request'));
  assert.throws(() => validateCommand({ ...valid, requestId: 'different' }, context), hasCode('invalid_request'));
  assert.throws(() => validateCommand({ ...valid, idempotencyKey: '' }, context), hasCode('invalid_request'));
  assert.throws(() => validateCommand({ ...valid, expectedVersion: undefined }, context), hasCode('invalid_request'));
});

test('command validators bound list and metadata payloads', () => {
  const command = {
    type: 'artifact.create', requestId: 'request-1', idempotencyKey: 'artifact-1',
    payload: {
      workstreamId: 'workstream-1', type: 'report', title: 'Report',
      resourceReference: { uri: 'margin://artifact/report', contentHash: 'a'.repeat(64) },
      metadata: { format: 'markdown' }, previewMetadata: { lineCount: 1 }
    }
  };
  assert.deepEqual(validateCommand(command, context), command);
  assert.throws(() => validateCommand({
    ...command,
    payload: { ...command.payload, metadata: { note: 'x'.repeat(16_385) } }
  }, context), hasCode('invalid_request'));
  assert.throws(() => validateCommand({
    ...command,
    payload: { ...command.payload, metadata: { value: 1n } }
  }, context), hasCode('invalid_request'));
  assert.throws(() => validateCommand({
    ...command,
    payload: { ...command.payload, metadata: { nested: Array.from({ length: 80 }, () => Array(80).fill(0)) } }
  }, context), hasCode('invalid_request'));
  for (const key of ['credentials', 'access-token', 'PASSWORD', 'token']) {
    assert.throws(() => validateCommand({
      ...command,
      payload: { ...command.payload, metadata: { nested: { [key]: 'secret' } } }
    }, context), hasCode('invalid_request'));
  }
  assert.throws(() => validateCommand({
    type: 'run.create', requestId: 'request-1', idempotencyKey: 'run-1',
    payload: { workstreamId: 'workstream-1', workerKind: 'pi', scope: 'work', allowedActions: Array(21).fill('read') }
  }, context), hasCode('invalid_request'));
});

test('checkpoint create uses state and run versions rather than expectedVersion', () => {
  const command = {
    type: 'checkpoint.create', requestId: 'request-1', idempotencyKey: 'checkpoint-1',
    payload: { workstreamId: 'workstream-1', runId: 'run-1', runVersion: 2, stateVersion: 3, stateDigest: 'digest' }
  };
  assert.deepEqual(validateCommand(command, context), command);
  assert.throws(() => validateCommand({ ...command, payload: { ...command.payload, runVersion: undefined } }, context), hasCode('invalid_request'));
  assert.throws(() => validateCommand({ ...command, expectedVersion: 2 }, context), hasCode('invalid_request'));
});

test('query and event query validators require integer bounded cursors and limits', () => {
  const query = { type: 'run.list', requestId: 'request-1', payload: { workstreamId: 'workstream-1', limit: 50, cursor: null } };
  assert.deepEqual(validateQuery(query, context), query);
  assert.throws(() => validateQuery({ ...query, payload: { ...query.payload, limit: 1.5 } }, context), hasCode('invalid_request'));
  assert.throws(() => validateQuery({ ...query, payload: { ...query.payload, cursor: 3 } }, context), hasCode('invalid_request'));
  assert.throws(() => validateQuery({ type: 'workstream.list', requestId: 'request-1', payload: { statuses: ['unknown'] } }, context), hasCode('invalid_request'));
  const eventQuery = { type: 'event.list', requestId: 'request-1', payload: { afterCursor: 0, limit: 100, eventTypes: ['run.started'] } };
  assert.deepEqual(validateEventQuery(eventQuery, context), eventQuery);
  assert.throws(() => validateEventQuery({ ...eventQuery, payload: { ...eventQuery.payload, afterCursor: '0' } }, context), hasCode('invalid_request'));
});

test('RunDTO separates Margin id from runtimeReference and contains no snake_case', () => {
  const dto = toRunDTO({ id: 'run-1', runtime_kind: 'pi', runtime_session_id: 'pi-1', workstream_id: 'w-1', status: 'queued', version: 1 });
  assert.equal(dto.id, 'run-1');
  assert.deepEqual(dto.runtimeReference, { kind: 'pi', id: 'pi-1' });
  assert.equal(JSON.stringify(dto).includes('runtime_session_id'), false);
  assert.ok(Object.isFrozen(dto));
  assert.ok(Object.isFrozen(dto.runtimeReference));
});

test('DTO mappers create frozen plain camelCase shapes and retain NeedsOwner independence', () => {
  const workstream = toWorkstreamDTO({
    id: 'w-1', title: 'Ship', goal: 'Release', workstream_status: 'running', priority: 1,
    current_state: 'coding', current_plan: '["test"]', blockers: '[]', autonomy_level: 2,
    workspace_path: 'scoped://workspace', version: 3, updated_at: '2026-08-23T00:00:00Z'
  });
  assert.deepEqual(workstream.currentPlan, ['test']);
  assert.deepEqual(workstream.workspaceReference, { kind: 'local_path', path: 'scoped://workspace' });

  const needsOwner = toNeedsOwnerDTO({
    id: 'need-1', workstream_id: 'w-1', run_id: null, type: 'approval', reason: 'Choose',
    options: '[{"id":"yes","label":"Yes","consequenceSummary":null}]', status: 'open',
    resolution: null, version: 1, created_at: '2026-08-23T00:00:00Z', resolved_at: null
  });
  const decision = toDecisionDTO({
    id: 'decision-1', project_id: 'w-1', decision_key: 'release', content: 'Go', status: 'confirmed',
    superseded_by: null, version: 1, created_at: '2026-08-23T00:00:00Z', updated_at: '2026-08-23T00:00:00Z'
  });
  assert.equal(decision.status, 'active');
  assert.equal('needsOwnerId' in decision, false);
  const serialized = JSON.stringify({ workstream, needsOwner, decision });
  assert.equal(/"(?:workstream_id|current_state|decision_key|source_event_id)"/.test(serialized), false);
  assert.ok(Object.isFrozen(needsOwner.options));
});

test('artifact DTO excludes bodies, Buffers, and runtime objects', () => {
  const dto = toArtifactDTO({
    id: 'artifact-1', workstream_id: 'w-1', run_id: 'run-1', type: 'report', title: 'Report',
    uri: 'margin://artifact/1', content_hash: 'hash', created_by: 'agent', version: 1,
    metadata: '{"format":"md"}', preview_metadata: '{}', source_session_id: 'pi-secret',
    body: 'secret body', buffer: Buffer.from('secret'), runtime: { session: 'secret' },
    created_at: '2026-08-23T00:00:00Z', updated_at: '2026-08-23T00:00:00Z'
  });
  assert.deepEqual(dto.source, { createdBy: 'agent', runtimeReference: null });
  assert.equal(JSON.stringify(dto).includes('secret'), false);
  assert.deepEqual(toCheckpointDTO({ id: 'checkpoint-1', workstream_id: 'w-1', run_id: null, run_version: null, state_version: 3, state_digest: 'digest', git_ref: null, note: '', created_by: 'user', created_at: '2026-08-23T00:00:00Z' }).stateVersion, 3);
});

test('malformed persisted JSON is storage_failure and unsafe output is rejected', () => {
  assert.throws(() => toRunDTO({ id: 'run-1', workstream_id: 'w-1', runtime_kind: 'pi', status: 'queued', allowed_actions: '{bad', forbidden_actions: '[]', version: 1 }), (error) => error?.code === 'storage_failure');
  assert.throws(() => toRunDTO({ id: 'run-1', workstream_id: 'w-1', runtime_kind: 'pi', status: 'queued', allowed_actions: JSON.stringify(Array(21).fill('read')), forbidden_actions: '[]', version: 1 }), (error) => error?.code === 'storage_failure');
  assert.throws(() => toArtifactDTO({ id: 'artifact-1', workstream_id: 'w-1', run_id: null, type: 'report', title: 'Report', uri: 'margin://artifact/1', content_hash: 'hash', created_by: 'agent', metadata: '{"apiKey":"secret"}', preview_metadata: '{}', version: 1 }), (error) => error?.code === 'storage_failure');
  assert.throws(() => toArtifactDTO({ id: 'artifact-1', workstream_id: 'w-1', run_id: null, type: 'report', title: 'Report', uri: 'margin://artifact/1', content_hash: 'hash', created_by: 'agent', metadata: '{"runtime":{"session":"pi-private"}}', preview_metadata: '{}', version: 1 }), (error) => error?.code === 'storage_failure');
  assert.throws(() => toArtifactDTO({ id: 'artifact-1', workstream_id: 'w-1', run_id: null, type: 'report', title: 'Report', uri: 'margin://artifact/1', content_hash: 'hash', created_by: 'agent', metadata: '{"hostAuthority":"serialized"}', preview_metadata: '{}', version: 1 }), (error) => error?.code === 'storage_failure');
  for (const key of ['credentials', 'access_token', 'Password', 'TOKEN']) {
    assert.throws(() => toArtifactDTO({ id: 'artifact-1', workstream_id: 'w-1', run_id: null, type: 'report', title: 'Report', uri: 'margin://artifact/1', content_hash: 'hash', created_by: 'agent', metadata: JSON.stringify({ nested: { [key]: 'secret' } }), preview_metadata: '{}', version: 1 }), (error) => error?.code === 'storage_failure');
  }
  const row = { id: 'run-1', workstream_id: 'w-1', runtime_kind: 'pi', status: 'queued', allowed_actions: [], forbidden_actions: [], result: { summary: 'safe' }, validation: { items: [] }, error: { code: 'none' }, version: 1 };
  const run = toRunDTO(row);
  assert.notEqual(run.result, row.result);
  assert.equal(Object.isFrozen(row.result), false);
  assert.throws(() => toRunDTO({ ...row, result: { nested: { token: 'secret' } } }), (error) => error?.code === 'storage_failure');
  assert.throws(() => toRunDTO({ ...row, validation: Array.from({ length: 9 }, (_, index) => index).reduceRight((value, index) => ({ index, value }), {}) }), (error) => error?.code === 'storage_failure');
  assert.throws(() => toRunDTO({ ...row, error: Buffer.from('runtime') }), (error) => error?.code === 'storage_failure');
  assert.throws(() => validateContractOutput({ data: { apiKey: 'secret' } }), hasCode('invalid_request'));
  assert.throws(() => validateContractOutput({ data: { stack: 'private stack', runtime: { session: 'pi-private' } } }), hasCode('invalid_request'));
  assert.throws(() => validateContractOutput({ data: { nested_value: 'x' } }), hasCode('invalid_request'));
  assert.throws(() => validateContractOutput({ data: { value: Buffer.from('x') } }), hasCode('invalid_request'));
  const output = validateContractOutput({ data: { value: 'safe' } });
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output.data));
});
