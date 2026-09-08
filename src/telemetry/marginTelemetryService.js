// S4 Cost Telemetry — main-process scheduler that keeps the append-only usage log current.
//
// It is a sibling of the HTTP adapter and is deliberately NOT gated on window visibility/expansion
// (the UI-only S2/S3 gates must not create telemetry gaps). One catch-up pass over active + archived
// runs when Margin starts (or when the active Codex source changes); thereafter it tails only the
// active tree on a short cadence. If Margin is fully closed, the gap is closed on the next start by
// the idempotent catch-up. Any failure is contained: telemetry must never take down the surface.

import path from 'node:path';
import { readAgentSourceRegistry, detectAgentSources, resolveActiveSource } from '../agents/sourceRegistry.js';
import { createCodexUsageIngest, sourceIdForHome } from './codexUsageIngest.js';
import { usageLogPath } from './paths.js';

export function createMarginTelemetryService({
  dir,
  env = process.env,
  intervalMs = 1000,
  createIngest = createCodexUsageIngest,
  sourceIdFor = sourceIdForHome,
  enabled = true,
} = {}) {
  if (!dir) throw new TypeError('createMarginTelemetryService requires dir');
  let ingest = null;
  let timer = null;
  let started = false;
  let lastHome = null;
  let lastSummary = null;
  let lastError = null;

  function resolveHome() {
    try {
      const registry = readAgentSourceRegistry({ env });
      const detected = detectAgentSources(registry, { env }).registry;
      const source = resolveActiveSource(detected, 'codex', { env });
      return source?.enabled ? source.path : null;
    } catch { return null; }
  }

  function runPass() {
    try {
      const home = resolveHome();
      if (!home) { lastSummary = { enabled: false, reason: 'no_active_codex_source' }; return; }
      if (home !== lastHome || !ingest) {
        lastHome = home;
        ingest = createIngest({ dir, sourceId: sourceIdFor(home) });
        lastSummary = ingest.catchUp(home);
      } else {
        lastSummary = ingest.tail(home);
      }
    } catch (error) { lastError = error?.message ?? String(error); }
  }

  function start() {
    if (started) return;
    started = true;
    if (!enabled) return;
    // Kick off the (potentially ~1 s) first catch-up on the next tick so it never blocks surface
    // readiness; the tail cadence begins once that completes.
    setImmediate(() => {
      if (!started) return;
      runPass();
      if (started) timer = setInterval(runPass, intervalMs);
    });
  }

  function stop() {
    started = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function status() {
    return {
      enabled,
      running: started && enabled,
      dir,
      logPath: usageLogPath(dir),
      home: lastHome,
      lastSummary,
      lastError,
    };
  }

  return Object.freeze({ start, stop, status });
}

export { sourceIdForHome };
