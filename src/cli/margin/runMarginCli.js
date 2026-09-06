// The Margin CLI orchestrator — a thin adapter over the handoff Core. It does
// not re-implement discovery, distiller, repo truth, or handoff rendering; it
// only sequences the existing authoritative capabilities and prompts the user.
// All I/O and every Core dependency is injectable so the flow is testable
// without a terminal or a real Codex home.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CANCELLED } from './prompt.js';
import {
  groupSessionsByWorkspace,
  parseSelection,
  workspaceRoot,
} from './selection.js';
import {
  renderWorkspaceMenu,
  renderSessionMenu,
  renderResumeSummary,
  renderSuccess,
} from './render.js';

// Verified .margin/HANDOFF.md save semantics: create the directory if needed,
// overwrite any previous HANDOFF (no history, no checkpoint lifecycle). This
// mirrors the HTTP adapter's /api/handoff/save exactly.
export function writeHandoff({ repo, markdown }) {
  const dir = path.join(repo, '.margin');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'HANDOFF.md');
  fs.writeFileSync(filePath, markdown, 'utf8');
  return filePath;
}

// Exit codes: 0 success · 1 error (no sessions, bad input, generation/save
// failure) · 130 interrupted (Ctrl+C / closed input).
export async function runMarginCli({
  discoverSessions,
  captureSession,
  generateHandoff,
  writeHandoff: writeHandoffImpl = writeHandoff,
  snapshotPath = (sessionId) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cli-'));
    return path.join(dir, `session-${sessionId}.jsonl`);
  },
  prompt,
  now = () => Date.now(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const write = (text) => stdout.write(text);
  const error = (text) => stderr.write(text);

  let sessions;
  try {
    sessions = await discoverSessions();
  } catch (cause) {
    error(`Error: failed to discover sessions: ${cause?.message ?? 'unknown error'}\n`);
    return 1;
  }

  if (!Array.isArray(sessions) || sessions.length === 0) {
    error('No resumable Codex sessions found on this machine.\n');
    return 1;
  }

  const groups = groupSessionsByWorkspace(sessions);

  write(renderWorkspaceMenu(groups));
  const workspaceAnswer = await prompt('> ');
  if (workspaceAnswer === CANCELLED) return 130;
  const workspaceIndex = parseSelection(workspaceAnswer, groups.length);
  if (workspaceIndex === null) {
    error('Invalid selection.\n');
    return 1;
  }
  const group = groups[workspaceIndex];
  const workspaceSessions = group.sessions;

  write(renderSessionMenu(group.workspaceName, workspaceSessions, now()));
  const sessionAnswer = await prompt('> ');
  if (sessionAnswer === CANCELLED) return 130;
  const sessionIndex = parseSelection(sessionAnswer, workspaceSessions.length);
  if (sessionIndex === null) {
    error('Invalid selection.\n');
    return 1;
  }
  const session = workspaceSessions[sessionIndex];

  const repo = workspaceRoot(session) ?? session.cwd;

  let markdown;
  let resumeSummary;
  try {
    const capture = captureSession(session, snapshotPath(session.id), { refreshSnapshot: true });
    ({ markdown, resumeSummary } = generateHandoff(capture, repo));
  } catch (cause) {
    error(`Error: handoff generation failed: ${cause?.message ?? 'unknown error'}\n`);
    return 1;
  }

  write('\nDevelopment State\n\n');
  write(renderResumeSummary(resumeSummary));

  const confirm = await prompt('\nGenerate handoff? [Y/n] ');
  if (confirm === CANCELLED) return 130;
  if (!/^(?:y|yes|)$/i.test(String(confirm).trim())) {
    write('\nAborted.\n');
    return 0;
  }

  let savedPath;
  try {
    savedPath = writeHandoffImpl({ repo, markdown });
  } catch (cause) {
    error(`Error: failed to save handoff: ${cause?.message ?? 'unknown error'}\n`);
    return 1;
  }

  write(renderSuccess(savedPath));
  return 0;
}
