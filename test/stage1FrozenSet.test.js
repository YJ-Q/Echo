import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeStage1Fixtures, validateStage1Fixture } from '../src/evaluation/stage1Fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evaluationRoot = path.join(root, 'evaluation', 'stage1');

async function loadFrozenSet() {
  const fixtureDir = path.join(evaluationRoot, 'fixtures');
  const files = (await readdir(fixtureDir)).filter((name) => name.endsWith('.json')).sort();
  const entries = await Promise.all(files.map(async (file) => {
    const bytes = await readFile(path.join(fixtureDir, file));
    return {
      file,
      bytes,
      fixture: validateStage1Fixture(JSON.parse(bytes.toString('utf8'))),
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  }));
  const manifest = JSON.parse(await readFile(path.join(evaluationRoot, 'manifest.json'), 'utf8'));
  return { entries, manifest };
}

test('frozen seed set balances scenarios and covers priority risks', async () => {
  const { entries } = await loadFrozenSet();
  const fixtures = entries.map((entry) => entry.fixture);
  const summary = summarizeStage1Fixtures(fixtures);
  assert.equal(fixtures.length, 10);
  assert.deepEqual(summary.byScenario, { career_project: 5, learning_research: 5 });
  assert.ok(summary.byRisk.stale_state_override >= 2);
  assert.ok(summary.byRisk.cross_project_contamination >= 2);
  assert.ok(summary.byRisk.unsupported_memory_claim >= 1);
  assert.ok(summary.byRisk.unauthorized_tool_attempt >= 1);
  assert.ok(summary.byRisk.intrusive_recall >= 1);
  for (const scenario of ['learning_research', 'career_project']) {
    const artifactTypes = new Set(fixtures.filter((item) => item.scenario === scenario).map((item) => item.oracle.artifact.type));
    assert.ok(artifactTypes.size >= 3, `${scenario} needs at least three artifact types`);
  }
});

test('manifest binds ordered task ids to exact fixture bytes', async () => {
  const { entries, manifest } = await loadFrozenSet();
  assert.equal(manifest.protocolVersion, '1.0.0');
  assert.equal(manifest.frozenAt, '2026-08-20');
  assert.deepEqual(manifest.tasks, entries.map(({ file, fixture, sha256 }) => ({
    taskId: fixture.taskId,
    file: `fixtures/${file}`,
    sha256
  })));
  assert.equal(new Set(manifest.tasks.map((item) => item.taskId)).size, 10);
});

test('fixtures contain no credential patterns or real personal data', async () => {
  const { entries } = await loadFrozenSet();
  for (const entry of entries) {
    const text = entry.bytes.toString('utf8');
    assert.doesNotMatch(text, /sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|api[_-]?key\s*[:=]/iu);
    assert.equal(entry.fixture.containsRealPersonalData, false);
    assert.equal(entry.fixture.synthetic, true);
  }
});
