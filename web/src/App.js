import { createElement } from 'react';
import { createApiClient } from './apiClient.js';
import { CreateWorkstreamForm } from './components/CreateWorkstreamForm.js';
import { WorkstreamDetail } from './components/WorkstreamDetail.js';
import { WorkstreamList } from './components/WorkstreamList.js';
import { useWorkbenchData } from './useWorkbenchData.js';

export function App({ api = createApiClient() }) {
  const data = useWorkbenchData(api);

  return createElement('main', { className: 'workbench-shell' },
    createElement('section', { className: 'workbench-region', 'aria-label': 'Workstreams' },
      createElement('h1', null, 'Workstreams'),
      createElement('div', { className: 'workstream-list' }, createElement(WorkstreamList, {
        groups: data.groups, selectedId: data.selectedId, onSelect: data.selectWorkstream,
        loading: data.listState.loading, error: data.listState.error, onRetry: data.refreshWorkstreams
      })),
      createElement(CreateWorkstreamForm, { api, onCreated: data.createdWorkstream })
    ),
    createElement('section', { className: 'workbench-region', 'aria-label': 'Workbench' },
      createElement('h2', null, 'Workbench'),
      createElement(WorkstreamDetail, { selectedId: data.selectedId, state: data.detailState, onRefresh: data.refreshWorkstream })
    ),
    createElement('section', { className: 'workbench-region', 'aria-label': 'Activity' },
      createElement('h2', null, 'Activity'),
      createElement('p', null, 'Recent activity will appear here.')
    )
  );
}
