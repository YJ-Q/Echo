import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Read a .capture.json sidecar; returns null (not throw) if missing, unreadable, or malformed
// so the caller can fall back to re-capturing instead of crashing on a half-residual cache.
function readCapture(snapshotPath) {
  try { return JSON.parse(fs.readFileSync(snapshotPath + '.capture.json', 'utf8').replace(/^﻿/, '')); }
  catch { return null; }
}

// The default resumable Recent Sessions list never includes an explicitly internal Codex
// thread. continues 4.1.1 discovery exposes originalPath but not the session_meta's
// thread_source, so discovery enriches each session with a metadata-only probe of its native
// JSONL here — at the source boundary — and drops internal threads before the list leaves this
// module. Neither the HTTP adapter nor the UI ever sees a Codex-internal thread or the
// thread_source value itself.
export function resolveCodexHome(codexHome, { env = process.env, homedir = os.homedir } = {}) {
  if (typeof codexHome === 'string' && codexHome.trim()) return path.resolve(codexHome);
  // Electron can be launched by a shell whose Node home resolves to a service or
  // packaging account. USERPROFILE is the Windows user profile that owns Codex's
  // native session directory, and is also what the CLI inherits. CODEX_HOME
  // remains an explicit, cross-host override for portable installations.
  if (typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim()) return path.resolve(env.CODEX_HOME);
  const profile = env.USERPROFILE || env.HOME || (env.HOMEDRIVE && env.HOMEPATH ? path.join(env.HOMEDRIVE, env.HOMEPATH) : null) || homedir();
  return path.join(profile, '.codex');
}

export async function discoverSessions(codexHome, { limit, env, homedir } = {}) {
  const home = resolveCodexHome(codexHome, { env, homedir });
  const discovered = parseCodexSessions(home, { limit });
  return resumableSessions(discovered);
}

function sessionFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sessionFiles(entryPath);
    return entry.isFile() && /^rollout-.+\.jsonl$/i.test(entry.name) ? [entryPath] : [];
  });
}

