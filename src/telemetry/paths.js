// S4 Cost Telemetry — on-disk location helpers. Telemetry lives under the same per-user margin
// profile dir that `sourceRegistry.registryPath()` owns (`~/.margin`), so it follows the user across
// repos and hosts, and is never written into a Codex home or a repo. Every consumer accepts an
// explicit `dir` override for tests/portable runs.

import path from 'node:path';
import { registryPath } from '../agents/sourceRegistry.js';

export function telemetryProfileDir(options = {}) {
  // dirname(registryPath) == <profile>/.margin
  return path.join(path.dirname(registryPath(options)), 'telemetry');
}

export function usageLogPath(dir) {
  return path.join(dir, 'usage.jsonl');
}

export function pricesPath(dir) {
  return path.join(dir, 'prices.json');
}

export function usageLockPath(dir) {
  return path.join(dir, 'usage.jsonl.lock');
}
