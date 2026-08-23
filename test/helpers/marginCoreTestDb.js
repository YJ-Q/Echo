import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openMarginCoreStore } from '../../src/core/marginCoreStore.js';

export async function createMarginCoreTestDb(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-core-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const store = await openMarginCoreStore({ dbPath, ...options });
  return {
    directory,
    dbPath,
    store,
    async cleanup() {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}
