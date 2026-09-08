// S4 Cost Telemetry — idempotent append-only writer over Codex native `token_usage_record`s.
//
// Store: `~/.margin/telemetry/usage.jsonl` (per-user, append-only). Startup runs one catch-up pass
// over the active AND archived trees; while running it incrementally tails only the active tree via
// in-memory per-rollout byte offsets (never O(file) per tick). Dedup key is `sourceId + ':' +
// responseId`, enforced at write (in-memory seen-set loaded from the log) so restart re-scans,
// archive moves, double-writer races, and catch-up re-reads never write a duplicate. A trailing
// partial line in `usage.jsonl` is repaired (truncated to the last complete line) before indexing,
// and a trailing partial native record is always skipped. Writes are guarded by a best-effort
// exclusive lock; even a rare double append is harmless because costLedger re-dedups on read.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { usageLogPath, usageLockPath } from './paths.js';
import { buildUsageRecord, usageDigest, dedupKey, encodeUsageRecord, resolveMeta } from './codexUsageRecord.js';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const MAX_META_BYTES = 1 << 20;       // bounded head read to locate session_meta (first line)
const LOCK_STALE_MS = 60_000;         // stale lock recovery

// Ad-hoc source ids must agree with the registry's derivation so that ingesting a non-active home
// and later resolving it as the active source unify to the same sourceId. sourceRegistry builds
// `codex-<sha256(codex:<lowercase path>)[0..12]>`.
export function sourceIdForHome(home) {
  const resolved = path.resolve(String(home));
  return `codex-${sha256(`codex:${resolved.toLowerCase()}`).slice(0, 12)}`;
}

export function isCodexRollout(name) {
  return /^rollout-.+\.jsonl$/i.test(name);
}

// Enumerate rollout files under a root, returning { abs, rel, size }. rel is codex-home relative so
// provenance is stable; never crosses into unrelated directories.
function enumerateRollouts(root) {
  const out = [];
  const visit = (dir) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(abs); continue; }
      if (!isCodexRollout(entry.name)) continue;
      let st; try { st = fs.statSync(abs); } catch { continue; }
      out.push({ abs, rel: entry.name, size: st.size });
    }
  };
  visit(root);
  return out;
}

function readRange(fd, start, length) {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    let n = 0; try { n = fs.readSync(fd, buf, done, length - done, start + done); } catch { break; }
    if (n === 0) break;
    done += n;
  }
  return buf.subarray(0, done);
}

function resolveMetaForFile(abs) {
  let fd; try { fd = fs.openSync(abs, 'r'); } catch { return { provider: null, model: null, hasMeta: false }; }
  try {
    const probe = Buffer.allocUnsafe(MAX_META_BYTES);
    let n = 0; try { n = fs.readSync(fd, probe, 0, probe.length, 0); } catch { return { provider: null, model: null, hasMeta: false }; }
    if (n <= 0) return { provider: null, model: null, hasMeta: false };
    const text = probe.subarray(0, n).toString('utf8').replace(/^\uFEFF/, '');
    const nl = text.indexOf('\n');
    const first = (nl === -1 ? text : text.slice(0, nl)).trim();
    if (!first) return { provider: null, model: null, hasMeta: false };
    const rec = JSON.parse(first);
    return rec.type === 'session_meta' ? resolveMeta(rec.payload) : { provider: null, model: null, hasMeta: false };
  } catch { return { provider: null, model: null, hasMeta: false }; }
  finally { try { fs.closeSync(fd); } catch { /* ignore */ } }
}

// Read complete lines in [start, size) of a rollout and fold any token_usage_record into the ingest
// callback. Returns the new byte offset = end of the last complete line (a trailing partial line is
// left for a later pass; callers must not re-read whole files on unchanged offsets).
function completeTailLines(abs, start, size, onRecord) {
  let fd; try { fd = fs.openSync(abs, 'r'); } catch { return start; }
  try {
    if (size <= start) return size;
    const chunk = readRange(fd, start, size - start);
    const lastNl = chunk.lastIndexOf(0x0a);
    if (lastNl === -1) return start; // nothing complete yet; re-read later
    const end = start + lastNl + 1;
    const text = chunk.subarray(0, lastNl + 1).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      onRecord(rec);
    }
    return end;
  } finally { try { fs.closeSync(fd); } catch { /* ignore */ } }
}

