import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AchievementResponse,
  acknowledgeAchievement,
  ActionListResponse,
  ActionMutationResponse,
  ApiInfoResponse,
  ChatRequest,
  ChatResponse,
  cancelManagementProposal,
  confirmManagementProposal,
  createManagementProposal,
  executeManagementProposal,
  fetchActions,
  fetchApiInfo,
  fetchAchievements,
  fetchLearningLine,
  fetchManagementOverview,
  fetchManagementProposals,
  fetchMemoryView,
  fetchProfile,
  fetchState,
  fetchSummaries,
  generateSummary,
  LearningStepUpdateResponse,
  isMarginApiError,
  MarginApiError,
  ManagementOverviewResponse,
  ManagementProposalCreateResponse,
  ManagementProposalExecutionResponse,
  ManagementProposalListResponse,
  MemoryResponse,
  MemoryMutationResponse,
  ProfileResponse,
  LearningActiveResponse,
  ReflectResponse,
  SummaryListResponse,
  SummaryRecord,
  sendChat,
  sendReflect,
  keepMemory,
  softenMemory,
  refreshProfile,
  overrideProfile,
  synthesizeSpeech,
  transcribeAudio,
  SttResponse,
  TtsResponse,
  updateActionStatus,
  updateLearningStep,
  type JsonObject
} from '@/lib/api';

export interface MarginWorkspaceData {
  apiInfo: ApiInfoResponse | null;
  state: Record<string, unknown> | null;
  actions: ActionListResponse | null;
  learningLine: LearningActiveResponse | null;
  memoryView: MemoryResponse | null;
  profile: ProfileResponse | null;
  achievements: AchievementResponse | null;
  managementOverview: ManagementOverviewResponse | null;
  managementProposals: ManagementProposalListResponse | null;
  summaries: SummaryListResponse | null;
}

export interface UseMarginWorkspaceOptions {
  managementScope?: 'all' | 'learning' | 'memory' | 'actions';
  autoLoad?: boolean;
}

export interface UseMarginWorkspaceResult extends MarginWorkspaceData {
  loading: boolean;
  refreshing: boolean;
  error: MarginApiError | null;
  refresh: () => Promise<void>;
  sendChat: (input: string | ChatRequest) => Promise<ChatResponse>;
  sendReflect: (input: JsonObject & { message: string }) => Promise<ReflectResponse>;
  updateActionStatus: (
    id: number | string,
    status: 'pending' | 'active' | 'done' | 'dismissed'
  ) => Promise<ActionMutationResponse>;
  generateSummary: () => Promise<SummaryRecord>;
  synthesizeSpeech: (text: string) => Promise<TtsResponse>;
  transcribeAudio: (audio: Blob) => Promise<SttResponse>;
  updateLearningStep: (
    sessionId: number | string,
    stepIndex: number | string,
    status?: 'pending' | 'active' | 'done'
  ) => Promise<LearningStepUpdateResponse>;
  fetchManagementProposals: () => Promise<ManagementProposalListResponse>;
  createManagementProposal: (input: JsonObject) => Promise<ManagementProposalCreateResponse>;
  confirmManagementProposal: (
    id: number | string,
    confirmationText?: string
  ) => Promise<ManagementProposalExecutionResponse>;
  cancelManagementProposal: (
    id: number | string,
    cancellationReason?: string
  ) => Promise<ManagementProposalExecutionResponse>;
  executeManagementProposal: (
    id: number | string,
    confirmationText?: string
  ) => Promise<ManagementProposalExecutionResponse>;
  acknowledgeAchievement: (key: string) => Promise<unknown>;
  keepMemory: (id: number | string) => Promise<MemoryMutationResponse>;
  softenMemory: (id: number | string) => Promise<MemoryMutationResponse>;
  refreshProfile: () => Promise<ProfileResponse>;
  overrideProfile: (key: string, value: string) => Promise<ProfileResponse>;
}

const EMPTY_WORKSPACE: MarginWorkspaceData = {
  apiInfo: null,
  state: null,
  actions: null,
  learningLine: null,
  memoryView: null,
  profile: null,
  achievements: null,
  managementOverview: null,
  managementProposals: null,
  summaries: null
};

