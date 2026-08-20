import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  try {
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    if (manifest.protocolVersion !== STAGE1_PROTOCOL_VERSION || !Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
      return { ok: false, errorCode: 'stage1_fixture_validation_failed' };
    }
    const fixtures = [];
    const ids = new Set();
    for (const entry of manifest.tasks) {
      const filePath = confinedFile(root, entry.file);
      if (!filePath || !entry.file.startsWith('fixtures/') || typeof entry.sha256 !== 'string') {
        return { ok: false, errorCode: 'stage1_fixture_validation_failed' };
      }
      const bytes = await readFile(filePath);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== entry.sha256) return { ok: false, errorCode: 'stage1_fixture_validation_failed' };
      const fixture = validateStage1Fixture(JSON.parse(bytes.toString('utf8')));
      if (fixture.taskId !== entry.taskId || ids.has(fixture.taskId)) {
        return { ok: false, errorCode: 'stage1_fixture_validation_failed' };
      }
      ids.add(fixture.taskId);
      fixtures.push(fixture);
    }
    const summary = summarizeStage1Fixtures(fixtures);
    return {
      ok: true,
      protocolVersion: summary.protocolVersion,
      total: summary.total,
      byScenario: summary.byScenario,
      manifestBound: true
    };
  } catch {
    return { ok: false, errorCode: 'stage1_fixture_validation_failed' };
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
