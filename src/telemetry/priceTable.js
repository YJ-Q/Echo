// S4 Cost Telemetry — price table and cost derivation, kept strictly separate from the raw usage log.
//
// `usage.jsonl` holds provider facts only. Currency cost is derived at query time as a pure function
// of (records × a price-table snapshot) from `~/.margin/telemetry/prices.json`.
//
// Pricing policy:
//   - Prices are for METERED (API / per-token) usage only. A subscription (`model_provider` from a
//     Codex plan) has no per-token currency bill; leaving `prices` empty reports real usage/quota and
//     never fabricates a single-request currency cost.
//   - Billing buckets are input, cachedInput, cacheWriteInput, output. Reasoning is reported on each
//     usage record but treated as already part of `output` (empirically, for Codex/OpenAI,
//     `total_tokens == input + output` and reasoning is a separately reported subset of output), so it
//     is NOT double-billed. A provider that bills reasoning on top of output can opt in via
//     `reasoningOverridePerM` (documented risk to the table author).
//   - A record with an unknown model/provider, or a billed bucket with no configured rate, is
//     `priced:false` with the unpriced buckets listed — never silently estimated.

import fs from 'node:fs';
import { pricesPath } from './paths.js';

const BILLED_BUCKETS = Object.freeze(['input', 'cachedInput', 'cacheWriteInput', 'output']);
const RATE_SUFFIX = Object.freeze({
  input: 'inputPerM', cachedInput: 'cachedInputPerM', cacheWriteInput: 'cacheWriteInputPerM', output: 'outputPerM',
});

export function defaultPriceTable() {
  return {
    version: 1,
    currency: 'USD',
    note: 'Per-1M-token rates for METERED API usage only (per token rows). Buckets: inputPerM, cachedInputPerM, cacheWriteInputPerM, outputPerM (optional reasoningOverridePerM only if your provider bills reasoning on top of output). Omit reasoning (default): reasoning tokens are already part of output. Leave "prices": [] for subscription-only real-usage reporting (no fabricated currency cost). Model/provider names are matched case-insensitively; provider "*" is a wildcard.',
    prices: [],
  };
}

export function readPriceTable(dir, { create = true } = {}) {
  const file = pricesPath(dir);
  if (!fs.existsSync(file)) {
    if (!create) return defaultPriceTable();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(defaultPriceTable(), null, 2), 'utf8');
    return { ...defaultPriceTable(), seeded: true, path: file };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.prices)) return defaultPriceTable();
    return { ...parsed, path: file };
  } catch {
    return defaultPriceTable();
  }
}

const norm = (value) => String(value ?? '').trim().toLowerCase();

function numericRate(row, suffix) {
  const v = row?.[suffix];
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Return the rate row for (provider, model), or null. Match is case-insensitive exact model, falling
// back to provider wildcard. The last matching row wins (later rows override).
export function rateRowFor(table, { provider, model }) {
  const providerKey = norm(provider);
  const modelKey = norm(model);
  let best = null;
  let bestSpecificity = -1;
  for (const row of table?.prices ?? []) {
    const rowProvider = norm(row.provider);
    const rowModel = norm(row.model);
    if (rowProvider !== providerKey && rowProvider !== '*') continue;
    if (rowProvider === '*') {
      if (bestSpecificity < 0) { best = row; bestSpecificity = 0; }
      continue;
    }
    if (rowModel !== modelKey) continue;
    if (bestSpecificity < 1) { best = row; bestSpecificity = 1; }
  }
  return best;
}

export function deriveCost(record, table) {
  const provider = record?.provider || null;
  const model = record?.model || null;
  const usage = record?.usage || {};
  if (!provider || !model) {
    return { priced: false, reason: provider ? 'unknown_model' : 'unknown_provider', cost: null, currency: null, unpricedTokens: [] };
  }
  const row = rateRowFor(table, { provider, model });
  if (!row) return { priced: false, reason: 'no_rate', cost: null, currency: null, unpricedTokens: [] };
  const currency = row.currency || table?.currency || 'USD';
  let cost = 0;
  const unpricedTokens = [];
  for (const bucket of BILLED_BUCKETS) {
    const tokens = Number(usage[bucket]);
    const hasTokens = Number.isFinite(tokens) && tokens > 0;
    const rate = numericRate(row, RATE_SUFFIX[bucket]);
    if (hasTokens && rate !== null) {
      cost += (tokens * rate) / 1_000_000;
    } else if (hasTokens && rate === null) {
      unpricedTokens.push({ bucket, tokens });
    }
  }
  // Optional: provider bills reasoning on top of output.
  const reasoning = Number(usage.reasoningOutput);
  const reasoningRate = numericRate(row, 'reasoningOverridePerM');
  if (Number.isFinite(reasoning) && reasoning > 0 && reasoningRate !== null) {
    cost += (reasoning * reasoningRate) / 1_000_000;
  }
  return {
    priced: unpricedTokens.length === 0,
    reason: unpricedTokens.length ? 'missing_bucket_rate' : 'ok',
    currency,
    cost,
    unpricedTokens,
    row: { provider: row.provider, model: row.model },
  };
}
