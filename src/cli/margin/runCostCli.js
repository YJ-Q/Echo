// margin cost — read-only usage/cost reporting plus one-shot ingest. Text output only; no dashboard.
//
//   margin cost status
//   margin cost report [--session <id>]* [--model <m>]* [--source <sid>] [--from <iso>] [--to <iso>]
//                      [--group model|session|day|source|none] [--dir <telemetry-dir>]
//   margin cost ingest [--codex-home <path>] [--dir <telemetry-dir>]

import { telemetryProfileDir } from '../../telemetry/paths.js';
import { loadUsageRecords, filterRecords, summarize, readPriceTable } from '../../telemetry/costLedger.js';
import { createCodexUsageIngest, sourceIdForHome } from '../../telemetry/codexUsageIngest.js';

const write = (stream, text = '') => stream.write(`${text}\n`);

function money(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const fixed = n === 0 ? '0' : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return fixed;
}

function fmtTokens(t) {
  const num = (v) => Number(v) || 0;
  return `${num(t.input)}i/${num(t.cachedInput)}c/${num(t.output)}o/${num(t.reasoningOutput)}r`;
}

function printReportRow(out, label, totals) {
  const cost = totals.pricedCount ? `${money(totals.cost)} ${totals.currency || ''}` : '(unpriced)';
  write(out, `${String(label).padEnd(22)} req=${String(totals.requests).padStart(5)}  tok(total)=${String(Number(totals.total) || 0).padStart(8)}  ${fmtTokens(totals)}  priced=${totals.pricedCount}/${totals.requests}  cost=${cost}`);
}

function printOverall(out, totals, showCost = true) {
  write(out, `requests            ${totals.requests}`);
  write(out, `tokens input/cached/cacheWrite/output/reasoning/total: ${totals.input} / ${totals.cachedInput} / ${totals.cacheWriteInput} / ${totals.output} / ${totals.reasoningOutput} / ${totals.total}`);
  if (showCost) {
    if (totals.pricedCount) write(out, `priced requests      ${totals.pricedCount}/${totals.requests}  cost=${money(totals.cost)} ${totals.currency || ''}`);
    else write(out, `priced requests      0/${totals.requests}  (no matching price row — real usage/quota only; not unpriced-as-estimate, simply uncosted)`);
    write(out, `unpriced records     ${totals.unpricedCount}`);
  }
}

function parseOptions(args) {
  const opts = { sessionIds: [], models: [], from: null, to: null, source: null, group: 'model', dir: null, codexHome: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === '--session' || a === '-s') { const v = next(); if (v !== undefined) opts.sessionIds.push(v); }
    else if (a === '--model' || a === '-m') { const v = next(); if (v !== undefined) opts.models.push(v); }
    else if (a === '--source') opts.source = next() ?? null;
    else if (a === '--from') opts.from = next() ?? null;
    else if (a === '--to') opts.to = next() ?? null;
    else if (a === '--group') opts.group = next() ?? 'model';
    else if (a === '--dir') opts.dir = next() ?? null;
    else if (a === '--codex-home') opts.codexHome = next() ?? null;
  }
  if (!['model', 'session', 'day', 'source', 'none'].includes(opts.group)) opts.group = 'model';
  return opts;
}

