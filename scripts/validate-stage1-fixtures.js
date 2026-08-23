import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STAGE1_PROTOCOL_VERSION, summarizeStage1Fixtures, validateStage1Fixture } from '../src/evaluation/stage1Fixture.js';

function parseRoot(args, defaultRoot) {
  if (args.length === 0) return defaultRoot;
  if (args.length === 2 && args[0] === '--root' && args[1].trim()) return path.resolve(args[1]);
  const error = new Error('unsupported arguments');
  error.code = 'stage1_validator_operational_error';
  throw error;
}

function confinedFile(root, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null;
}

export async function validateFrozenStage1Set(root) {
  const invalidResult = { ok: false, errorCode: 'stage1_fixture_validation_failed' };
  const manifestText = await readFile(path.join(root, 'manifest.json'), 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return invalidResult;
  }
  if (manifest.protocolVersion !== STAGE1_PROTOCOL_VERSION || manifest.frozenAt !== '2026-08-20' ||
      !Array.isArray(manifest.tasks) || manifest.tasks.length !== 10) return invalidResult;

  const fixtureDirectory = path.join(root, 'fixtures');
  const actualFiles = (await readdir(fixtureDirectory)).filter((name) => name.endsWith('.json')).sort();
  const manifestFiles = manifest.tasks.map((entry) => entry.file?.replace(/^fixtures\//u, '')).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(manifestFiles)) return invalidResult;

  try {
    const fixtures = [];
    const ids = new Set();
    for (const entry of manifest.tasks) {
      const filePath = confinedFile(root, entry.file);
      if (!filePath || !entry.file.startsWith('fixtures/') || typeof entry.sha256 !== 'string') {
        return invalidResult;
      }
      const bytes = await readFile(filePath);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== entry.sha256) return invalidResult;
      if (/sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|api[_-]?key\s*[:=]/iu.test(bytes.toString('utf8'))) {
        return invalidResult;
      }
      const fixture = validateStage1Fixture(JSON.parse(bytes.toString('utf8')));
      if (fixture.taskId !== entry.taskId || ids.has(fixture.taskId)) {
        return invalidResult;
      }
      ids.add(fixture.taskId);
      fixtures.push(fixture);
    }
    const summary = summarizeStage1Fixtures(fixtures);
    if (summary.byScenario.career_project !== 5 || summary.byScenario.learning_research !== 5 ||
        (summary.byRisk.stale_state_override ?? 0) < 2 ||
        (summary.byRisk.cross_project_contamination ?? 0) < 2 ||
        (summary.byRisk.unsupported_memory_claim ?? 0) < 1 ||
        (summary.byRisk.unauthorized_tool_attempt ?? 0) < 1 ||
        (summary.byRisk.intrusive_recall ?? 0) < 1) return invalidResult;
    for (const scenario of ['career_project', 'learning_research']) {
      const artifactTypes = new Set(fixtures.filter((fixture) => fixture.scenario === scenario)
        .map((fixture) => fixture.oracle.artifact.type));
      if (artifactTypes.size < 3) return invalidResult;
    }
    return {
      ok: true,
      protocolVersion: summary.protocolVersion,
      total: summary.total,
      byScenario: summary.byScenario,
      manifestBound: true
    };
  } catch (error) {
    if (error instanceof SyntaxError || error?.code === 'invalid_stage1_fixture') return invalidResult;
    throw error;
  }
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const defaultRoot = path.join(repositoryRoot, 'evaluation', 'stage1');
  try {
    const root = parseRoot(process.argv.slice(2), defaultRoot);
    const result = await validateFrozenStage1Set(root);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, errorCode: 'stage1_validator_operational_error' })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
