import { createElement, useEffect, useState } from 'react';

function formatUpdatedAt(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Read-only list. Only renders fields the Core actually returned — no
// fabricated titles or workspace names when metadata is missing.
export function RecentSessionsList({ sessions, loading, error, selectedId, onSelect, onRetry, api, onViewSessions, onOpenLatest }) {
  if (loading) return createElement('p', { className: 'margin-muted' }, 'Loading sessions…');
  if (error) return createElement('div', null,
    createElement('p', { role: 'alert', className: 'margin-error' }, error),
    createElement('button', { type: 'button', onClick: onRetry }, 'Retry')
  );
  if (!sessions.length) return createElement('p', { className: 'margin-muted' }, 'No Codex sessions found on this machine.');
  return createElement('div', { className: 'margin-workspace-list' },
    groupSessionsByWorkspace(sessions).map((group) => createElement('section', { className: 'margin-workspace-group', key: group.workspaceKey },
      createElement('header', { className: 'margin-workspace-header' },
        createElement('strong', null, group.workspaceName),
        createElement('span', null, `${group.sessions.length} ${group.sessions.length === 1 ? 'session' : 'sessions'}`)
      ),
      api ? createElement(WorkspaceOverview, { api, workspaceKey: group.workspaceKey,
        onViewSessions, onOpenLatest }) : null,
      createElement('ul', { className: 'margin-session-list' }, group.sessions.map((session) => createElement('li', { key: session.id },
      createElement('button', {
        type: 'button', className: 'margin-session-card', 'data-session-id': session.id,
        'aria-current': selectedId === session.id ? 'true' : undefined,
        onClick: () => onSelect(session.id)
      },
        createElement('strong', null, session.displayTitle ?? session.label ?? session.summary ?? session.id),
        createElement('span', { className: 'margin-session-meta' },
          [session.agent, session.branch, formatUpdatedAt(session.updatedAt)].filter(Boolean).join(' · ')
        )
      )
    )))
    ))
  );
}

function WorkspaceOverview({ api, workspaceKey, onViewSessions, onOpenLatest }) {
  const [state, setState] = useState({ loading: true, error: null, overview: null });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, overview: null });
    api.getWorkspaceOverview(workspaceKey).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { loading: false, error: null, overview: result.data }
        : { loading: false, error: result.error?.message ?? 'Overview unavailable', overview: null });
    });
    return () => { cancelled = true; };
  }, [api, workspaceKey]);
  if (state.loading) return createElement('p', { className: 'margin-muted' }, 'Loading workspace overview…');
  if (state.error) return createElement('p', { className: 'margin-error', role: 'alert' }, state.error);
  const overview = state.overview;
  const latest = overview.latestSession;
  const branchMismatch = latest.historicalBranch && overview.repo.branch && latest.historicalBranch !== overview.repo.branch;
  return createElement('section', { className: 'margin-workspace-overview', 'aria-label': 'Workspace Overview' },
    createElement('h3', null, 'Workspace Overview'),
    overviewRow('Latest session', `${latest.label} · ${formatUpdatedAt(latest.updatedAt) ?? 'Unknown'} · historical branch: ${latest.historicalBranch ?? 'Unknown'}`),
    overviewRow('Latest-session progress', latest.progress?.text ?? 'Unknown'),
    overviewRow('Current repo', `branch: ${overview.repo.branch ?? 'Unknown'} · HEAD: ${overview.repo.shortHead ?? 'Unknown'} · dirty files: ${overview.repo.dirtyCount ?? 'Unknown'}`),
    branchMismatch ? createElement('p', { className: 'margin-overview-note' }, 'Historical branch differs from the current repo branch. This is an observation, not a correctness judgment.') : null,
    overviewRow('Latest-session applicability', latest.currentApplicability?.text ?? 'Unknown'),
    createElement('p', { className: 'margin-muted' }, `${overview.otherResumableSessionCount} other resumable sessions`),
    createElement('div', { className: 'margin-handoff-actions' },
      createElement('button', { type: 'button', className: 'margin-primary-action', onClick: () => onOpenLatest?.(workspaceKey, latest.id) }, 'Open latest session'),
      createElement('button', { type: 'button', onClick: () => onViewSessions?.(workspaceKey) }, 'View sessions')
    )
  );
}

function overviewRow(label, value) {
  return createElement('p', { className: 'margin-overview-row', key: label },
    createElement('strong', null, `${label}: `), value ?? 'Unknown');
}

function timestamp(value) {
  const time = new Date(value ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function groupSessionsByWorkspace(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const workspaceKey = session.workspaceKey ?? `cwd:${session.cwd ?? 'unknown'}`;
    const group = groups.get(workspaceKey) ?? { workspaceKey, workspaceName: session.workspaceName ?? 'Unknown workspace', sessions: [] };
    group.sessions.push(session);
    groups.set(workspaceKey, group);
  }
  return [...groups.values()]
    .map(group => ({ ...group, sessions: [...group.sessions].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)) }))
    .sort((a, b) => timestamp(b.sessions[0]?.updatedAt) - timestamp(a.sessions[0]?.updatedAt));
}
