import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildSpikePaths, buildSpikeToolPolicy } from '../scripts/run-pi-sdk-spike.js';

test('spike policy disables every built-in tool and allows only the audit tool', () => {
  assert.deepEqual(buildSpikeToolPolicy(), {
    noTools: 'builtin',
    tools: ['margin_spike_echo']
  });
});

test('spike paths stay under the explicit data directory', () => {
  const repositoryRoot = path.resolve('D:/repo');
  const paths = buildSpikePaths({
    repositoryRoot,
    dataDir: path.join(repositoryRoot, 'data', 'pi-spike')
  });
  assert.equal(paths.sessionDir, path.join(repositoryRoot, 'data', 'pi-spike', 'sessions'));
  assert.equal(paths.reportPath, path.join(repositoryRoot, 'data', 'pi-spike', 'report.json'));
});

test('spike rejects data directories outside the repository', () => {
  assert.throws(
    () => buildSpikePaths({ repositoryRoot: 'D:/repo', dataDir: 'D:/outside' }),
    /must stay inside the repository/
  );
  assert.throws(
    () => buildSpikePaths({ repositoryRoot: 'D:/repo', dataDir: 'D:/repo' }),
    /must not be the repository root/
  );
});