export function useMarginWorkspace(options: UseMarginWorkspaceOptions = {}): UseMarginWorkspaceResult {
  const { managementScope = 'all', autoLoad = true } = options;
  const [workspace, setWorkspace] = useState<MarginWorkspaceData>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<MarginApiError | null>(null);
  const loadTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const workspaceRef = useRef<MarginWorkspaceData>(workspace);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const refresh = useCallback(async () => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const currentWorkspace = workspaceRef.current;
    const isInitialLoad = currentWorkspace.apiInfo === null &&
      currentWorkspace.state === null &&
      currentWorkspace.actions === null &&
      currentWorkspace.learningLine === null &&
      currentWorkspace.memoryView === null &&
      currentWorkspace.profile === null &&
      currentWorkspace.achievements === null &&
      currentWorkspace.managementOverview === null &&
      currentWorkspace.managementProposals === null &&
      currentWorkspace.summaries === null;

    setError(null);
    if (isInitialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [apiInfoResult, stateResult, actionsResult, learningResult, memoryResult, profileResult, achievementsResult, overviewResult, proposalsResult, summariesResult] = await Promise.allSettled([
        fetchApiInfo({ signal: controller.signal }),
        fetchState('', { signal: controller.signal }),
        fetchActions(12, { signal: controller.signal }),
        fetchLearningLine({ signal: controller.signal }),
        fetchMemoryView(24, { signal: controller.signal }),
        fetchProfile({ signal: controller.signal }),
        fetchAchievements({ signal: controller.signal }),
        fetchManagementOverview(managementScope, { signal: controller.signal }),
        fetchManagementProposals({ signal: controller.signal }),
        fetchSummaries(5, { signal: controller.signal })
      ]);

      if (controller.signal.aborted || loadTokenRef.current !== token) {
        return;
      }

      const nextWorkspace: MarginWorkspaceData = {
        apiInfo: currentWorkspace.apiInfo,
        state: currentWorkspace.state,
        actions: currentWorkspace.actions,
        learningLine: currentWorkspace.learningLine,
        memoryView: currentWorkspace.memoryView,
        profile: currentWorkspace.profile,
        achievements: currentWorkspace.achievements,
        managementOverview: currentWorkspace.managementOverview,
        managementProposals: currentWorkspace.managementProposals,
        summaries: currentWorkspace.summaries
      };
      const failures: Array<{ key: keyof MarginWorkspaceData | 'state'; error: MarginApiError }> = [];

      applySettledResult('apiInfo', apiInfoResult, nextWorkspace, failures);
      applySettledResult('state', stateResult, nextWorkspace, failures);
      applySettledResult('actions', actionsResult, nextWorkspace, failures);
      applySettledResult('learningLine', learningResult, nextWorkspace, failures);
      applySettledResult('memoryView', memoryResult, nextWorkspace, failures);
      applySettledResult('profile', profileResult, nextWorkspace, failures);
      applySettledResult('achievements', achievementsResult, nextWorkspace, failures);
      applySettledResult('managementOverview', overviewResult, nextWorkspace, failures);
      applySettledResult('managementProposals', proposalsResult, nextWorkspace, failures);
      applySettledResult('summaries', summariesResult, nextWorkspace, failures);

      workspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      setError(buildWorkspaceError(failures));
    } finally {
      if (!controller.signal.aborted && loadTokenRef.current === token) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [managementScope]);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    void refresh();

    return () => {
      abortRef.current?.abort();
    };
  }, [autoLoad, refresh]);

  const workspaceSendChat = useCallback(
    async (input: string | ChatRequest) => {
      const result = await sendChat(input);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceSendReflect = useCallback(
    async (input: JsonObject & { message: string }) => {
      const result = await sendReflect(input);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceExecuteManagementProposal = useCallback(
    async (id: number | string, confirmationText = '') => {
      const result = await executeManagementProposal(id, confirmationText);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceUpdateLearningStep = useCallback(
    async (sessionId: number | string, stepIndex: number | string, status: 'pending' | 'active' | 'done' = 'done') => {
      const result = await updateLearningStep(sessionId, stepIndex, status);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceUpdateActionStatus = useCallback(
    async (id: number | string, status: 'pending' | 'active' | 'done' | 'dismissed') => {
      const result = await updateActionStatus(id, status);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceGenerateSummary = useCallback(async () => {
    const result = await generateSummary();
    void refresh();
    return result;
  }, [refresh]);

  const workspaceSynthesizeSpeech = useCallback(async (text: string) => {
    return synthesizeSpeech(text);
  }, []);

  const workspaceTranscribeAudio = useCallback(async (audio: Blob) => {
    return transcribeAudio(audio);
  }, []);

  const workspaceFetchManagementProposals = useCallback(
    async () => {
      return fetchManagementProposals();
    },
    []
  );

  const workspaceCreateManagementProposal = useCallback(
    async (input: JsonObject) => {
      const result = await createManagementProposal(input);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceConfirmManagementProposal = useCallback(
    async (id: number | string, confirmationText = '') => {
      const result = await confirmManagementProposal(id, confirmationText);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceCancelManagementProposal = useCallback(
    async (id: number | string, cancellationReason = '') => {
      const result = await cancelManagementProposal(id, cancellationReason);
      void refresh();
      return result;
    },
    [refresh]
  );

  const workspaceAcknowledgeAchievement = useCallback(async (key: string) => {
    return acknowledgeAchievement(key);
  }, []);

  const workspaceKeepMemory = useCallback(async (id: number | string) => {
    const result = await keepMemory(id);
    void refresh();
    return result;
  }, [refresh]);

  const workspaceSoftenMemory = useCallback(async (id: number | string) => {
    const result = await softenMemory(id);
    void refresh();
    return result;
  }, [refresh]);

  const workspaceRefreshProfile = useCallback(async () => {
    const result = await refreshProfile();
    void refresh();
    return result;
  }, [refresh]);

  const workspaceOverrideProfile = useCallback(async (key: string, value: string) => {
    const result = await overrideProfile(key, value);
    void refresh();
    return result;
  }, [refresh]);

  return {
    ...workspace,
    loading,
    refreshing,
    error,
    refresh,
    sendChat: workspaceSendChat,
    sendReflect: workspaceSendReflect,
    updateActionStatus: workspaceUpdateActionStatus,
    generateSummary: workspaceGenerateSummary,
    synthesizeSpeech: workspaceSynthesizeSpeech,
    transcribeAudio: workspaceTranscribeAudio,
    updateLearningStep: workspaceUpdateLearningStep,
    fetchManagementProposals: workspaceFetchManagementProposals,
    createManagementProposal: workspaceCreateManagementProposal,
    confirmManagementProposal: workspaceConfirmManagementProposal,
    cancelManagementProposal: workspaceCancelManagementProposal,
    executeManagementProposal: workspaceExecuteManagementProposal,
    acknowledgeAchievement: workspaceAcknowledgeAchievement,
    keepMemory: workspaceKeepMemory,
    softenMemory: workspaceSoftenMemory,
    refreshProfile: workspaceRefreshProfile,
    overrideProfile: workspaceOverrideProfile
  };
}

function applySettledResult(
  key: keyof MarginWorkspaceData | 'state',
  settled: PromiseSettledResult<unknown>,
  nextWorkspace: MarginWorkspaceData,
  failures: Array<{ key: keyof MarginWorkspaceData | 'state'; error: MarginApiError }>
): void {
  if (settled.status === 'fulfilled') {
    if (key === 'state') {
      nextWorkspace.state = settled.value as Record<string, unknown>;
    } else {
      nextWorkspace[key] = settled.value as never;
    }
    return;
  }

  const normalized = isMarginApiError(settled.reason)
    ? settled.reason
    : new MarginApiError(settled.reason instanceof Error ? settled.reason.message : 'Request failed', {
        code: 'workspace_load_failed',
        cause: settled.reason
      });

  if (normalized.code === 'request_aborted') {
    return;
  }

  failures.push({ key, error: normalized });
}

function buildWorkspaceError(
  failures: Array<{ key: keyof MarginWorkspaceData | 'state'; error: MarginApiError }>
): MarginApiError | null {
  if (failures.length === 0) {
    return null;
  }

  const details = failures.map((failure) => ({
    key: failure.key,
    code: failure.error.code,
    message: failure.error.message,
    status: failure.error.status
  }));
  const first = failures[0].error;
  const firstLabel = first.message || first.code || 'unknown error';
  const message =
    failures.length === 1
      ? `Margin workspace failed to load: ${failures[0].key} (${firstLabel})`
      : `Margin workspace failed to load: ${failures.length} requests failed`;

  return new MarginApiError(message, {
    code: 'workspace_load_failed',
    details,
    cause: first
  });
}
