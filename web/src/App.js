import { createElement, useCallback, useState } from 'react';
import { createApiClient } from './apiClient.js';
import { CreateWorkstreamForm } from './components/CreateWorkstreamForm.js';
import { ActivityPanel } from './components/ActivityPanel.js';
import { ArtifactPanel } from './components/ArtifactPanel.js';
import { ConversationPanel } from './components/ConversationPanel.js';
import { NeedsOwnerPanel } from './components/NeedsOwnerPanel.js';
import { RunControls } from './components/RunControls.js';
import { WorkstreamDetail } from './components/WorkstreamDetail.js';
import { WorkstreamList } from './components/WorkstreamList.js';
import { useWorkbenchData } from './useWorkbenchData.js';

export function App({ api = createApiClient() }) {
  const data = useWorkbenchData(api);
  const [activityGeneration, setActivityGeneration] = useState(0);
  const [authorityGeneration, setAuthorityGeneration] = useState(0);
  const refreshActivity = useCallback(() => setActivityGeneration((generation) => generation + 1), []);
  const refreshAfterInteraction = useCallback(async (id, isTurnCurrent) => {
    await data.refreshAfterInteraction(id, isTurnCurrent);
    if (isTurnCurrent?.() !== false) {
      setAuthorityGeneration((generation) => generation + 1);
      refreshActivity();
    }
  }, [data, refreshActivity]);

  return createElement('main', { className: 'workbench-shell' },
    createElement('section', { className: 'workbench-region', 'aria-label': 'Workstreams' },
      createElement('h1', null, 'Workstreams'),
      createElement('div', { className: 'workstream-list' }, createElement(WorkstreamList, {
        groups: data.groups, selectedId: data.selectedId, onSelect: data.selectWorkstream,
        loading: data.listState.loading, error: data.listState.error, onRetry: data.refreshWorkstreams
      })),
      createElement(CreateWorkstreamForm, {
        api, onCreated: data.createdWorkstream, onUncertain: data.refreshAfterUncertainCreate
      })
    ),
    createElement('section', { className: 'workbench-region', 'aria-label': 'Workbench' },
      createElement('h2', null, 'Workbench'),
      createElement(WorkstreamDetail, { selectedId: data.selectedId, state: data.detailState, onRefresh: data.refreshWorkstream }),
      createElement(RunControls, { key: `run:${data.selectedId}:${authorityGeneration}`, api, workstreamId: data.selectedId, onAuthoritativeReload: data.refreshAfterRunCommand }),
      createElement(ConversationPanel, {
        api, workstreamId: data.selectedId, refreshToken: authorityGeneration, onAuthoritativeRefresh: refreshAfterInteraction
      }),
      createElement(NeedsOwnerPanel, {
        key: `needs:${data.selectedId}:${authorityGeneration}`, api, workstreamId: data.selectedId,
        onAuthoritativeReload: data.refreshAfterNeedsOwnerResolution, onActivityReload: refreshActivity
      }),
      createElement(ArtifactPanel, { key: `artifacts:${data.selectedId}:${authorityGeneration}`, api, workstreamId: data.selectedId })
    ),
    createElement('section', { className: 'workbench-region', 'aria-label': 'Activity' },
      createElement('h2', null, 'Activity'),
      createElement(ActivityPanel, { api, workstreamId: data.selectedId, refreshToken: activityGeneration + authorityGeneration })
    )
  );
}
