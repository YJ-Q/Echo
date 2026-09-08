// S4 Cost Telemetry — read/aggregation layer over the append-only usage log.
//
// Reading is a streaming single pass that re-dedups by `sourceId:responseId` (first occurrence wins),
// so even a rare double append (e.g. two writers racing) can never double-count a request. Cost is
// derived per record against a price-table snapshot and kept out of the raw log; unpriced records are
// counted and listed separately, never estimated.

import fs from 'node:fs';
import { usageLogPath } from './paths.js';
import { dedupKey, USAGE_FIELD_MAP } from './codexUsageRecord.js';
import { deriveCost, readPriceTable } from './priceTable.js';

export function loadUsageRecords({ dir } = {}) {
  const path = usageLogPath(dir);
  const records = [];
  const seen = new Set();
  const stats = { lines: 0, unique: 0, duplicates: 0, file: path };
  if (!fs.existsSync(path)) return { records, stats };
  const text = fs.readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    stats.lines++;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const key = dedupKey(rec.sourceId, rec.responseId);
    if (seen.has(key)) { stats.duplicates++; continue; }
    seen.add(key);
    records.push(rec);
  }
  stats.unique = records.length;
  return { records, stats };
}

export function emptyTotals() {
  return {
    requests: 0,
    input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0,
    pricedCount: 0, unpricedCount: 0, cost: 0, currency: null,
    unpriced: new Map(), // reason -> count
    models: new Set(), sessions: new Set(), sources: new Set(),
  };
}

function addBucket(totals, usage) {
  if (!usage) return;
  for (const camel of Object.values(USAGE_FIELD_MAP)) {
    const n = Number(usage[camel]);
    if (Number.isFinite(n) && n > 0) totals[camel] = (totals[camel] || 0) + n;
  }
}

export function addRecord(totals, record, priceTable) {
  totals.requests++;
  addBucket(totals, record.usage);
  if (record.model) totals.models.add(record.model);
  if (record.sessionId) totals.sessions.add(record.sessionId);
  if (record.sourceId) totals.sources.add(record.sourceId);
  const derived = priceTable ? deriveCost(record, priceTable) : { priced: false, reason: 'no_price_table', cost: null, currency: null, unpricedTokens: [] };
  if (derived.priced) {
    totals.pricedCount++;
    totals.cost += derived.cost ?? 0;
    if (derived.currency && !totals.currency) totals.currency = derived.currency;
  } else {
    totals.unpricedCount++;
    const reason = derived.reason || 'no_rate';
    totals.unpriced.set(reason, (totals.unpriced.get(reason) || 0) + 1);
  }
}

export function filterRecords(records, { sessionIds = [], models = [], sourceId = null, fromTs = null, toTs = null } = {}) {
  const sessionSet = sessionIds?.length ? new Set(sessionIds) : null;
  const modelSet = models?.length ? new Set(models) : null;
  return records.filter((record) => {
    if (sessionSet && !sessionSet.has(record.sessionId)) return false;
    if (modelSet && !modelSet.has(record.model)) return false;
    if (sourceId && record.sourceId !== sourceId) return false;
    if (fromTs !== null || toTs !== null) {
      const ms = record.ts ? new Date(record.ts).getTime() : NaN;
      if (!Number.isFinite(ms)) return false;
      if (fromTs !== null && ms < fromTs) return false;
      if (toTs !== null && ms > toTs) return false;
    }
    return true;
  });
}

// Group a filtered list and sum each group (plus an overall roll-up of the same list).
export function summarize(list, priceTable, groupBy = 'none') {
  const overall = emptyTotals();
  const groups = new Map();
  const keyOf = {
    none: () => '__all__',
    model: (r) => r.model || '(unresolved)',
    session: (r) => r.sessionId || '(no-session)',
    day: (r) => { const d = new Date(r.ts); return Number.isNaN(d.getTime()) ? '(no-date)' : d.toISOString().slice(0, 10); },
    source: (r) => r.sourceId || '(no-source)',
  }[groupBy] || (() => '__all__');

  for (const record of list) {
    addRecord(overall, record, priceTable);
    const key = keyOf(record);
    if (!groups.has(key)) groups.set(key, emptyTotals());
    addRecord(groups.get(key), record, priceTable);
  }
  return { overall, groups };
}

export function totalsToPlain(totals) {
  return {
    requests: totals.requests,
    tokens: {
      input: totals.input, cachedInput: totals.cachedInput, cacheWriteInput: totals.cacheWriteInput,
      output: totals.output, reasoningOutput: totals.reasoningOutput, total: totals.total,
    },
    priced: { count: totals.pricedCount, cost: totals.cost, currency: totals.currency },
    unpricedCount: totals.unpricedCount,
    unpricedByReason: Object.fromEntries(totals.unpriced),
    models: [...totals.models], sessions: totals.sessions.size, sources: [...totals.sources],
  };
}

export { readPriceTable };