function parseFilename(filePath) {
  const match = path.basename(filePath).match(/^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)\.jsonl$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, id] = match;
  return { id, createdAt: new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`) };
}

// continues 4.1.1 captures CODEX_HOME when its module is imported and silently
// ignores parseSessions({ codexRoot }). Keep the Codex source adapter here so
// the supplied root is authoritative for both CLI and every UI host.
function parseCodexSessions(codexHome, { limit } = {}) {
  const byId = new Map();
  for (const originalPath of [...sessionFiles(path.join(codexHome, 'sessions')), ...sessionFiles(path.join(codexHome, 'archived_sessions'))]) {
    const file = parseFilename(originalPath);
    if (!file) continue;
    try {
      const info = fs.statSync(originalPath);
      const firstLine = fs.readFileSync(originalPath, 'utf8').split('\n').find((line) => line.trim());
      const meta = firstLine ? JSON.parse(firstLine) : null;
      const payload = meta?.payload ?? {};
      const createdAt = typeof payload.timestamp === 'string' && !Number.isNaN(Date.parse(payload.timestamp)) ? new Date(payload.timestamp) : file.createdAt;
      const session = {
        id: file.id, cwd: payload.cwd ?? '', branch: payload.git?.branch ?? null,
        gitSha: payload.git?.commit_hash ?? payload.git?.sha ?? null, summary: null,
        createdAt, updatedAt: info.mtime, originalPath,
      };
      const existing = byId.get(session.id);
      if (!existing || existing.updatedAt < session.updatedAt) byId.set(session.id, session);
    } catch { /* skip an unreadable or half-written native session file */ }
  }
  const sessions = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return limit ? sessions.slice(0, limit) : sessions;
}

const MAX_META_PROBE_BYTES = 256 * 1024; // bounded metadata head read; never the conversation

// Map one continues UnifiedSession to the plain session shape Margin's boundaries consume.
export function canonicalizeWorkspacePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let resolved = path.resolve(value);
  try { resolved = fs.realpathSync.native(resolved); } catch { /* paths from old sessions may no longer exist */ }
  resolved = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// Resolve identity where the source still owns the filesystem. Git is deliberately probed
// here, rather than in HTTP or React, so different subdirectories of one repository group.
export function resolveWorkspaceIdentity(session) {
  const cwd = canonicalizeWorkspacePath(session.cwd);
  if (!cwd) return { workspaceKey: 'cwd:unknown', workspaceName: 'Unknown workspace' };
  let repoRoot = null;
  try {
    const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0 && result.stdout?.trim()) repoRoot = canonicalizeWorkspacePath(result.stdout.trim());
  } catch { /* non-Git or unavailable Git falls back to cwd */ }
  const root = repoRoot ?? cwd;
  return { workspaceKey: `${repoRoot ? 'git' : 'cwd'}:${root}`, workspaceName: path.basename(root) || root };
}

const withoutMarkdownPrefix = value => String(value ?? '').trimStart().replace(/^#{1,6}\s+/, '');
const WRAPPER_PREFIX = /^(?:<recommended_plugins>|<environment_context>|files (?:pasted|mentioned) by the user\b|pasted text contains\b|the following is\b|the following content\b)/i;

function shortLabel(text) {
  const lines = String(text).split(/\r?\n/);
  // Pasted implementation briefs commonly begin with a short routing sentence and then a
  // Markdown Slice heading; the heading is the more stable identifying requirement.
  const headings = lines.filter(line => /^#{1,6}\s+\S/.test(line.trim()))
    .map(line => line.trim().replace(/^#{1,6}\s+/, ''));
  const heading = headings.find(line => !isLowQualityLabel(line));
  const first = heading ?? lines.find(line => line.trim() && !/^#{1,6}\s+/.test(line.trim()))?.trim()
    ?? headings[0] ?? '';
  const sentence = first.match(/^(.+?[.!?](?:\s|$))/)?.[1]?.trim() ?? first;
  return sentence.length > 80 ? `${sentence.slice(0, 79).trimEnd()}…` : sentence;
}

function isLowQualityLabel(value) {
  return /^(?:goal|[a-z]\.)$/i.test(withoutMarkdownPrefix(value));
}

function usableText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && !WRAPPER_PREFIX.test(withoutMarkdownPrefix(text)) ? text : null;
}

// Codex Desktop represents a pasted text file as a small platform envelope followed by
// its local attachment path. Reading that explicit, user-provided text file is the smallest
// source-side recovery needed to make the card identifiable; other wrappers remain skipped.
export function pastedAttachmentRequirement(text) {
  if (!/^files pasted by the user\b/i.test(withoutMarkdownPrefix(text))) return null;
  const attachment = text.match(/:\s*([A-Za-z]:[^\r\n]+?\.txt)(?:\r?\n|$)/)?.[1]?.trim();
  if (!attachment) return null;
  try { return usableText(fs.readFileSync(attachment, 'utf8')); } catch { return null; }
}

// The source boundary has one deterministic definition of a usable end-user
// requirement. Both discovery labels and downstream Evidence use it so an
// explicit pasted-text attachment cannot acquire a different meaning later in
// the pipeline.
export function normalizeUserRequirement(text) {
  return usableText(text) ?? pastedAttachmentRequirement(text);
}

function firstEligibleUserRequirement(originalPath) {
  try {
    const lines = fs.readFileSync(originalPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const payload = event.type === 'response_item' ? event.payload : null;
      if (payload?.type !== 'message' || payload.role !== 'user') continue;
      for (const content of payload.content ?? []) {
        const raw = content?.text ?? (content?.type === 'input_text' ? content.text : null);
        const candidate = normalizeUserRequirement(raw);
        if (candidate) return candidate;
      }
    }
  } catch { /* missing historical source: deterministic id fallback */ }
  return null;
}

export function sessionLabel(session) {
  const summary = usableText(session.summary);
  // Codex occasionally supplies structural placeholders as a summary. They are
  // not useful identifiers, so preserve the established deterministic user
  // requirement fallback instead of presenting "Goal" or "A." as a title.
  const usableSummary = summary && !isLowQualityLabel(summary) ? summary : null;
  const requirement = usableSummary ?? firstEligibleUserRequirement(session.originalPath);
  return requirement ? shortLabel(requirement) : `Untitled session · ${String(session.id).slice(0, 8)}`;
}

function toPlainSession(s) {
  const identity = resolveWorkspaceIdentity(s);
  return {
    id: s.id,
    cwd: s.cwd,
    branch: s.branch ?? null,
    gitSha: s.gitSha ?? null,
    summary: s.summary ?? null,
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
    updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    originalPath: s.originalPath,
    ...identity,
    label: sessionLabel(s),
  };
}

// V1 resumable-list eligibility. A session is hidden from the default list only when Margin
// has positive structured evidence that it is a Codex-internal thread: thread_source present
// and not "user" (guardian_review / subagent / memory_consolidation / a feature name). Absence
// of the field, or metadata that failed to read, is "unknown" — never internal — and fails
// open to visible. This is the same rule evidence.js applies once a session is captured.
function isCodexInternalThread(threadSource) {
  return Boolean(threadSource) && threadSource !== 'user';
}

// Build the default resumable Recent Sessions list from continues' discovered UnifiedSessions:
// enrich each with its native thread_source metadata, then drop explicit internal threads.
// Exported so tests drive the exact path discoverSessions() uses with fixture files instead of
// the real codex home; not re-exported through src/core/handoff/index.js.
export function resumableSessions(discovered) {
  const sessions = [];
  for (const s of discovered) {
    if (isCodexInternalThread(readThreadSourceFromPath(s.originalPath))) continue;
    sessions.push(toPlainSession(s));
  }
  return sessions;
}

// Capture a stable snapshot of one session. If a snapshot already exists at snapshotPath
// with a matching hash, reuse it. Pass refreshSnapshot=true to force re-capture.
// A snapshot without a readable, matching .capture.json (deleted, partial, or corrupt) is
// treated as incomplete and re-captured rather than throwing — a normal rerun should never
// crash on a half-residual cache from a previous interrupted run.
export function captureSession(sessionMeta, snapshotPath, { refreshSnapshot = false } = {}) {
  if (fs.existsSync(snapshotPath) && !refreshSnapshot) {
    const existing = readCapture(snapshotPath);
    if (existing) {
      const raw = fs.readFileSync(snapshotPath);
      if (sha256(raw) === existing.sha256) return existing;
    }
  }
  const bytes = fs.readFileSync(sessionMeta.originalPath);
  // Freeze at last complete line to avoid partial JSONL records from a live session.
  const boundary = bytes.lastIndexOf(10) + 1;
  if (!boundary) throw new Error('No complete JSONL record found in session file');
  const prefix = bytes.subarray(0, boundary);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, prefix);
  const capture = {
    capturedAt: new Date().toISOString(),
    originalPath: sessionMeta.originalPath,
    snapshotPath,
    bytes: prefix.length,
    sha256: sha256(prefix),
    omittedTrailingBytes: bytes.length - prefix.length,
    sessionId: sessionMeta.id,
    cwd: sessionMeta.cwd,
  };
  fs.writeFileSync(snapshotPath + '.capture.json', JSON.stringify(capture, null, 2));
  return capture;
}

// Codex's own recorder (codex-rs/protocol/src/protocol.rs, struct SessionMeta) writes a
// stable `thread_source` field on the session_meta line: "user" for a normal end-user
// thread, or "guardian_review" / "subagent" / "memory_consolidation" / a feature name for
// Codex's own internal threads. A guardian_review thread judges another thread's history —
// its role="user" turn is Guardian's own task input, addressed to that internal reviewer,
// not a real end-user requirement, even though it is structurally identical to one. Older
// captures may not have this field at all; absence is not itself a signal one way or the
// other, so callers should treat it as "unknown, assume normal" rather than "not user".
function findThreadSource(records) {
  const meta = records.find((r) => r.event?.type === 'session_meta');
  return meta?.event?.payload?.thread_source ?? null;
}

// Metadata-only enrichment for discovery: probe the session_meta record of one session's
// native JSONL for payload.thread_source. Reads at most MAX_META_PROBE_BYTES from the head of
// the file and stops at the first session_meta line — it never parses the conversation, tool
// calls, or Evidence. Fail-open: a missing/unreadable path, a live session still being written
// (trailing partial record), or malformed/truncated metadata all return null, so enrichment
// can never hide a session it could not positively classify as internal.
function readThreadSourceFromPath(originalPath) {
  let handle;
  try {
    handle = fs.openSync(originalPath, 'r');
    const buffer = Buffer.allocUnsafe(MAX_META_PROBE_BYTES);
    const { bytesRead } = fs.readSync(handle, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return null;
    const text = buffer.subarray(0, bytesRead).toString('utf8').replace(/^﻿/, '');
    // Freeze at the last complete line so a half-written trailing record never parses.
    const end = text.lastIndexOf('\n');
    const head = end === -1 ? text : text.slice(0, end + 1);
    const records = [];
    for (const line of head.split('\n')) {
      if (!line.trim()) continue;
      try { records.push({ event: JSON.parse(line) }); }
      catch { return null; } // malformed metadata — unknown, fail open to visible
      if (records[records.length - 1].event.type === 'session_meta') break;
    }
    return findThreadSource(records);
  } catch {
    return null;
  } finally {
    if (handle !== undefined) { try { fs.closeSync(handle); } catch { /* already closed */ } }
  }
}

// Read and parse a captured snapshot into { records, capture, session }.
// This is the plain-object format that evidence.js consumes.
export function readSessionSource(capture) {
  const raw = fs.readFileSync(capture.snapshotPath);
  if (sha256(raw) !== capture.sha256) throw new Error('Snapshot hash mismatch; re-capture with refreshSnapshot=true');
  const physicalLines = raw.toString('utf8').split('\n');
  const records = [];
  for (const [i, line] of physicalLines.entries()) {
    if (!line.trim()) continue;
    records.push({ line: i + 1, event: JSON.parse(line) });
  }
  return { records, capture, session: { cwd: capture.cwd ?? '', threadSource: findThreadSource(records) } };
}

// Read a frozen complete-line view directly from a native session file. Unlike
// captureSession this intentionally creates no snapshot or sidecar: read-only
// overview requests must not write into the workspace or handoff output.
export function readSessionMetaSource(sessionMeta) {
  const bytes = fs.readFileSync(sessionMeta.originalPath);
  const boundary = bytes.lastIndexOf(10) + 1;
  if (!boundary) throw new Error('No complete JSONL record found in session file');
  const prefix = bytes.subarray(0, boundary);
  const physicalLines = prefix.toString('utf8').split('\n');
  const records = [];
  for (const [i, line] of physicalLines.entries()) {
    if (!line.trim()) continue;
    records.push({ line: i + 1, event: JSON.parse(line) });
  }
  return {
    records,
    capture: {
      capturedAt: new Date().toISOString(), originalPath: sessionMeta.originalPath,
      snapshotPath: sessionMeta.originalPath, bytes: prefix.length, sha256: sha256(prefix),
      sessionId: sessionMeta.id, cwd: sessionMeta.cwd,
    },
    session: { cwd: sessionMeta.cwd ?? '', threadSource: findThreadSource(records) },
  };
}
