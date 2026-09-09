import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { discoverSessions as discoverSessionsCore, captureSession as captureSessionCore, computeSourceRevision as computeSourceRevisionCore } from './session-source.js';
import { generateHandoff as generateHandoffCore } from './index.js';
import { createHandoffArtifact } from './handoffArtifact.js';
import { saveHandoffArtifact } from './save.js';
import { createWorkspaceOverview as createWorkspaceOverviewCore } from './workspace-overview.js';
import { getAgentResourceStatus as getAgentResourceStatusCore, resourceStatusOf } from '../../resources/agentResourceService.js';
import { AGENT_TYPES, readAgentSourceRegistry, writeAgentSourceRegistry, detectAgentSources, registerAgentSource, removeAgentSource, resolveActiveSource, validateSource } from '../../agents/sourceRegistry.js';
import { adapterFor } from '../../agents/adapters.js';

const MAX_LIST_LIMIT = 20;

function ok(data) { return { ok: true, data }; }
function fail(code, message) { return { ok: false, error: { code, message } }; }

function clampLimit(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return MAX_LIST_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIST_LIMIT);
}

// Only pass through browser-safe fields derived by the discovery layer.
function sessionSummary(session) {
  return {
    id: session.id,
    nativeSessionId: session.nativeSessionId ?? session.id,
    canonicalId: session.canonicalId,
    sourceId: session.sourceId ?? null,
    agentType: session.agentType ?? 'codex',
    agent: session.agentType === 'claude' ? 'Claude' : session.agentType === 'pi' ? 'Pi' : 'Codex',
    cwd: session.cwd ?? null,
    workspace: session.workspace ?? { key: session.workspaceKey ?? null, name: session.workspaceName ?? null },
    workspaceKey: session.workspaceKey ?? null,
    workspaceName: session.workspaceName ?? null,
    branch: session.branch ?? null,
    summary: session.summary ?? null,
    label: session.label ?? null,
    displayTitle: session.displayTitle ?? session.label ?? null,
    titleSource: session.titleSource ?? null,
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
    executionStatus: session.executionStatus ?? 'unknown',
    attentionStatus: session.attentionStatus ?? 'none',
    capabilities: session.capabilities ?? { sessions: true, handoff: false, executionStatus: false, attentionStatus: false },
  };
}

function isDirectory(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { return fs.statSync(value).isDirectory(); } catch { return false; }
}

function resourceAgentName(type) { return type === 'claude' ? 'claude-code' : type; }
function unavailableResourceAgent(type, revision) {
  const provider = type === 'codex' ? 'openai' : type === 'pi' ? 'pi' : null;
  return { agent: resourceAgentName(type), ...(provider ? { provider } : {}), revision, freshAt: null, stale: false, unavailable: true, resources: [] };
}