export function createCodexUsageIngest({ dir, enabled = true, sourceId = null } = {}) {
  if (!dir) throw new TypeError('createCodexUsageIngest requires dir');
  const state = {
    seen: new Map(),      // dedupKey -> digest
    offsets: new Map(),   // abs path -> processed byte offset (last complete line end)
    meta: new Map(),      // abs path -> resolved { provider, model, hasMeta }
    written: 0, skippedDups: 0, anomalies: 0, files: 0,
    logPath: usageLogPath(dir),
    lockPath: usageLockPath(dir),
  };

  function ensureDir() { fs.mkdirSync(dir, { recursive: true }); }

  // Repair our own log: drop a trailing partial (newline-less) line so indexing and append stay on
  // clean line boundaries. A fully written line always ends with '\n'.
  function repairLog() {
    ensureDir();
    if (!fs.existsSync(state.logPath)) { fs.writeFileSync(state.logPath, '', 'utf8'); return; }
    const st = fs.statSync(state.logPath);
    if (st.size === 0) return;
    const tail = fs.readFileSync(state.logPath, 'utf8');
    if (!tail.endsWith('\n')) {
      const boundary = tail.lastIndexOf('\n');
      fs.truncateSync(state.logPath, boundary + 1);
    }
  }

  // Load the existing log into the seen-set (key -> digest) so catch-up never rewrites what is
  // already persisted. Read-level dedup in costLedger provides a second safety net.
  function loadIndex() {
    if (!fs.existsSync(state.logPath)) return 0;
    let count = 0;
    const text = fs.readFileSync(state.logPath, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      const key = dedupKey(rec.sourceId, rec.responseId);
      state.seen.set(key, usageDigest(rec));
      count++;
    }
    return count;
  }

  function acquireLock() {
    ensureDir();
    try {
      const fd = fs.openSync(state.lockPath, 'wx');
      state._lockFd = fd;
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return false;
      try {
        const st = fs.statSync(state.lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(state.lockPath, { force: true });
          try { state._lockFd = fs.openSync(state.lockPath, 'wx'); return true; } catch { return false; }
        }
      } catch { /* race: removed meanwhile */ }
      return false;
    }
  }

  function releaseLock() {
    if (state._lockFd !== undefined) { try { fs.closeSync(state._lockFd); } catch { /* ignore */ } state._lockFd = undefined; }
    try { fs.rmSync(state.lockPath, { force: true }); } catch { /* ignore */ }
  }

  function ingestRecord(rec, nativeMeta) {
    const record = buildUsageRecord({ native: rec, meta: nativeMeta, sourceId, home: state.home, rel: state.currentRel, role: state.currentRole, capturedAt: new Date().toISOString() });
    if (!record) return;
    const key = dedupKey(sourceId, record.responseId);
    const digest = usageDigest(record);
    const existing = state.seen.get(key);
    if (existing !== undefined) {
      if (existing === digest) state.skippedDups++;
      else state.anomalies++;
      return;
    }
    state._pending.push(encodeUsageRecord(record));
    state.seen.set(key, digest);
    state.written++;
  }

  function scanRoot(root, role) {
    if (!root || !fs.existsSync(root)) return;
    const files = enumerateRollouts(root);
    for (const file of files) {
      let start = state.offsets.get(file.abs);
      if (start === undefined) start = 0;
      if (file.size < start) start = 0; // truncated/rotated → re-read
      if (file.size <= start && start !== 0) continue;
      state.currentRel = file.rel;
      state.currentRole = role;
      const meta = state.meta.get(file.abs) ?? resolveMetaForFile(file.abs);
      state.meta.set(file.abs, meta);
      const newOffset = completeTailLines(file.abs, start, file.size, (rec) => {
        if (rec?.type !== 'token_usage_record') return;
        ingestRecord(rec, meta);
      });
      state.offsets.set(file.abs, newOffset);
      state.files++;
    }
  }

  // Catch-up pass: full read of active + archived (dedup makes repeats free). Returns per-call stats.
  function catchUp(home) {
    if (!enabled) return { enabled: false, written: 0, skippedDups: 0, anomalies: 0, files: 0, seen: 0 };
    const before = snapshot();
    ensureDir();
    repairLog();
    loadIndex();
    state.home = home;
    state._pending = [];
    if (!acquireLock()) return { locked: true, written: 0, skippedDups: 0, anomalies: 0, files: 0, seen: state.seen.size };
    try {
      const sessions = path.join(home, 'sessions');
      const archived = path.join(home, 'archived_sessions');
      scanRoot(sessions, 'active');
      scanRoot(archived, 'archived');
      flush();
    } finally { releaseLock(); }
    return delta(before);
  }

  // Runtime tail: only the active tree, reading only appended bytes via offsets. Returns per-call stats.
  function tail(home) {
    if (!enabled || !home) return { enabled: false, written: 0, skippedDups: 0, anomalies: 0, files: 0, seen: state.seen.size };
    const before = snapshot();
    if (!acquireLock()) return { locked: true, written: 0, skippedDups: 0, anomalies: 0, files: 0, seen: state.seen.size };
    try {
      state.home = home;
      state._pending = [];
      scanRoot(path.join(home, 'sessions'), 'active');
      flush();
    } finally { releaseLock(); }
    return delta(before);
  }

  function flush() {
    const pending = state._pending;
    state._pending = [];
    if (!pending.length) return;
    fs.appendFileSync(state.logPath, `${pending.join('\n')}\n`, 'utf8');
  }

  function snapshot() {
    return { written: state.written, skippedDups: state.skippedDups, anomalies: state.anomalies, files: state.files };
  }

  // Per-call deltas (what this operation added), so callers can report a pass accurately; cumulative
  // totals for status are available via `summary()`.
  function delta(before) {
    return {
      written: state.written - before.written,
      skippedDups: state.skippedDups - before.skippedDups,
      anomalies: state.anomalies - before.anomalies,
      files: state.files - before.files,
      seen: state.seen.size,
    };
  }

  function summary() {
    return {
      written: state.written, skippedDups: state.skippedDups, anomalies: state.anomalies,
      files: state.files, seen: state.seen.size,
    };
  }

  return Object.freeze({ catchUp, tail, summary, repairLog, resetIndex() { state.seen.clear(); } });
}
