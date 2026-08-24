import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createWebWorkbench } from '../src/web/createWebWorkbench.js';

dotenv.config();

const PI_VERSION = '0.84.2';
const ALLOWED_KEYS = new Set([
  'status', 'piVersion', 'contractVersion', 'workstreamId', 'runId',
  'workstreamVersion', 'runVersion', 'beforeCursor', 'afterCursor',
  'resultCodes', 'runStatus', 'failureCode'
]);
const FORBIDDEN_KEY_PARTS = ['prompt', 'message', 'assistant', 'text', 'reasoning', 'session', 'token', 'apikey', 'stack'];
const STABLE_CODE = /^[a-z][a-z0-9_.-]{0,99}$/u;
const CREDENTIAL_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}|\bxox[baprs]-[A-Za-z0-9-]{8,}|\bgh[pousr]_[A-Za-z0-9]{12,}|\bAIza[A-Za-z0-9_-]{20,}|(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+)/iu;

function unsafe() {
  const error = new Error('unsafe_live_evidence');
  error.code = 'unsafe_live_evidence';
  return error;
}

function inspectRecursively(value, key = '') {
  const normalizedKey = key.replace(/[^a-z]/giu, '').toLowerCase();
  if (FORBIDDEN_KEY_PARTS.some((part) => normalizedKey.includes(part))) throw unsafe();
  if (typeof value === 'string' && CREDENTIAL_VALUE.test(value)) throw unsafe();
  if (Array.isArray(value)) {
    value.forEach((entry) => inspectRecursively(entry));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) inspectRecursively(child, childKey);
  }
}

function boundedId(value) {
  return typeof value === 'string' && value.trim() && value.length <= 200;
}

function integer(value) {
  return Number.isInteger(value) && value >= 0;
}

function validCodes(values) {
  return Array.isArray(values) && values.length > 0 && values.length <= 20 && values.every((value) => typeof value === 'string' && STABLE_CODE.test(value));
}

function cloneAndFreeze(value) {
  const clone = { ...value, ...(value.resultCodes ? { resultCodes: Object.freeze([...value.resultCodes]) } : {}) };
  return Object.freeze(clone);
}

export function assertSafeLiveEvidence(value) {
  inspectRecursively(value);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) throw unsafe();
  if (!['passed', 'failed'].includes(value.status) || value.piVersion !== PI_VERSION) throw unsafe();
  if (value.contractVersion !== undefined && !/^\d+\.\d+$/u.test(value.contractVersion)) throw unsafe();
  for (const key of ['workstreamId', 'runId']) if (value[key] !== undefined && !boundedId(value[key])) throw unsafe();
  for (const key of ['workstreamVersion', 'runVersion', 'beforeCursor', 'afterCursor']) if (value[key] !== undefined && !integer(value[key])) throw unsafe();
  if (value.resultCodes !== undefined && !validCodes(value.resultCodes)) throw unsafe();
  if (value.failureCode !== undefined && (typeof value.failureCode !== 'string' || !STABLE_CODE.test(value.failureCode))) throw unsafe();
  if (value.runStatus !== undefined && !['paused', 'cancelled', 'completed', 'failed'].includes(value.runStatus)) throw unsafe();
  if (value.status === 'passed') {
    const required = ['contractVersion', 'workstreamId', 'runId', 'workstreamVersion', 'runVersion', 'beforeCursor', 'afterCursor', 'resultCodes'];
    if (required.some((key) => value[key] === undefined) || value.afterCursor <= value.beforeCursor || !value.resultCodes.includes('allowed')) throw unsafe();
  } else if (!value.failureCode) throw unsafe();
  return cloneAndFreeze(value);
}

export function sanitizeLiveEvidence(input = {}) {
  const selected = Object.fromEntries([...ALLOWED_KEYS]
    .filter((key) => input[key] !== undefined)
    .map((key) => [key, input[key]]));
  return assertSafeLiveEvidence(selected);
}

function stableFailureCode(value) {
  return typeof value === 'string' && STABLE_CODE.test(value) ? value : 'live_e2e_failure';
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function httpClient(origin) {
  let sequence = 0;
  const requestId = (prefix) => `${prefix}-${++sequence}-${randomUUID()}`;
  async function envelope(route, options) {
    const response = await fetch(new URL(route, origin), options);
    const body = await response.json();
    if (body?.ok !== true) throw Object.assign(new Error('live_http_failure'), { code: stableFailureCode(body?.error?.code) });
    return body;
  }
  return {
    async command(type, payload, expectedVersion) {
      const id = requestId('live-command');
      return envelope('/api/commands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type, requestId: id, idempotencyKey: `${id}-intent`,
          ...(expectedVersion === undefined ? {} : { expectedVersion }), payload
        })
      });
    },
    query(type, payload) {
      return envelope('/api/queries', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, requestId: requestId('live-query'), payload })
      });
    },
    events(workstreamId, afterCursor = 0) {
      const payload = encodeURIComponent(JSON.stringify({ workstreamId, afterCursor, limit: 100 }));
      return envelope(`/api/events?type=event.list&requestId=${requestId('live-events')}&payload=${payload}`);
    },
    interact(workstreamId, runId) {
      return envelope('/api/interactions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workstreamId, runId, requestId: requestId('live-interaction'),
          message: '请调用 state_update 工具，把当前 Workstream 的 goal 更新为“完成 Phase 2B Live Web 验证”，并依据上下文使用正确的 entityId 与 expectedVersion。'
        })
      });
    }
  };
}