function modelCounts(records) {
  const m = new Map();
  for (const r of records) { const k = r.model || '(unresolved)'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function sourceCounts(records) {
  const m = new Map();
  for (const r of records) { const k = r.sourceId || '(none)'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function doStatus(env, dir, out, err) {
  const { records, stats } = loadUsageRecords({ dir });
  write(out, `usage log: ${stats.file}`);
  if (!records.length) { write(out, 'No usage records yet. Start Margin once to run the first catch-up, or: margin cost ingest --codex-home <path>'); return 0; }
  write(out, `records: ${stats.unique} (file lines ${stats.lines}, duplicate lines re-deduped ${stats.duplicates})`);
  const ts = records.map((r) => r.ts).filter(Boolean).sort();
  if (ts.length) write(out, `time range: ${ts[0]} .. ${ts[ts.length - 1]}`);
  write(out, 'models: ' + modelCounts(records).map(([m, c]) => `${m}×${c}`).join(', '));
  write(out, 'sources: ' + sourceCounts(records).map(([m, c]) => `${m}×${c}`).join(', '));
  const byModel = summarize(records, null, 'model').groups;
  write(out, '--- per model (total tokens, total = provider total) ---');
  for (const [model, totals] of [...byModel.entries()].sort((a, b) => (Number(b[1].total) || 0) - (Number(a[1].total) || 0))) printReportRow(out, model, totals);
  const table = readPriceTable(dir, { create: true });
  write(out, table.prices.length ? `price table: ${table.prices.length} row(s) configured at ${table.path}` : `price table: none configured (${table.path}) — real usage only, no currency cost`);
  return 0;
}

function doReport(env, opts, out, dir) {
  const d = opts.dir ?? dir;
  const { records, stats } = loadUsageRecords({ dir: d });
  if (!records.length) { write(out, 'No usage records.'); return 0; }
  const filtered = filterRecords(records, {
    sessionIds: opts.sessionIds, models: opts.models, sourceId: opts.source,
    fromTs: opts.from ? new Date(opts.from).getTime() : null,
    toTs: opts.to ? new Date(opts.to).getTime() : null,
  });
  if (!filtered.length) { write(out, 'No records match the filter.'); return 0; }
  const table = readPriceTable(d, { create: true });
  const summary = summarize(filtered, table, opts.group);
  write(out, `filtered records: ${filtered.length} (log unique ${stats.unique})`);
  write(out, `price table: ${table.prices.length ? `${table.prices.length} row(s)` : 'none configured'}`);
  write(out, `group by: ${opts.group}`);
  write(out, '--- overall ---');
  printOverall(out, summary.overall);
  if (opts.group === 'none') { write(out, ''); return 0; }
  write(out, '');
  write(out, `--- by ${opts.group} ---`);
  const rows = [...summary.groups.entries()].sort((a, b) => (Number(b[1].total) || 0) - (Number(a[1].total) || 0));
  for (const [label, totals] of rows) printReportRow(out, label, totals);
  write(out, '');
  if (summary.overall.unpricedCount && table.prices.length) {
    write(out, 'Unpriced breakdown (records with a match issue): ' + [...summary.overall.unpriced].map(([r, c]) => `${r}×${c}`).join(', '));
  }
  return 0;
}

function doIngest(env, opts, out, err, dir) {
  const home = opts.codexHome;
  if (!home) { write(err, 'Usage: margin cost ingest --codex-home <path>'); return 1; }
  const d = opts.dir ?? dir;
  const sourceId = sourceIdForHome(home);
  write(out, `ingesting ${home}`);
  write(out, `sourceId: ${sourceId}`);
  const ingest = createCodexUsageIngest({ dir: d, sourceId });
  const result = ingest.catchUp(home);
  if (result.locked) { write(err, 'ingest skipped: another writer holds the usage log lock'); return 1; }
  write(out, `written new=${result.written}  skipped duplicates=${result.skippedDups}  anomalies=${result.anomalies}`);
  write(out, `log now holds ${result.seen} unique usage records`);
  return 0;
}

export function runCostCli(argv = [], { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const command = argv[0];
  const dir = parseOptions(argv).dir ?? telemetryProfileDir({ env });
  if (command === 'status') return doStatus(env, dir, stdout, stderr);
  if (command === 'report') return doReport(env, parseOptions(argv.slice(1)), stdout, dir);
  if (command === 'ingest') return doIngest(env, parseOptions(argv.slice(1)), stdout, stderr, dir);
  write(stderr, 'Usage: margin cost <status|report|ingest>');
  write(stderr, '  margin cost status');
  write(stderr, '  margin cost report [--session <id>] [--model <m>] [--from <iso>] [--to <iso>] [--group model|session|day|source|none] [--dir <dir>]');
  write(stderr, '  margin cost ingest --codex-home <path> [--dir <dir>]');
  return 1;
}
