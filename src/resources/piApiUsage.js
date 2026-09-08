import fs from 'node:fs';
import path from 'node:path';

// Pi Today API-token usage — local-calendar aggregation over the Pi agent's own session tree.
//
// The result depends on TWO sources of truth: the session JSONL (which records carry assistant
// usage) and the provider config (`{home}/agent/models.json`), which decides whether a response
// provider is API or subscription. Both are therefore part of the cached identity; neither a
// watcher nor a database is used — the cheap provider-config signature is re-derived per call and
// day rollover is part of the key, so an unchanged session tree still recomputes when the config
// or the local calendar day changes.
//
// A read failure is never conflated with a legitimate empty day: failures keep the last trusted
// snapshot marked stale and never advance freshAt, while a successfully-read empty day is a
// legitimate "0 API tokens today".

const cache = new Map();

function validTimestamp(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : null;
}

function completeRecords(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
  catch { return { records: [], failed: true }; }
  const end = text.lastIndexOf('\n');
  if (end < 0) return { records: [], failed: false };
  const records = text.slice(0, end + 1).split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  return { records, failed: false };
}

function sessionFiles(root) {
  const files = [];
  let failed = false;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) {
      // A vanished directory is a legitimate transient (cleanup/rename in progress); any other
      // error (EACCES/EIO/…) means this aggregation cannot see part of the tree.
      if (error?.code !== 'ENOENT') failed = true;
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file);
    }
  }
  walk(root);
  return { files: files.sort(), failed };
}

function configuredApiProviders(home) {
  const configured = new Set(['deepseek']);
  // YAPI is intentionally not classified by name. It is API only when the
  // native provider config explicitly declares an API protocol and endpoint.
  try {
    const models = JSON.parse(fs.readFileSync(path.join(home, 'agent', 'models.json'), 'utf8'));
    const value = models?.providers?.YAPI;
    if (typeof value?.api === 'string' && value.api.trim() && typeof value?.baseUrl === 'string' && value.baseUrl.trim()) configured.add('yapi');
  } catch { /* unknown/missing config means no YAPI classification */ }
  return configured;
}

// Cache identity for the config input: the EFFECTIVE API/subscription classification. Only the
// classification feeds the aggregation, so a config edit that leaves it unchanged is a no-op and a
// change that alters it invalidates the cache — without touching the session revision.
function apiProviderSignature(home) {
  return Array.from(configuredApiProviders(home)).sort().join(',');
}

function providerFor(record, currentProvider) {
  return String(record?.message?.provider ?? record?.provider ?? currentProvider ?? '').trim().toLowerCase();
}

function aggregateFresh({ home, revision, now = Date.now() }) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const apiProviders = configuredApiProviders(home);
  let totalTokens = 0;
  let trustedApiResponses = 0;
  let excludedSubscriptionResponses = 0;
  let excludedUnknownResponses = 0;
  let readFailed = false;
  let latestTimestamp = null;
  const provenanceFiles = [];

  const { files, failed: treeFailed } = sessionFiles(path.join(home, 'agent', 'sessions'));
  readFailed = readFailed || treeFailed;
  for (const file of files) {
    let provider = null;
    let fileCount = 0;
    const { records, failed: fileFailed } = completeRecords(file);
    readFailed = readFailed || fileFailed;
    for (const record of records) {
      if (record?.type === 'model_change') {
        provider = String(record.provider ?? '').trim().toLowerCase() || provider;
        continue;
      }
      if (record?.type !== 'message' || record?.message?.role !== 'assistant') continue;
      const timestamp = validTimestamp(record.timestamp);
      const tokens = record.message?.usage?.totalTokens;
      if (timestamp === null || timestamp < startMs || timestamp > now || !Number.isFinite(Number(tokens))) continue;
      const providerAtResponse = providerFor(record, provider);
      if (providerAtResponse === 'opencode-go') { excludedSubscriptionResponses += 1; continue; }
      if (!apiProviders.has(providerAtResponse)) { excludedUnknownResponses += 1; continue; }
      totalTokens += Number(tokens);
      trustedApiResponses += 1;
      fileCount += 1;
      latestTimestamp = latestTimestamp === null ? timestamp : Math.max(latestTimestamp, timestamp);
    }
    if (fileCount) provenanceFiles.push(file);
  }
  return { totalTokens, trustedApiResponses, excludedSubscriptionResponses, excludedUnknownResponses,
    readFailed,
    freshAt: latestTimestamp === null ? null : new Date(latestTimestamp).toISOString(),
    provenance: { source: 'pi-jsonl', home, files: provenanceFiles.length,
      trustedApiResponses, excludedSubscriptionResponses, excludedUnknownResponses } };
}

function coverageOf(snapshot) {
  return {
    partial: Boolean(snapshot.excludedUnknownResponses),
    excludedUnknownResponses: snapshot.excludedUnknownResponses ?? 0,
    excludedSubscriptionResponses: snapshot.excludedSubscriptionResponses ?? 0,
    readFailed: snapshot.readFailed === true,
  };
}

export function collectPiResourceSnapshot({ source, revision, now = Date.now(), maxAgeMs = 60000 } = {}) {
  const home = source?.path ?? null;
  if (!home) return null;
  const local = new Date(now);
  const dayKey = `${local.getFullYear()}-${local.getMonth()}-${local.getDate()}`;
  const key = path.resolve(home);
  const configKey = apiProviderSignature(home);
  const previous = cache.get(key);

  // Cache hit only when the session revision, the local calendar day AND the provider
  // classification are all unchanged, the entry is still within its re-validation window, AND the
  // last read for this identity succeeded (a failure is never served as fresh — the same key
  // retries instead). The max-age bound makes content-level transient failures observable even on
  // an unchanged revision without any watcher.
  if (previous && previous.revision === revision && previous.dayKey === dayKey && previous.configKey === configKey
      && !previous.lastReadFailed && now - (previous.at ?? 0) < maxAgeMs) {
    return previous.snapshot;
  }

  const aggregate = aggregateFresh({ home, revision, now });

  if (aggregate.readFailed) {
    // Temporary read failure: never commit it as truth. Keep the last trusted snapshot marked
    // stale (freshAt stays the last successfully-read timestamp) and mark this identity dirty so
    // the SAME (revision, day, config) re-attempts the read on the next call.
    if (previous) {
      cache.set(key, { ...previous, lastReadFailed: true });
      return { ...previous.snapshot, stale: true, revision: previous.snapshot.revision, readFailed: true,
        coverage: coverageOf({ ...previous.snapshot, readFailed: true }) };
    }
    // Truly unavailable with nothing trusted to fall back on: an honest empty view, not a value.
    return { revision, freshAt: null, stale: false, unavailable: true, readFailed: true,
      totalTokens: 0, trustedApiResponses: 0, excludedSubscriptionResponses: 0, excludedUnknownResponses: 0,
      provenance: { source: 'pi-jsonl', home, files: 0, trustedApiResponses: 0, excludedSubscriptionResponses: 0, excludedUnknownResponses: 0 },
      coverage: coverageOf({ readFailed: true }) };
  }

  // A reliable new value clears stale (and the dirty bit) and becomes the new blessed snapshot.
  const snapshot = { ...aggregate, stale: false, unavailable: false, coverage: coverageOf(aggregate) };
  cache.set(key, { revision, dayKey, configKey, snapshot, lastReadFailed: false, at: now });
  return snapshot;
}

export function resetPiResourceCache() { cache.clear(); }