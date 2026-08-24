import { createElement } from 'react';
import { errorLabel, statusGroup } from '../workbenchState.js';

export function WorkstreamList({ groups, selectedId, onSelect, loading, error, onRetry }) {
  if (loading) return createElement('p', null, 'Loading workstreams…');
  if (error) return createElement('div', null,
    createElement('p', { role: 'alert' }, errorLabel(error)),
    createElement('button', { type: 'button', onClick: onRetry }, 'Retry')
  );
  const empty = !groups.some((group) => group.rows.length);
  return createElement('div', { className: 'workstream-groups' },
    empty ? createElement('p', null, 'No workstreams yet.') : null,
    groups.map((group) =>
    createElement('section', { key: group.name, className: 'workstream-group', 'data-workstream-group': group.name },
      createElement('h2', null, group.name),
      group.rows.length === 0 ? createElement('p', { className: 'muted' }, 'None') :
        createElement('ul', null, group.rows.map((row) => workstreamRow(row, selectedId, onSelect)))
    )
  ));
}

function workstreamRow(row, selectedId, onSelect) {
  const workstream = row.workstream;
  const activeRun = workstream.activeRun;
  return createElement('li', { key: workstream.id },
    createElement('button', {
      type: 'button', className: 'workstream-row', 'data-workstream-id': workstream.id,
      'aria-current': selectedId === workstream.id ? 'true' : undefined,
      onClick: () => onSelect(workstream.id)
    },
    createElement('strong', null, workstream.title),
    createElement('span', { className: 'status-badge', 'data-status': statusGroup(workstream.status) }, workstream.status),
    createElement('span', null, `Priority ${workstream.priority}`),
    createElement('span', null, workstream.nextAction ? `Next ${workstream.nextAction}` : 'No next action'),
    createElement('span', null, activeRun ? `Run ${activeRun.id}` : 'No active run'),
    createElement('span', null, row.hasOpenNeedsOwner ? 'Needs owner' : 'No needs owner'),
    createElement('time', { dateTime: workstream.updatedAt ?? undefined }, workstream.updatedAt ?? 'No update time')
    )
  );
}
