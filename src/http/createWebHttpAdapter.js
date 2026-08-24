import express from 'express';
import { failureEnvelope, hasForbiddenBrowserField, httpStatusFor, sanitizeBrowserEnvelope } from './httpErrors.js';

export function createWebHttpAdapter({ webGateway, interactionService, staticDir, viteMiddleware } = {}) {
  if (!webGateway?.execute || !webGateway?.query || !webGateway?.events) throw new TypeError('invalid_web_http_dependencies');
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  if (typeof staticDir === 'function') app.use(staticDir);
  else if (staticDir) app.use(express.static(staticDir));
  if (typeof viteMiddleware === 'function') app.use(viteMiddleware);

  app.post('/api/commands', asyncRoute((request) => webGateway.execute(request)));
  app.post('/api/queries', asyncRoute((request) => webGateway.query(request)));
  app.get('/api/events', asyncRoute((request) => webGateway.events(request)));
  app.post('/api/interactions', async (request, response) => {
    const requestId = request.body?.requestId;
    if (hasForbiddenBrowserField(request.body)) return respond(response, failureEnvelope({ code: 'invalid_request', requestId }));
    if (!interactionService?.handle) return respond(response, failureEnvelope({ code: 'runtime_unavailable', requestId }));
    try { return respond(response, sanitizeBrowserEnvelope(await interactionService.handle(request.body), { requestId })); }
    catch { return respond(response, failureEnvelope({ code: 'storage_failure', requestId })); }
  });

  app.use((error, request, response, next) => {
    if (error?.type === 'entity.parse.failed' || error?.status === 413) return respond(response, failureEnvelope({ code: 'invalid_request', requestId: request.body?.requestId }));
    if (response.headersSent) return response.end();
    return respond(response, failureEnvelope({ code: 'storage_failure', requestId: request.body?.requestId }));
  });
  return app;
}

function asyncRoute(dispatch) {
  return async (request, response) => {
    const envelope = request.method === 'GET' ? eventRequest(request) : request.body;
    const requestId = envelope?.requestId;
    if (envelope?.invalid) return respond(response, failureEnvelope({ code: 'invalid_request', requestId }));
    if (hasForbiddenBrowserField(envelope)) return respond(response, failureEnvelope({ code: 'invalid_request', requestId }));
    try { return respond(response, sanitizeBrowserEnvelope(await dispatch(envelope), { requestId })); }
    catch { return respond(response, failureEnvelope({ code: 'storage_failure', requestId })); }
  };
}

function eventRequest(request) {
  const allowed = new Set(['type', 'requestId', 'payload']);
  if (Object.keys(request.query).some((key) => !allowed.has(key))) return { invalid: true, requestId: request.query.requestId };
  if (Object.values(request.query).some((value) => Array.isArray(value))) return { invalid: true, requestId: request.query.requestId };
  try {
    const payload = request.query.payload === undefined ? {} : JSON.parse(request.query.payload);
    return { type: request.query.type, requestId: request.query.requestId, payload };
  } catch {
    return { invalid: true, requestId: request.query.requestId };
  }
}

function respond(response, envelope) {
  return response.status(httpStatusFor(envelope)).json(envelope);
}
