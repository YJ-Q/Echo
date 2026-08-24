import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

test('Stage 2 Core remains Pi-independent beneath the documented Phase 2B Web composition', async () => {
  const report = await readFile('docs/audit/stage_2_core_report.md', 'utf8');
  for (const exclusion of ['Pi adapter', 'legacy migration', '50-task', 'A/B/C evaluation', 'user research']) assert.match(report, new RegExp(exclusion, 'iu'));
  assert.doesNotMatch(report, /\b\d+(?:\.\d+)?%\b/u);
  const coreFiles = await readdir('src/core', { recursive: true });
  for (const file of coreFiles.filter((name) => name.endsWith('.js'))) {
    const source = await readFile(path.join('src/core', file), 'utf8');
    assert.doesNotMatch(source, /@earendil-works\/pi|pi-coding-agent/u);
  }
  const environment = await readFile('.env.example', 'utf8');
  assert.match(environment, /^MARGIN_CORE_DB_PATH=\.\/data\/terminal-pilot\/margin-core\.sqlite$/mu);
  assert.match(environment, /^MARGIN_PI_API_KEY_ENV=YAPI_API_KEY$/mu);
});
