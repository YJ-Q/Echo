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
import { createInitialWorkbenchState } from './workbenchState.js';

const TABS = Object.freeze([
  { id: 'conversation', label: 'Conversation' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'activity', label: 'Activity' }
]);

export function App({ api = createApiClient() }) {
  const data = useWorkbenchData(api);
  const [activityGeneration, setActivityGeneration] = useState(0);
  const [authorityGeneration, setAuthorityGeneration] = useState(0);
  const [activeTab, setActiveTab] = useState(() => createInitialWorkbenchState().tab);
  const refreshActivity = useCallback(() => setActivityGeneration((generation) => generation + 1), []);
  const refreshAfterInteraction = useCallback(async (id, isTurnCurrent) => {
    await data.refreshAfterInteraction(id, isTurnCurrent);
    setAuthorityGeneration((generation) => generation + 1);
    refreshActivity();
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
    createElement('section', { className: 'workbench-region', 'aria-label': 'Current Workstream' },
      createElement('h2', null, 'Current Workstream'),
      createElement(WorkstreamDetail, { selectedId: data.selectedId, state: data.detailState, onRefresh: data.refreshWorkstream }),
      createElement('div', { className: 'workbench-tabs', role: 'tablist', 'aria-label': 'Workstream views' },
        TABS.map((tab) => createElement('button', {
          key: tab.id, type: 'button', role: 'tab', id: `workbench-tab-${tab.id}`,
          'data-workbench-tab': tab.id, 'aria-controls': `workbench-panel-${tab.id}`,
          'aria-selected': activeTab === tab.id ? 'true' : 'false',
          onClick: () => setActiveTab(tab.id)
        }, tab.label))
      ),
      tabPanel('conversation', activeTab,
        createElement(ConversationPanel, {
          api, workstreamId: data.selectedId, refreshToken: authorityGeneration, onAuthoritativeRefresh: refreshAfterInteraction
        })),
      tabPanel('artifacts', activeTab,
        createElement(ArtifactPanel, { key: `artifacts:${data.selectedId}:${authorityGeneration}`, api, workstreamId: data.selectedId })),
      tabPanel('activity', activeTab,
        createElement(ActivityPanel, { api, workstreamId: data.selectedId, refreshToken: activityGeneration + authorityGeneration }))
    ),
    createElement('section', { className: 'workbench-region', 'aria-label': 'Control and Context' },
      createElement('h2', null, 'Control and Context'),
      createElement(RunControls, { key: `run:${data.selectedId}:${authorityGeneration}`, api, workstreamId: data.selectedId, onAuthoritativeReload: data.refreshAfterRunCommand }),
      createElement(ContextSummary, { workstream: data.detailState.workstream }),
      createElement(NeedsOwnerPanel, {
        key: `needs:${data.selectedId}:${authorityGeneration}`, api, workstreamId: data.selectedId,
        onAuthoritativeReload: data.refreshAfterNeedsOwnerResolution, onActivityReload: refreshActivity
      })
    )
  );
}

function tabPanel(id, activeTab, content) {
  return createElement('div', {
    key: id, role: 'tabpanel', id: `workbench-panel-${id}`,
    'aria-labelledby': `workbench-tab-${id}`, hidden: activeTab !== id
  }, content);
}

function ContextSummary({ workstream }) {
  const plan = Array.isArray(workstream?.currentPlan) && workstream.currentPlan.length
    ? workstream.currentPlan.join(', ')
    : 'Not set';
  const nextAction = typeof workstream?.nextAction === 'string' && workstream.nextAction.trim()
    ? workstream.nextAction
    : 'Not set';
  return createElement('section', { className: 'context-summary', 'data-context-summary': 'true' },
    createElement('h2', null, 'Context'),
    createElement('p', null, createElement('strong', null, 'Current plan: '), plan),
    createElement('p', null, createElement('strong', null, 'Next action: '), nextAction)
  );
}
