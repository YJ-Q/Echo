import express from 'express';
import { failureEnvelope, hasForbiddenBrowserField, httpStatusFor, sanitizeBrowserEnvelope } from './httpErrors.js';

export function createWebHttpAdapter({ webGateway, interactionService, staticDir, viteMiddleware } = {}) {
  if (!webGateway?.execute || !webGateway?.query || !webGateway?.events) throw new TypeError('invalid_web_http_dependencies');
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  if (typeof staticDir === 'function') app.use(bufferedMiddleware(staticDir));
  else if (staticDir) app.use(express.static(staticDir));
  if (typeof viteMiddleware === 'function') app.use(bufferedMiddleware(viteMiddleware));

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

  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.parse.failed' || error?.status === 413) return respond(response, failureEnvelope({ code: 'invalid_request', requestId: request.body?.requestId }));
    if (response.headersSent) return response.destroy();
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

function bufferedMiddleware(middleware) {
  return (request, response, next) => {
    const capture = createResponseCapture(response);
    let completed = false;
    const continueRequest = (error) => {
      if (completed) return;
      completed = true;
      capture.discard();
      next(error);
    };
    capture.whenEnded(() => {
      if (completed) return;
      completed = true;
      capture.commit();
    });
    try {
      const pending = middleware(request, capture.response, continueRequest);
      if (pending?.then) pending.catch(continueRequest);
    } catch (error) {
      continueRequest(error);
    }
  };
}

function createResponseCapture(response) {
  const headers = new Map();
  const chunks = [];
  let statusCode = 200;
  let ended = false;
  let onEnd = () => {};
  const buffered = {
    get headersSent() { return false; },
    get statusCode() { return statusCode; },
    set statusCode(value) { statusCode = value; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    removeHeader(name) { headers.delete(String(name).toLowerCase()); },
    writeHead(code, values = {}) {
      statusCode = code;
      if (values && typeof values === 'object') Object.entries(values).forEach(([name, value]) => buffered.setHeader(name, value));
      return buffered;
    },
    write(chunk) {
      if (!ended && chunk !== undefined) chunks.push(chunk);
      return true;
    },
    end(chunk) {
      if (ended) return buffered;
      if (chunk !== undefined) chunks.push(chunk);
      ended = true;
      onEnd();
      return buffered;
    },
    status(code) { statusCode = code; return buffered; },
    type(value) { buffered.setHeader('content-type', value); return buffered; },
    send(value) { buffered.end(value); return buffered; },
    json(value) { buffered.setHeader('content-type', 'application/json'); buffered.end(JSON.stringify(value)); return buffered; }
  };
  return {
    response: buffered,
    whenEnded(callback) { onEnd = callback; },
    discard() { chunks.length = 0; headers.clear(); },
    commit() {
      if (response.headersSent) return;
      response.statusCode = statusCode;
      headers.forEach((value, name) => response.setHeader(name, value));
      chunks.forEach((chunk) => response.write(chunk));
      response.end();
    }
  };
}
