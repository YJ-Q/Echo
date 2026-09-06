// Plain-text rendering for the CLI. These functions only turn already-computed
// data into strings; they never re-derive or re-word state, and they mirror the
// four sections the Web ResumeSummary surface already shows.

import { formatRelativeTime } from './selection.js';

export function renderWorkspaceMenu(groups) {
  const lines = ['', 'Margin', '', 'Select workspace:', ''];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const count = group.sessions.length;
    lines.push(`${i + 1}. ${group.workspaceName}  ${count} ${count === 1 ? 'session' : 'sessions'}`);
  }
  return lines.join('\n') + '\n';
}

export function renderSessionMenu(workspaceName, sessions, now = Date.now()) {
  const lines = ['', workspaceName, ''];
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    lines.push(`${i + 1}. ${session.label}`);
    const meta = [session.branch, formatRelativeTime(session.updatedAt, now)].filter(Boolean).join(' · ');
    if (meta) lines.push(`   ${meta}`);
  }
  return lines.join('\n') + '\n';
}

function section(title, content) {
  const values = Array.isArray(content) ? content : [content ?? 'Unknown'];
  return [`${title}`, ...values.map(value => String(value?.text ?? value))].join('\n');
}

export function renderResumeSummary(summary) {
  const goal = section('Goal', summary?.goal?.text);
  const progress = section('Progress', (summary?.progress ?? []).map(item => item.text));
  const applicability = section('Current applicability', summary?.currentApplicability?.text);
  const validation = section('Current validation', summary?.currentValidation?.text);
  return `${goal}\n\n${progress}\n\n${applicability}\n\n${validation}\n`;
}

export function renderSuccess(path) {
  return `\n✓ Saved ${path}\n\nNext:\nAsk your coding agent to read .margin/HANDOFF.md\nand continue from that development state.\n`;
}
