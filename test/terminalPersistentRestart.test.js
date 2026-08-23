import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';
import { createTerminalPilotController } from '../src/pilot/terminalPilotController.js';

function runtime() {
  let sequence = 0;
  return {
    async createSession() {
      return { id: `session-${++sequence}`, async send() { return { text: 'ok', toolResults: [] }; }, async close() {} };
    },
    async close() {}
  };
}

function terminalCore(core) {
  return {
    createApplicationContract: core.createApplicationContract,
    bindHostContext: core.bindHostContext,
    continuity: core.continuity,
    v1Tools: core.v1Tools,
    confirmMemory: core.confirmMemory
  };
}

async function readRun(core, runId, requestId) {
  const gateway = core.createApplicationContract();
  const context = {
    actor: { type: 'user', subjectId: 'restart-test' },
    surface: { kind: 'cli', instanceId: 'restart-test' },
    requestId,
    correlationId: 'restart-test-correlation',
    capabilities: ['run:read']
  };
  const response = await gateway.query({ type: 'run.get', requestId, payload: { runId } }, context);
  assert.equal(response.ok, true);
  return response.data;
}

test('terminal resumes the same Workstream and Run checkpoint after Core restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-terminal-restart-'));
  const dbPath = path.join(directory, 'core.sqlite');
  let savedProjectId = null;
  const registry = { async load() { return savedProjectId; }, async save(id) { savedProjectId = id; } };
  const options = { clock: () => '2026-08-23T12:00:00.000Z', idFactory: (() => { let n = 0; return (prefix) => `${prefix}-${++n}`; })() };
  let core = await createMarginCore({ enabled: true, dbPath, ...options });
  try {
    let controller = createTerminalPilotController({ core: terminalCore(core), runtime: runtime(), registry, ...options });
    const first = await controller.start();
    const paused = await controller.handle('/pause');
    assert.equal(paused.runStatus, 'paused');
    const checkpointId = (await readRun(core, first.runId, 'read-first-run')).checkpoint.id;
    assert.ok(checkpointId);
    await controller.close();
    await core.close();

    core = await createMarginCore({ enabled: true, dbPath, ...options });
    controller = createTerminalPilotController({ core: terminalCore(core), runtime: runtime(), registry, ...options });
    const restored = await controller.start();
    assert.equal(restored.projectId, first.projectId);
    assert.equal(restored.runId, first.runId);
    assert.equal(restored.runStatus, 'paused');
    assert.equal((await readRun(core, restored.runId, 'read-restored-run')).checkpoint.id, checkpointId);
    assert.equal((await controller.handle('/resume')).runStatus, 'running');
    assert.equal((await controller.handle('/stop')).runStatus, 'cancelled');
    await controller.close();
  } finally {
    await core.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
