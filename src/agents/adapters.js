import { detectAgentSources, validateSource } from './sourceRegistry.js';
import { discoverSessions as discoverCodexSessions, computeSourceRevision as computeCodexSourceRevision } from '../core/handoff/session-source.js';
import { discoverClaudeSessions, discoverPiSessions, computeExternalSessionRevision } from './externalSessionDiscovery.js';
import { collectPiResourceSnapshot } from '../resources/piApiUsage.js';
import { readGoQuotaResources } from '../resources/opencodeGoQuota.js';
import { resourceStatusOf } from '../resources/agentResourceService.js';
import { captureSession as captureSessionCore } from '../core/handoff/session-source.js';
import { generatePiHandoff } from './pi/piHandoff.js';
import { generateClaudeHandoff } from './claude/claudeHandoff.js';

// Every agent uses this source-facing shape.  A false capability is represented
// by an intentionally empty stub, never by inferred session/resource data.
const unsupportedSnapshots = async () => [];
const unsupportedResources = async () => null;
const baseCapabilities = Object.freeze({ sessions: true, handoff: false, apiUsage: false, quota: false, executionStatus: false, attentionStatus: false });

function asSnapshot(session, source, capabilities) {
  const agentType = session.agentType ?? source.agentType ?? source.type;
  const sourceId = session.sourceId ?? source.sourceId ?? source.id;
  const nativeSessionId = session.nativeSessionId ?? session.id;
  return {
    ...session,
    id: nativeSessionId,
    agentType,
    sourceId,
    nativeSessionId,
    canonicalId: `${agentType}:${sourceId}:${nativeSessionId}`,
    displayTitle: session.displayTitle ?? session.label ?? `Untitled session · ${String(nativeSessionId).slice(0, 8)}`,
    titleSource: session.titleSource ?? 'fallback-id',
    workspace: session.workspace ?? { key: session.workspaceKey ?? null, name: session.workspaceName ?? null },
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
    executionStatus: session.executionStatus ?? 'unknown',
    attentionStatus: session.attentionStatus ?? 'none',
    capabilities: { ...baseCapabilities, ...(source.capabilities ?? {}), ...capabilities },
  };
}

const snapshotCollector = (agentType, collect, capabilities) => async (source, options = {}) => {
  const sessions = await collect(source, options);
  return sessions.map((session) => asSnapshot({ ...session, agentType }, source, capabilities));
};

// `collectSessionSnapshots` remains the compatibility projection used by the CLI and older
// callers.  The Board reads this explicit result form so an I/O failure is never mistaken for
// a legitimate empty source.
const snapshotRead = (collect) => async (source, options = {}) => {
  try {
    const validation = validateSource(source);
    if (!validation.valid) return { ok: false, error: { code: 'source_unavailable', message: validation.reason } };
    return { ok: true, snapshots: await collect(source, options) };
  } catch (error) {
    return { ok: false, error: { code: 'source_read_failed', message: error?.message ?? 'Unable to read agent source' } };
  }
};

const unsupportedRevision = () => null;
const stubAdapter = (agentType) => Object.freeze({ agentType, detect: detectAgentSources, validateSource, collectSessionSnapshots: unsupportedSnapshots, readSessionSnapshots: snapshotRead(unsupportedSnapshots), getSessionRevision: unsupportedRevision, discoverSessions: unsupportedSnapshots, getResourceStatus: unsupportedResources, collectResourceSnapshot: unsupportedResources });

// Every resource adapter returns the SAME unified envelope { ok, status, revision, agents } where
// each agent record carries its own resources/freshAt/stale/unavailable. The envelope is a read
// truth, never an instruction: consumers render it as-is and the service domain owns LKG semantics.
async function codexResourceStatus(source, options = {}) {
  const { getAgentResourceStatus } = await import('../resources/agentResourceService.js');
  return getAgentResourceStatus({ ...options, source });
}
async function piResourceStatus(source, options = {}) {
  const fallbackRevision = options.revision ?? null;
  if (!source?.path) {
    const agents = [piAgent(fallbackRevision, null, null, false, true)];
    return { ok: true, status: resourceStatusOf(agents), revision: fallbackRevision, agents };
  }
  const now = options.now;
  // Two independent readers under one Pi source: API Today (local JSONL aggregation) and the
  // OpenCode Go subscription quota (live structured endpoint). They are never added/converted.
  const apiSnapshot = collectPiResourceSnapshot({ source, revision: options.revision, now });
  const goQuota = await readGoQuotaResources({ home: source.path, now, fetchFn: options.fetchGoQuota ?? undefined });
  const agents = [piAgent(fallbackRevision, apiSnapshot, goQuota, false, false)];
  return { ok: true, status: resourceStatusOf(agents), revision: fallbackRevision, agents };
}

