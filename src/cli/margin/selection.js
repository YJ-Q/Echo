// Pure, UI-agnostic selection helpers for the Margin CLI. These functions do
// not read the filesystem or run Git — they only order and index the already
// enriched session list that discovery produces, so they are trivially testable.

function timestamp(value) {
  const time = new Date(value ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

// Most-recent first, with the session id as the deterministic tie-breaker. This
// matches the ordering the Web surface already relies on.
export function sortSessionsByUpdatedAt(sessions) {
  return [...sessions].sort((a, b) =>
    timestamp(b.updatedAt) - timestamp(a.updatedAt)
    || String(b.id).localeCompare(String(a.id)));
}

// Group sessions under the workspace identity discovery already derived, then
// order both the groups and each group's sessions by most-recent update. The
// workspaceKey/workspaceName come from resolveWorkspaceIdentity; when absent we
// fall back to the raw cwd so a session never silently disappears.
export function groupSessionsByWorkspace(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = session.workspaceKey ?? `cwd:${session.cwd ?? 'unknown'}`;
    const group = groups.get(key) ?? {
      workspaceKey: key,
      workspaceName: session.workspaceName ?? 'Unknown workspace',
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(group => ({ ...group, sessions: sortSessionsByUpdatedAt(group.sessions) }))
    .sort((a, b) => timestamp(b.sessions[0]?.updatedAt) - timestamp(a.sessions[0]?.updatedAt));
}

// Parse a 1-based menu number into a 0-based index. Returns null for anything
// that is not a valid in-range integer, so the caller can emit one clear error.
export function parseSelection(value, count) {
  const trimmed = String(value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const index = Number(trimmed) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  return index;
}

// Compact relative time used in the session menu ("6 min ago"). Matches the
// Web surface's wording so the two stay consistent.
export function formatRelativeTime(iso, now = Date.now()) {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Recover the workspace root path from the discovery identity. resolveWorkspaceIdentity
// encodes it as `git:<root>` or `cwd:<root>`; this strips that prefix so a git
// session captured from a subdirectory still saves HANDOFF.md at the repo root,
// while a non-Git workspace uses its cwd. Falls back to the session cwd.
export function workspaceRoot(session) {
  const key = session.workspaceKey ?? '';
  const separator = key.indexOf(':');
  if (separator < 0) return session.cwd ?? null;
  return key.slice(separator + 1) || (session.cwd ?? null);
}
