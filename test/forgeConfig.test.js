import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const forgeConfig = require('../forge.config.cjs');

function ignored(filePath) {
  return forgeConfig.packagerConfig.ignore.some((rule) => rule.test(filePath));
}

test('Forge ignores only generated project data, never dependency runtime data assets', () => {
  const root = path.resolve('.');
  assert.equal(ignored(path.join(root, 'data', 'margin.db')), true);
  assert.equal(ignored(path.join(root, 'docs', 'validation', 'private-smoke.json')), true);
  assert.equal(ignored(path.join(root, 'node_modules', '@earendil-works', 'pi-coding-agent', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data', 'amazon-bedrock.json')), false);
});
