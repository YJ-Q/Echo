import { readLatestCodexQuotaSnapshot } from './codexQuotaSource.js';
import { normalizeCodexQuotaSnapshot } from './normalizeAgentResource.js';

export function getAgentResourceStatus({ readLatestSnapshot = readLatestCodexQuotaSnapshot } = {}) {
  let resources = [];
  try { resources = normalizeCodexQuotaSnapshot(readLatestSnapshot()); } catch { resources = []; }
  return {
    agents: [
      resources.length ? { agent: 'codex', resources } : { agent: 'codex', unavailable: true, resources: [] },
      { agent: 'claude-code', unavailable: true }
    ]
  };
}