// Minimal, independent boundary: browser UI never touches the Codex filesystem
// or the repo directly. It only reaches the handoff Core through these three
// routes. Deliberately not wired into src/http/webGateway.js — that gateway is
// bound to the old Workstream/Run/Memory Application Contract, and reusing it
// here would re-couple this Core to that business model.
export function createHandoffHttpAdapter({
  rootDir,
  staticDir,
  viteMiddleware,
  env = process.env,
  discoverSessions = discoverSessionsCore,
  captureSession = captureSessionCore,
  generateHandoff = generateHandoffCore,
  createWorkspaceOverview = createWorkspaceOverviewCore,
  getAgentResourceStatus = getAgentResourceStatusCore,
  computeSourceRevision = computeSourceRevisionCore,
  readRegistry = readAgentSourceRegistry,
  writeRegistry = writeAgentSourceRegistry,
  adapterResolver = adapterFor,
} = {}) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) throw new TypeError('invalid_handoff_adapter_dependencies');
  const app = express();
  const hasInjectedCodexDiscovery = discoverSessions !== discoverSessionsCore;
  const hasInjectedDependencies = hasInjectedCodexDiscovery
    || readRegistry !== readAgentSourceRegistry
    || writeRegistry !== writeAgentSourceRegistry;
  // Keep every surface on the same Core discovery path. Passing the process
  // environment makes the user-profile resolution explicit instead of letting
  // a packaged Electron runtime accidentally select a different home.
  const registryOptions = { env };
  const registry = () => {
    const current = readRegistry(registryOptions);
    if (current?.ok === false) {
      const error = new Error(current.error?.message ?? 'Unable to read agent source registry');
      error.code = current.error?.code ?? 'registry_unreadable';
      throw error;
    }
    return current;
  };
  // Startup detection is convenience only: persisted manual sources keep priority and
  // remain untouched. Doing it at the shared HTTP boundary gives Electron the same
  // standard-source behavior as `margin agent detect`.
  if (!hasInjectedDependencies) {
    try {
      const detected = detectAgentSources(registry(), registryOptions);
      writeRegistry(detected.registry, registryOptions);
    } catch { /* Registry failure is fail-safe: never replace it with detected defaults. */ }
  }
  const activeCodex = () => resolveActiveSource(registry(), 'codex', registryOptions);
  const enabledSources = () => AGENT_TYPES.map((type) => resolveActiveSource(registry(), type, registryOptions)).filter((source) => source?.enabled);
  // Each enabled source is isolated: a malformed or unreadable Claude/Pi home must never
  // hide Codex (or another agent) sessions. Manual-vs-detected precedence is resolved per type.
  // Kept per source rather than as one global list so one unavailable Agent cannot make a
  // successful empty read from another Agent delete its sessions.  It is intentionally an
  // in-memory LKG cache, not a session shadow store.
  const sourceLastKnownGood = new Map();
  const sourceReadStatus = new Map(); // { stale, unavailable, error }; diagnostic-only, never UI truth
  const injectedCodexSource = { id: 'injected-codex', sourceId: 'injected-codex', type: 'codex', agentType: 'codex', path: rootDir, enabled: true,
    capabilities: { sessions: true, handoff: true, apiUsage: true, quota: true, executionStatus: true, attentionStatus: false } };
  const discover = async (_unused, options = {}) => {
    const sources = hasInjectedCodexDiscovery
      ? [injectedCodexSource]
      : AGENT_TYPES.map((type) => resolveActiveSource(registry(), type, registryOptions)).filter(Boolean);
    let sourceReadFailed = false;
    const settled = await Promise.all(sources.map(async (source) => {
      const adapter = adapterResolver(source.type);
      if (!source.enabled || !adapter) return [];
      const result = adapter.readSessionSnapshots
        ? await adapter.readSessionSnapshots(source, { ...options, env, codexDiscoverSessions: discoverSessions, computeCodexRevision: computeSourceRevision })
        : await (async () => { try { return { ok: true, snapshots: await adapter.collectSessionSnapshots(source, { ...options, env, codexDiscoverSessions: discoverSessions, computeCodexRevision: computeSourceRevision }) }; } catch (error) { return { ok: false, error }; } })();
      if (result?.ok) {
        // A successful empty read is authoritative and therefore intentionally clears this
        // source's LKG.  Only an explicit failed result retains it.
        sourceLastKnownGood.set(source.id, result.snapshots ?? []);
        sourceReadStatus.set(source.id, { stale: false, unavailable: false, error: null });
        return result.snapshots ?? [];
      }
      sourceReadFailed = true;
      sourceReadStatus.set(source.id, { stale: true, unavailable: !sourceLastKnownGood.has(source.id), error: result?.error ?? null });
      if (sourceLastKnownGood.has(source.id)) return sourceLastKnownGood.get(source.id);
      const error = new Error(result?.error?.message ?? 'Unable to read agent source');
      error.code = result?.error?.code ?? 'source_read_failed';
      throw error;
    }));
    const snapshots = settled.flat().sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0));
    // Keep the established array contract for non-Board Core callers, while preserving whether
    // this aggregate is a trustworthy snapshot.  The HTTP Board path consumes this marker and
    // retains its own LKG rather than committing a partial read as current truth.
    Object.defineProperty(snapshots, 'snapshotComplete', { value: !sourceReadFailed });
    return snapshots;
  };
  // S2 live-sync aggregates adapter-owned source revisions. A revision is only a cheap re-read
  // signal: adapters remain the sole owners of session facts and lifecycle semantics.
  const currentRevision = () => {
    const sources = hasInjectedCodexDiscovery ? [injectedCodexSource] : enabledSources();
    const signatures = sources.map((source) => {
      const adapter = adapterResolver(source.type);
      if (!adapter?.getSessionRevision) throw new Error(`No revision reader for ${source.type}`);
      const revision = adapter.getSessionRevision(source, { computeCodexRevision: computeSourceRevision });
      if (!revision) throw new Error(`Unable to read revision for ${source.type}`);
      return revision;
    });
    return signatures.length ? createHash('sha256').update(signatures.sort().join('\n')).digest('hex') : null;
  };
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => response.json({ ok: true, status: 'ready' }));

  // Resource status is a read-only, independent domain. Every resource adapter returns the same
  // unified envelope { ok, status, revision, agents } whose agents carry their own resource
  // records/freshAt/stale/unavailable — the service owns LKG semantics, so a source failure is
  // represented as stale/unavailable by the domain and never takes down the board. The S3 live
  // reader is keyed to the same S2 source `revision` so an unchanged revision never triggers a
  // resource re-read; the reader carries last-known-good quota across archive/switch and token
  // usage is kept separate. Provider-specific binding stays inside its adapter; this boundary
  // only folds adapter envelopes and supplies an unavailable record when a source is absent.
  app.get('/api/resources/status', async (_request, response) => {
    const source = activeCodex();
    let revision = null;
    try { revision = currentRevision(); } catch { /* advisory; a failed revision read is never fatal */ }
    const fallback = {
      ok: true, status: 'unavailable', revision,
      agents: AGENT_TYPES.map((type) => ({ ...unavailableResourceAgent(type, revision), ...(type === 'codex' ? { stale: true } : {}) })),
    };
    try {
      const codex = getAgentResourceStatus({ codexHome: source?.path, source, revision });
      const current = registry();
      const byAgent = new Map((codex?.agents ?? []).filter((agent) => agent.agent !== 'claude-code').map((agent) => [agent.agent, agent]));

      // Claude and Pi are supplemental resource adapters. Each read is isolated so a provider
      // binding/network failure produces only that agent's unavailable/LKG truth.
      for (const type of ['claude', 'pi']) {
        const sourceForType = resolveActiveSource(current, type, registryOptions);
        const adapter = sourceForType ? adapterResolver(type) : null;
        let result = null;
        if (sourceForType?.enabled && adapter?.collectResourceSnapshot) {
          let sourceRevision = null;
          try { sourceRevision = adapter.getSessionRevision ? adapter.getSessionRevision(sourceForType) : null; } catch { /* advisory; never fatal */ }
          try {
            result = await adapter.collectResourceSnapshot(sourceForType, { revision: sourceRevision, env, now: Date.now() });
          } catch { /* one provider's resource failure must not affect other agents */ }
        }
        const agent = result?.agents?.find((item) => item.agent === resourceAgentName(type));
        byAgent.set(resourceAgentName(type), agent ?? unavailableResourceAgent(type, revision));
      }

      // Keep a stable visual order and ensure every supported agent remains represented without
      // hardcoding a Claude-specific placeholder in the HTTP contract.
      const agents = AGENT_TYPES.map((type) => byAgent.get(resourceAgentName(type)) ?? unavailableResourceAgent(type, revision));
      response.json({ ok: true, status: resourceStatusOf(agents), revision: codex?.revision ?? revision ?? null, agents });
    }
    catch { response.json(fallback); }
  });

  app.get('/api/agent-sources', (_request, response) => {
    try {
      const current = registry();
      response.json(ok({ sources: current.sources.map((source) => ({ ...source, validation: validateSource(source), active: resolveActiveSource(current, source.type, registryOptions)?.id === source.id })) }));
    } catch (error) { response.status(503).json(fail(error.code ?? 'registry_unreadable', error.message)); }
  });

  app.post('/api/agent-sources/detect', (_request, response) => {
    try {
      const result = detectAgentSources(registry(), registryOptions);
      const saved = writeRegistry(result.registry, registryOptions);
      response.json(ok({ sources: saved.sources, detected: result.detected.map((source) => source.id) }));
    } catch (error) { response.status(503).json(fail(error.code ?? 'registry_unreadable', error.message)); }
  });

  app.post('/api/agent-sources', (request, response) => {
    try {
      let current = registry();
      if (typeof request.body?.replaceId === 'string') current = removeAgentSource(current, request.body.replaceId);
      const next = registerAgentSource(current, { type: request.body?.type, path: request.body?.path, name: request.body?.name, origin: 'manual' });
      const saved = writeRegistry(next, registryOptions);
      response.status(201).json(ok({ sources: saved.sources }));
    } catch (error) { response.status(error?.code === 'registry_unreadable' ? 503 : 400).json(fail(error?.code ?? 'invalid_source', error?.message ?? 'Invalid source')); }
  });

  app.delete('/api/agent-sources/:id', (request, response) => {
    try {
      const current = registry();
      const source = current.sources.find((item) => item.id === request.params.id);
      if (!source) return response.status(404).json(fail('not_found', 'Source not found'));
      if (source.origin !== 'manual') return response.status(400).json(fail('auto_source', 'Auto-detected sources cannot be removed'));
      response.json(ok({ sources: writeRegistry(removeAgentSource(current, source.id), registryOptions).sources }));
    } catch (error) { response.status(error?.code === 'registry_unreadable' ? 503 : 400).json(fail(error?.code ?? 'invalid_source', error?.message ?? 'Invalid source')); }
  });

  app.get('/api/sessions', async (request, response) => {
    try {
      const workspaceKey = typeof request.query.workspaceKey === 'string' ? request.query.workspaceKey : null;
      const limit = clampLimit(request.query.limit);
      // The Board is its own scroll container, so its initial load remains a
      // complete resumable discovery result. An explicit API limit stays
      // bounded for callers that request one.
      // A revision is the basis of a snapshot, not a value observed after it.  If a native
      // writer changes the source during discovery, retry on the next 500 ms reconciliation
      // instead of publishing old session facts labelled with the new revision.
      const revisionBefore = currentRevision();
      const sessions = await discover(undefined, workspaceKey ? undefined : { ...(limit ? { limit } : {}) });
      const revisionAfter = currentRevision();
      if (!sessions.snapshotComplete) throw Object.assign(new Error('One or more agent sources could not be read'), { code: 'source_read_failed' });
      if (revisionBefore !== revisionAfter) throw Object.assign(new Error('Source changed during snapshot read'), { code: 'snapshot_changed_during_read' });
      const mapped = (workspaceKey ? sessions.filter((session) => session.workspaceKey === workspaceKey) : sessions).map(sessionSummary);
      response.json(ok({ revision: revisionAfter, sessions: mapped }));
    } catch (error) {
      response.status(503).json(fail(error?.code ?? 'discovery_failed', error?.message ?? 'unknown_error'));
    }
  });

  // S2 live-sync: the cheap source revision alone. A failure never returns partial data — the
  // renderer treats a non-ok/missing revision as "keep the shown snapshot".
  app.get('/api/sessions/revision', (_request, response) => {
    try { response.json(ok({ revision: currentRevision() })); }
    catch (error) { response.status(503).json(fail('revision_unavailable', error?.message ?? 'Unable to read source revision')); }
  });

  app.get('/api/workspace-overview', async (request, response) => {
    const workspaceKey = typeof request.query.workspaceKey === 'string' ? request.query.workspaceKey : '';
    if (!workspaceKey.trim()) return response.status(400).json(fail('invalid_request', 'workspaceKey is required'));
    try {
      // Deliberately unbounded: /api/sessions is a global display list and may
      // be truncated, while this workspace-specific navigation must be exact.
      const sessions = await discover();
      const workspaceSessions = sessions.filter((session) => session.workspaceKey === workspaceKey);
      if (!workspaceSessions.length) return response.status(404).json(fail('not_found', 'Workspace not found'));
      const workspaceName = workspaceSessions[0].workspaceName ?? 'Unknown workspace';
      response.json(ok(createWorkspaceOverview({ workspaceKey, workspaceName, sessions: workspaceSessions })));
    } catch (error) {
      response.status(503).json(fail('workspace_overview_failed', error?.message ?? 'unknown_error'));
    }
  });

  app.post('/api/handoff/generate', async (request, response) => {
    const sessionId = request.body?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return response.status(400).json(fail('invalid_request', 'sessionId is required'));
    }
    try {
      const sessions = await discover();
      // The browser always sends the canonical identity. Do not fall back to a
      // native id, title, workspace, or recency: more than one source can have
      // the same native id and a canonical id must pinpoint its exact source.
      const meta = sessions.find((session) => session.canonicalId === sessionId);
      if (!meta) return response.status(404).json(fail('not_found', 'Session not found'));
      if (meta.capabilities?.handoff === false) return response.status(400).json(fail('unsupported_action', 'Handoff is not supported for this session'));
      const repo = typeof request.body?.repo === 'string' && request.body.repo.trim() ? request.body.repo : meta.cwd;
      if (!isDirectory(repo)) return response.status(400).json(fail('invalid_repo', 'Workspace path is not a directory'));
      // Each agent adapter owns its capture/generation path (Pi evidence extractor vs the shared
      // Codex one). Fall back to the injected Codex defaults for any adapter without its own.
      const adapter = adapterResolver(meta.agentType);
      const sessionCapturer = adapter?.captureSession ?? captureSession;
      const handoffGenerator = adapter?.generateHandoff ?? generateHandoff;
      const artifact = createHandoffArtifact({ session: meta, canonicalId: sessionId, rootDir, workspace: repo, captureSession: sessionCapturer, generateHandoff: handoffGenerator });
      response.json(ok({ markdown: artifact.markdown, resumeSummary: artifact.resumeSummary, session: sessionSummary(meta) }));
    } catch (error) {
      response.status(500).json(fail('handoff_generation_failed', error?.message ?? 'unknown_error'));
    }
  });

  app.post('/api/handoff/save', (request, response) => {
    const { repo, markdown } = request.body ?? {};
    if (!isDirectory(repo)) return response.status(400).json(fail('invalid_repo', 'Workspace path is not a directory'));
    if (typeof markdown !== 'string' || !markdown.trim()) return response.status(400).json(fail('invalid_request', 'markdown is required'));
    try {
      const filePath = saveHandoffArtifact({ repo, markdown });
      response.json(ok({ path: filePath }));
    } catch (error) {
      response.status(500).json(fail('checkpoint_write_failed', error?.message ?? 'unknown_error'));
    }
  });

  if (typeof viteMiddleware === 'function') app.use(viteMiddleware);
  else if (staticDir) app.use(express.static(staticDir, { index: 'margin.html' }));

  app.use((_request, response) => response.status(404).json(fail('not_found', 'Not found')));

  return app;
}
