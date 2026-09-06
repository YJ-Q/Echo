import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { discoverSessions as discoverSessionsCore, captureSession as captureSessionCore } from './session-source.js';
import { generateHandoff as generateHandoffCore } from './index.js';
import { createWorkspaceOverview as createWorkspaceOverviewCore } from './workspace-overview.js';
import { getAgentResourceStatus as getAgentResourceStatusCore } from '../../resources/agentResourceService.js';

const MAX_LIST_LIMIT = 20;
const MAX_MARKDOWN_BYTES = 1_000_000;

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
    agent: 'Codex',
    cwd: session.cwd ?? null,
    workspaceKey: session.workspaceKey ?? null,
    workspaceName: session.workspaceName ?? null,
    branch: session.branch ?? null,
    summary: session.summary ?? null,
    label: session.label ?? null,
    updatedAt: session.updatedAt ?? null,
  };
}

function isDirectory(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { return fs.statSync(value).isDirectory(); } catch { return false; }
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
} = {}) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) throw new TypeError('invalid_handoff_adapter_dependencies');
  const app = express();
  // Keep every surface on the same Core discovery path. Passing the process
  // environment makes the user-profile resolution explicit instead of letting
  // a packaged Electron runtime accidentally select a different home.
  const discover = (codexHome, options) => discoverSessions(codexHome, { ...options, env });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => response.json({ ok: true, status: 'ready' }));

  // Resource status is a read-only, independent domain. A source failure is
  // represented as unavailable by the service and never takes down the board.
  app.get('/api/resources/status', (_request, response) => {
    try { response.json(getAgentResourceStatus()); }
    catch { response.json({ agents: [{ agent: 'codex', unavailable: true, resources: [] }, { agent: 'claude-code', unavailable: true }] }); }
  });

  app.get('/api/sessions', async (request, response) => {
    try {
      const workspaceKey = typeof request.query.workspaceKey === 'string' ? request.query.workspaceKey : null;
      const limit = clampLimit(request.query.limit);
      // The Board is its own scroll container, so its initial load remains a
      // complete resumable discovery result. An explicit API limit stays
      // bounded for callers that request one.
      const sessions = await discover(undefined, workspaceKey ? undefined : { ...(limit ? { limit } : {}) });
      response.json(ok({ sessions: (workspaceKey ? sessions.filter((session) => session.workspaceKey === workspaceKey) : sessions).map(sessionSummary) }));
    } catch (error) {
      response.status(503).json(fail('discovery_failed', error?.message ?? 'unknown_error'));
    }
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
      const meta = sessions.find((session) => session.id === sessionId);
      if (!meta) return response.status(404).json(fail('not_found', 'Session not found'));
      const repo = typeof request.body?.repo === 'string' && request.body.repo.trim() ? request.body.repo : meta.cwd;
      if (!isDirectory(repo)) return response.status(400).json(fail('invalid_repo', 'Workspace path is not a directory'));
      const snapshotPath = path.join(rootDir, 'handoff-output', 'web-sessions', `session-${sessionId}.jsonl`);
      const capture = captureSession(meta, snapshotPath);
      const { markdown, resumeSummary } = generateHandoff(capture, repo);
      response.json(ok({ markdown, resumeSummary, session: sessionSummary(meta) }));
    } catch (error) {
      response.status(500).json(fail('handoff_generation_failed', error?.message ?? 'unknown_error'));
    }
  });

  app.post('/api/handoff/save', (request, response) => {
    const { repo, markdown } = request.body ?? {};
    if (!isDirectory(repo)) return response.status(400).json(fail('invalid_repo', 'Workspace path is not a directory'));
    if (typeof markdown !== 'string' || !markdown.trim()) return response.status(400).json(fail('invalid_request', 'markdown is required'));
    if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) return response.status(400).json(fail('invalid_request', 'markdown too large'));
    try {
      const dir = path.join(repo, '.margin');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'HANDOFF.md');
      fs.writeFileSync(filePath, markdown, 'utf8');
      // A successful write call alone is not enough confirmation for the UI:
      // verify the exact target remains a regular file and contains this write.
      if (!fs.statSync(filePath).isFile() || fs.readFileSync(filePath, 'utf8') !== markdown) {
        throw new Error('Handoff write could not be verified');
      }
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
