import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'validate-stage1-fixtures.js');

function runValidator(args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
}

async function temporaryFrozenSet(t) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'margin-stage1-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(path.join(repositoryRoot, 'evaluation', 'stage1'), temporaryRoot, { recursive: true });
  return temporaryRoot;
}

test('validation CLI reports the frozen seed-set summary', () => {
  const result = runValidator();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, {
    ok: true,
    protocolVersion: '1.0.0',
    total: 10,
    byScenario: { career_project: 5, learning_research: 5 },
    manifestBound: true
  });
});

test('validation CLI rejects manifest drift without printing fixture content', async (t) => {
  const temporaryRoot = await temporaryFrozenSet(t);
  const fixturePath = path.join(temporaryRoot, 'fixtures', 'lr-new-session-001.json');
  const original = await readFile(fixturePath, 'utf8');
  await writeFile(fixturePath, `${original} `, 'utf8');
  const result = runValidator(['--root', temporaryRoot]);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    errorCode: 'stage1_fixture_validation_failed'
  });
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /battery recycling|Method A/u);
});

test('validation CLI rejects a smaller self-consistent manifest', async (t) => {
  const temporaryRoot = await temporaryFrozenSet(t);
  const manifestPath = path.join(temporaryRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.tasks = manifest.tasks.slice(0, 1);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const result = runValidator(['--root', temporaryRoot]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).errorCode, 'stage1_fixture_validation_failed');
});

test('validation CLI rejects unmanifested fixture files', async (t) => {
  const temporaryRoot = await temporaryFrozenSet(t);
  const source = path.join(temporaryRoot, 'fixtures', 'lr-new-session-001.json');
  await cp(source, path.join(temporaryRoot, 'fixtures', 'unlisted.json'));
  const result = runValidator(['--root', temporaryRoot]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).errorCode, 'stage1_fixture_validation_failed');
});

test('validation CLI scans fixture content even when manifest hash is updated', async (t) => {
  const temporaryRoot = await temporaryFrozenSet(t);
  const manifestPath = path.join(temporaryRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.tasks.find((item) => item.taskId === 'lr-new-session-001');
  const fixturePath = path.join(temporaryRoot, entry.file);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  fixture.priorSession.messages.push('Bearer abcdefghijklmnopqrstuvwxyz123456');
  const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  await writeFile(fixturePath, bytes);
  entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const result = runValidator(['--root', temporaryRoot]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /abcdefghijklmnopqrstuvwxyz/u);
});

test('validation CLI rejects unsupported arguments as an operational error', () => {
  const result = runValidator(['--unknown']);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    errorCode: 'stage1_validator_operational_error'
  });
});

test('validation CLI classifies a missing root as an operational error', () => {
  const result = runValidator(['--root', path.join(os.tmpdir(), 'margin-stage1-does-not-exist')]);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).errorCode, 'stage1_validator_operational_error');
});
