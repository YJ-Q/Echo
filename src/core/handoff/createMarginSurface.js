import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHandoffHttpAdapter } from './httpAdapter.js';

const DEFAULT_HOST = '127.0.0.1';

function portNumber(value) {
  const port = Number(value ?? 3100);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError('invalid_margin_surface_port');
  return port;
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('margin_surface_listen_address_unavailable');
  return { host, port: address.port, origin: `http://${host}:${address.port}` };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

// Standalone server for the Margin Recent Sessions / Smart Handoff surface.
// Deliberately independent of src/web/createWebWorkbench.js: no SQLite core,
// no Application Contract, no Workstream/Run/Memory model. It only exposes
// the three routes createHandoffHttpAdapter defines over the handoff Core.
export async function createMarginSurface({
  rootDir = path.resolve('.'),
  staticDir,
  host,
  port,
  dev = false,
  env = process.env,
  dependencies = {}
} = {}) {
  const deps = {
    createViteServer: async (options) => (await import('vite')).createServer(options),
    fileExists: existsSync,
    ...dependencies
  };
  const resolvedStaticDir = path.resolve(rootDir, staticDir ?? path.join('web', 'dist'));
  const listenHost = host ?? (env.MARGIN_SURFACE_HOST?.trim() || DEFAULT_HOST);
  const listenPort = portNumber(port ?? env.MARGIN_SURFACE_PORT);
  if (!dev && !deps.fileExists(path.join(resolvedStaticDir, 'margin.html'))) {
    throw new Error('margin_surface_assets_missing: run npm run build before starting');
  }

  let vite;
  let server;
  let startPromise;
  let closePromise;

  try {
    if (dev) {
      vite = await deps.createViteServer({
        configFile: path.join(rootDir, 'web', 'vite.config.js'),
        server: { middlewareMode: true }, appType: 'spa'
      });
    }
    const app = createHandoffHttpAdapter({
      rootDir,
      env,
      // This server only ever serves the margin page, so root requests are
      // rewritten to margin.html before Vite's SPA fallback (which otherwise
      // defaults to index.html — the old Workbench entry, not this one).
      ...(dev ? { viteMiddleware: rewriteToMarginHtml(vite.middlewares) } : { staticDir: resolvedStaticDir })
    });

    async function start() {
      if (closePromise) throw new Error('margin_surface_closed');
      if (startPromise) return startPromise;
      startPromise = (async () => {
        server = http.createServer(app);
        return listen(server, listenPort, listenHost);
      })();
      return startPromise;
    }

    async function close() {
      if (closePromise) return closePromise;
      closePromise = (async () => { await closeServer(server); await vite?.close?.(); })();
      return closePromise;
    }

    return Object.freeze({ app, start, close });
  } catch (error) {
    await vite?.close?.().catch(() => {});
    throw error;
  }
}

function rewriteToMarginHtml(middlewares) {
  return (request, response, next) => {
    if (request.url === '/' || request.url === '/index.html') request.url = '/margin.html';
    return middlewares(request, response, next);
  };
}
