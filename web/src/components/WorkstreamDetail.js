import { createElement } from 'react';
import { errorLabel } from '../workbenchState.js';

function value(item) { return item ?? 'Not set'; }

export function WorkstreamDetail({ selectedId, state, onRefresh }) {
  if (!selectedId) return createElement('p', null, 'Select a workstream to continue.');
  if (state.loading) return createElement('p', null, 'Loading workstream…');
  if (state.error) return createElement('div', null,
    createElement('p', { role: 'alert' }, errorLabel(state.error)),
    createElement('button', { type: 'button', onClick: () => onRefresh(selectedId) }, 'Refresh')
  );
  const workstream = state.workstream;
  if (!workstream) return createElement('p', null, 'Select a workstream to continue.');
  return createElement('article', { className: 'workstream-detail' },
    createElement('h2', null, workstream.title),
    detail('Goal', workstream.goal), detail('Status', workstream.status), detail('Current state', workstream.currentState),
    detail('Plan', Array.isArray(workstream.currentPlan) && workstream.currentPlan.length ? workstream.currentPlan.join(', ') : null),
    detail('Next action', workstream.nextAction), detail('Blockers', Array.isArray(workstream.blockers) && workstream.blockers.length ? workstream.blockers.join(', ') : null),
    detail('Latest checkpoint', workstream.latestCheckpoint?.id),
    detail('Workspace reference', workstream.workspaceReference?.path)
  );
}

function detail(label, item) {
  return createElement('p', { key: label }, createElement('strong', null, `${label}: `), value(item));
}