function safeTemporaryDirectory(directory) {
  const relative = path.relative(os.tmpdir(), directory);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('margin-phase2b-live-');
}

export async function runLivePhase2bE2E({
  env = process.env,
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  outputDir = path.join(rootDir, 'data', 'phase2b-live'),
  dependencies = {}
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const evidenceFile = path.join(outputDir, 'latest.json');
  const keyName = env.MARGIN_PI_API_KEY_ENV ?? 'YAPI_API_KEY';
  if (typeof env[keyName] !== 'string' || !env[keyName].trim()) {
    const evidence = sanitizeLiveEvidence({ status: 'failed', piVersion: PI_VERSION, failureCode: 'credential_missing' });
    await atomicJson(evidenceFile, evidence);
    return { evidence, evidenceFile };
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'margin-phase2b-live-'));
  const dbPath = path.join(temporaryDirectory, 'margin-core.sqlite');
  let workbench;
  let client;
  let workstream;
  let run;
  let beforeCursor;
  let afterCursor;
  let resultCodes;
  let contractVersion;
  let workstreamVersion;
  let failureCode;
  try {
    workbench = await (dependencies.createWebWorkbench ?? createWebWorkbench)({
      rootDir, dbPath, staticDir: path.join(rootDir, 'web', 'dist'),
      agentDir: path.join(temporaryDirectory, 'agent'), host: '127.0.0.1', port: 0, env
    });
    const started = await workbench.start();
    client = httpClient(started.origin);
    const created = await client.command('workstream.create', {
      title: 'Phase 2B Live Web', goal: 'Await governed live update', scenario: 'career_project',
      currentPlan: ['perform one governed update'], nextAction: 'run the live interaction'
    });
    workstream = created.data;
    const createdRun = await client.command('run.create', {
      workstreamId: workstream.id, workerKind: 'pi', scope: 'Isolated live Web validation',
      stopCondition: 'one governed state update', allowedActions: ['read', 'write'], forbiddenActions: ['external_write']
    });
    run = createdRun.data;
    run = (await client.command('run.start', { runId: run.id }, run.version)).data;
    const beforeWorkstream = (await client.query('workstream.get', { workstreamId: workstream.id })).data;
    const beforeEvents = (await client.events(workstream.id)).data;
    beforeCursor = beforeEvents.nextCursor;

    const interaction = await client.interact(workstream.id, run.id);
    resultCodes = interaction.data.toolResults.map((item) => item.code).filter((code) => typeof code === 'string');
    const refreshed = await client.query('workstream.get', { workstreamId: workstream.id });
    const refreshedEvents = (await client.events(workstream.id, beforeCursor)).data;
    contractVersion = refreshed.meta.contractVersion;
    workstreamVersion = refreshed.data.version;
    afterCursor = refreshedEvents.nextCursor;
    if (workstreamVersion <= beforeWorkstream.version || afterCursor <= beforeCursor || !resultCodes.includes('allowed')) {
      throw Object.assign(new Error('governed_change_missing'), { code: 'governed_change_missing' });
    }
    run = (await client.query('run.get', { runId: run.id })).data;
    run = (await client.command('run.stop', { runId: run.id }, run.version)).data;
  } catch (error) {
    failureCode = stableFailureCode(error?.code);
    if (client && run?.id && run.status === 'running') {
      try {
        run = (await client.query('run.get', { runId: run.id })).data;
        if (run.status === 'running') run = (await client.command('run.stop', { runId: run.id }, run.version)).data;
      } catch {}
    }
  } finally {
    await workbench?.close().catch(() => {});
    if (!safeTemporaryDirectory(temporaryDirectory)) throw new Error('unsafe_live_temp_path');
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const evidence = failureCode
    ? sanitizeLiveEvidence({
        status: 'failed', piVersion: PI_VERSION, failureCode,
        ...(workstream?.id ? { workstreamId: workstream.id } : {}),
        ...(run?.id ? { runId: run.id, runVersion: run.version, runStatus: run.status } : {}),
        ...(integer(workstreamVersion) ? { workstreamVersion } : {}),
        ...(integer(beforeCursor) ? { beforeCursor } : {}),
        ...(integer(afterCursor) ? { afterCursor } : {}),
        ...(validCodes(resultCodes) ? { resultCodes } : {})
      })
    : sanitizeLiveEvidence({
        status: 'passed', piVersion: PI_VERSION, contractVersion,
        workstreamId: workstream.id, runId: run.id,
        workstreamVersion, runVersion: run.version,
        beforeCursor, afterCursor, resultCodes, runStatus: run.status
      });
  await atomicJson(evidenceFile, evidence);
  return { evidence, evidenceFile };
}

export async function main({ env = process.env, stdout = process.stdout } = {}) {
  const { evidence } = await runLivePhase2bE2E({ env });
  stdout.write(evidence.status === 'passed' ? 'phase2b_live_passed\n' : `phase2b_live_failed ${evidence.failureCode}\n`);
  return evidence.status === 'passed' ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
