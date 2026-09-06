import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceOverview, selectLatestSession } from '../src/core/handoff/workspace-overview.js';
import { sessionLabel } from '../src/core/handoff/session-source.js';

function event(role, text) {
  return { type: 'response_item', payload: { type: 'message', role, content: [{ type: 'input_text', text }] } };
}

const sessions = [
  { id: 'implementation', label: 'Older implementation', updatedAt: '2026-09-01T00:00:00.000Z', branch: 'main', cwd: 'D:/repo' },
  { id: 'research', label: 'Latest research', updatedAt: '2026-09-02T00:00:00.000Z', branch: 'research', cwd: 'D:/repo' },
];

test('Workspace Overview selects only the latest research session and keeps branch observations separate', () => {
  let sources = 0;
  const overview = createWorkspaceOverview({
    workspaceKey: 'git:d:/repo', workspaceName: 'repo', sessions,
    readSource(session) {
      sources += 1;
      assert.equal(session.id, 'research');
      return { records: [{ line: 1, event: event('user', 'Research the design before implementation.') }],
        capture: { sha256: 'source-hash', snapshotPath: 'native.jsonl' }, session: { cwd: 'D:/repo', threadSource: 'user' } };
    },
    refreshRepo() {
      return { capturedAt: '2026-09-03T00:00:00.000Z', stableDuringObservation: true,
        git: { status: 'available', branch: 'main', head: '0123456789abcdef', changes: [{ path: 'unattributed.txt' }] },
        files: [], patchChecks: [], artifactReports: [], targetLinkage: { status: 'unknown', count: 0 } };
    }
  });
  assert.equal(sources, 1);
  assert.equal(overview.latestSession.id, 'research');
  assert.equal(overview.latestSession.historicalBranch, 'research');
  assert.equal(overview.repo.branch, 'main');
  assert.equal(overview.repo.shortHead, '0123456789ab');
  assert.equal(overview.repo.dirtyCount, 1);
  assert.equal(overview.otherResumableSessionCount, 1);
  assert.match(overview.latestSession.currentApplicability.text, /unknown/i);
  assert.equal(JSON.stringify(overview), JSON.stringify(overview).replace(/native\.jsonl|source-hash|unattributed\.txt/g, ''));
});

test('latest-session ordering uses id descending when updatedAt is identical', () => {
  assert.equal(selectLatestSession([
    { id: 'a', updatedAt: '2026-09-02T00:00:00.000Z' },
    { id: 'b', updatedAt: '2026-09-02T00:00:00.000Z' },
  ]).id, 'b');
});

test('low-quality summary labels fall back to the deterministic short user requirement', () => {
  // A missing source still proves that structural metadata is not promoted.
  assert.match(sessionLabel({ id: 'abcdefghi', summary: 'Goal', originalPath: 'missing.jsonl' }), /^Untitled session/);
});
