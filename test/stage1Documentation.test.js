import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const protocolUrl = new URL('../docs/evaluation/stage_1_protocol.md', import.meta.url);
const reportUrl = new URL('../docs/audit/stage_1_freeze_report.md', import.meta.url);
const manifestUrl = new URL('../evaluation/stage1/manifest.json', import.meta.url);

test('Stage 1 documentation preserves scenarios, architecture, and claim boundaries', async () => {
  const protocol = await readFile(protocolUrl, 'utf8');
  const report = await readFile(reportUrl, 'utf8');
  const combined = `${protocol}\n${report}`;
  for (const phrase of [
    'learning_research',
    'career_project',
    'recap_without_progress',
    'Margin Core',
    'Pi Extension Adapter',
    'Skill Policy',
    'synthetic',
    'not user validation'
  ]) assert.match(combined, new RegExp(phrase, 'u'));
  assert.doesNotMatch(combined, /\b\d+(?:\.\d+)?%/u);
  assert.doesNotMatch(combined, /(?:success rate|adoption rate|precision|recall)\s*(?:is|was|=|:)/iu);
});

test('freeze report enumerates every manifest task without claiming measured results', async () => {
  const report = await readFile(reportUrl, 'utf8');
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  for (const task of manifest.tasks) assert.match(report, new RegExp(task.taskId, 'u'));
  assert.match(report, /A\/B\/C baselines have not been run/u);
  assert.match(report, /does not implement production State\/Memory/u);
});