// Unified Pi agent record merging PI Today API usage and, when a structured Go quota is available,
// the 5h/7d/M subscription remaining windows. Credential never appears in this record.
function piAgent(revision, apiSnapshot, goQuota, stale, unavailable) {
  const apiRecord = apiSnapshot ? {
    resourceType: 'tokenUsage', accessMode: 'api', scope: 'today',
    totalTokens: apiSnapshot.totalTokens ?? 0,
    trustedResponseCount: apiSnapshot.trustedApiResponses ?? 0,
    ...(apiSnapshot.coverage ? { coverage: apiSnapshot.coverage } : {}),
    provenance: apiSnapshot.provenance ?? null,
  } : null;
  const goRecords = goQuota?.resources ?? [];
  const resources = [apiRecord, ...goRecords].filter(Boolean);
  const unbornUnavailable = unavailable === true;
  const mergedUnavailable = resources.length === 0 && (Boolean(apiSnapshot?.unavailable) && goQuota?.available === false);
  const agent = {
    agent: 'pi', provider: 'pi',
    revision, freshAt: goQuota?.freshAt ?? apiSnapshot?.freshAt ?? null,
    stale: Boolean(apiSnapshot?.stale) || goQuota?.stale === true,
    resources,
  };
  // Data-driven capability: only present when the structured reader actually succeeded/held LKG.
  // Never claimed solely because the provider is named opencode-go.
  if (goQuota?.available === true) agent.subscriptionQuota = true;
  if (unbornUnavailable || mergedUnavailable) agent.unavailable = true;
  return agent;
}

const codexSnapshots = snapshotCollector('codex', (source, { codexDiscoverSessions = discoverCodexSessions, ...options } = {}) =>
  codexDiscoverSessions(source.path, { ...options, sourceId: source.sourceId ?? source.id, agentType: 'codex' }), { handoff: true, apiUsage: true, quota: true, executionStatus: true });
const codexRevision = (source, { computeCodexRevision = computeCodexSourceRevision } = {}) => computeCodexRevision({ codexHome: source.path, source });
const claudeSnapshots = snapshotCollector('claude', discoverClaudeSessions, { handoff: true });
const piSnapshots = snapshotCollector('pi', discoverPiSessions, { handoff: true });
const claudeRevision = (source, options = {}) => computeExternalSessionRevision(source, ['projects'], options);
const piRevision = (source) => computeExternalSessionRevision(source, ['agent', 'sessions']);

export const agentAdapters = Object.freeze({
  codex: Object.freeze({ agentType: 'codex', detect: detectAgentSources, validateSource, collectSessionSnapshots: codexSnapshots, readSessionSnapshots: snapshotRead(codexSnapshots), getSessionRevision: codexRevision, discoverSessions: codexSnapshots, getResourceStatus: codexResourceStatus, collectResourceSnapshot: codexResourceStatus }),
  claude: Object.freeze({ agentType: 'claude', detect: detectAgentSources, validateSource, collectSessionSnapshots: claudeSnapshots, readSessionSnapshots: snapshotRead(claudeSnapshots), getSessionRevision: claudeRevision, discoverSessions: claudeSnapshots, getResourceStatus: unsupportedResources, collectResourceSnapshot: unsupportedResources, captureSession: captureSessionCore, generateHandoff: generateClaudeHandoff }),
  pi: Object.freeze({ agentType: 'pi', detect: detectAgentSources, validateSource, collectSessionSnapshots: piSnapshots, readSessionSnapshots: snapshotRead(piSnapshots), getSessionRevision: piRevision, discoverSessions: piSnapshots, getResourceStatus: piResourceStatus, collectResourceSnapshot: piResourceStatus, captureSession: captureSessionCore, generateHandoff: generatePiHandoff }),
});

export function adapterFor(type) { return agentAdapters[type] ?? null; }
