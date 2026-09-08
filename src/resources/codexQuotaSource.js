import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCodexHome } from '../core/handoff/session-source.js';

export const resolveCodexResourceHome = resolveCodexHome;
function quotaSnapshot(record) {
  const rateLimits = record?.type === 'event_msg' && record.payload?.type === 'token_count' ? record.payload.rate_limits : null;
  const timestamp = new Date(record?.timestamp);
  if (!rateLimits || Number.isNaN(timestamp.getTime())) return null;
  return { timestamp, rateLimits };
}

function jsonlFiles(root, fsImpl) {
  const files = [];
  const visit = (directory) => {
    let entries;
    try { entries = fsImpl.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(target);
    }
  };
  visit(path.join(root, 'sessions'));
  visit(path.join(root, 'archived_sessions'));
  return files;
}

// Multiple session files can contain the same snapshot after archive/move.
// A quota snapshot is state, not usage: choose one latest event timestamp.
export function readLatestCodexQuotaSnapshot(codexHome, { env = process.env, fsImpl = fs, homedir = os.homedir } = {}) {
  const root = resolveCodexResourceHome(codexHome, { env, homedir });
  let latest = null;
  for (const file of jsonlFiles(root, fsImpl)) {
    let text;
    try { text = fsImpl.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const candidate = quotaSnapshot(record);
      if (candidate && (!latest || candidate.timestamp > latest.timestamp)) latest = candidate;
    }
  }
  return latest;
}
