import { useEffect, useMemo, useRef, useState } from "react";
import SidebarTabs from "./components/SidebarTabs";
import ReflectiveMargin from "./components/ReflectiveMargin";
import ConversationAnnotations from "./components/ConversationAnnotations";
import GrowthJourney from "./components/GrowthJourney";
import SettingsSheet from "./components/SettingsSheet";
import ManagementSheet from "./components/ManagementSheet";
import ImprintCollection, { ImprintUnlockNotice } from "./components/ImprintCollection";
import { ProfilePage, TraceSectionNav, type MemorySubpage } from "./components/TraceSections";
import ShelfView from "./components/ShelfView";
import WindowControls from "./components/WindowControls";
import { buildGrowthPageModel } from "./viewModels/paperWorkspace";
import { useMarginWorkspace } from "./hooks/useMarginWorkspace";
import type {
  MarginSettingsPatch,
  MarginSettingsSnapshot,
} from "./electron";
import type {
  ManagementOverviewCandidate,
  ManagementProposal,
  MemoryCard,
} from "./lib/api";
import type {
  Message,
  NavigationTab,
  ShelfItem,
  TaskNode,
  WorkspaceSection,
} from "./types";

const NAVIGATION: NavigationTab[] = [
  { id: "journal", label: "思考片段" },
  { id: "learning", label: "学习轨迹" },
  { id: "memory", label: "留痕" },
  { id: "settings", label: "设置" },
];

const DEFAULT_SETTINGS: MarginSettingsSnapshot = {
  conversation: { provider: "local", model: "margin-local" },
  speech: {
    provider: "siliconflow",
    ttsModel: "FunAudioLLM/CosyVoice2-0.5B",
    voice: "FunAudioLLM/CosyVoice2-0.5B:alex",
    speed: 1,
    sttModel: "FunAudioLLM/SenseVoiceSmall",
    language: "zh",
  },
  preferences: {
    lightReadingEnabled: false,
    fontScale: 1,
    lineHeight: 1,
    motion: "full",
  },
  keys: {
    openai: { configured: false, masked: "" },
    anthropic: { configured: false, masked: "" },
    siliconflow: { configured: false, masked: "" },
  },
  secureStorageAvailable: false,
  dataDirectory: "",
};

type WorkspaceEnhancements = ReturnType<typeof useMarginWorkspace> & {
  updateLearningStep?: (sessionId: number | string, stepIndex: number, status: string) => Promise<unknown>;
  managementProposals?: { proposals?: ManagementProposal[] } | null;
  createManagementProposal?: (input: Record<string, unknown>) => Promise<unknown>;
  cancelManagementProposal?: (id: number | string, reason?: string) => Promise<unknown>;
};

function readable(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const compact = value.trim();
  return compact.length > 1 && compact.replace(/[?？\s]/g, "").length > Math.min(2, compact.length / 3);
}

function cleanText(value: string) {
  return value.replace(/[?？]{3,}/g, "〔早期记录已损坏〕");
}

function displayTitle(value: unknown, fallback: string) {
  if (!readable(value) || /[?？]{3,}/.test(value)) return fallback;
  return cleanText(value);
}

function timeLabel(timestamp?: string) {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function messagesFromMemory(memories: MemoryCard[] = []): Message[] {
  return memories
    .slice(0, 5)
    .reverse()
    .flatMap((memory) => {
      const pair: Message[] = [];
      if (readable(memory.user_input)) {
        pair.push({
          id: `memory-${memory.id}-user`,
          role: "user",
          text: cleanText(memory.user_input),
          timestamp: timeLabel(memory.timestamp),
        });
      }
      if (readable(memory.echo_response)) {
        pair.push({
          id: `memory-${memory.id}-assistant`,
          role: "assistant",
          text: cleanText(memory.echo_response),
          timestamp: timeLabel(memory.timestamp),
        });
      }
      return pair;
    });
}

function normalizeTaskStatus(status?: string): TaskNode["status"] {
  if (status === "done" || status === "active") return status;
  return "pending";
}

function scopeForCandidate(candidate: ManagementOverviewCandidate) {
  if (candidate.target_type === "learning_session") return "learning";
  if (candidate.target_type === "action") return "actions";
  return "memory";
}

export default function App() {
  const baseWorkspace = useMarginWorkspace({ managementScope: "all" });
  const workspace = baseWorkspace as WorkspaceEnhancements;
  const [section, setSection] = useState<WorkspaceSection>("journal");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [settings, setSettings] = useState<MarginSettingsSnapshot>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<ManagementProposal | null>(null);
  const [memorySubpage, setMemorySubpage] = useState<MemorySubpage>("traces");
  const [dismissedUnlockKey, setDismissedUnlockKey] = useState<string | null>(null);
  const seededConversation = useRef(false);
  const activeAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!window.marginDesktop?.getSettings) return;
    window.marginDesktop.getSettings()
      .then(setSettings)
      .catch(() => setSettingsNotice("设置纸暂时没能读到，当前使用安全默认值。"));
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--user-font-scale", String(settings.preferences.fontScale));
    document.documentElement.dataset.motion = settings.preferences.motion;
  }, [settings.preferences.fontScale, settings.preferences.motion]);

  useEffect(() => {
    if (seededConversation.current || !workspace.memoryView) return;
    setMessages(messagesFromMemory(workspace.memoryView.memories));
    seededConversation.current = true;
  }, [workspace.memoryView]);

  const learning = workspace.learningLine?.current_learning;
  const learningSession = workspace.learningLine?.current_session;
  const growthPageModel = useMemo(() => buildGrowthPageModel(workspace.learningLine), [workspace.learningLine]);
  const learningTasks = useMemo<TaskNode[]>(() => (
    learning?.step_labels?.map((step) => ({
      id: String(step.index),
      title: step.title || `第 ${step.index + 1} 步`,
      status: normalizeTaskStatus(step.status),
      detail: step.index === learning.current_step_index
        ? learning.current_step?.action || "把这一小步做完，再回来留下结果。"
        : undefined,
    })) || []
  ), [learning]);

  const stopSpeaking = () => {
    const audio = activeAudio.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    activeAudio.current = null;
    setSpeakingId(null);
  };

  const handleSpeak = async (message: Message) => {
    setSendError(null);
    stopSpeaking();
    setSpeakingId(message.id);
    try {
      const response = await workspace.synthesizeSpeech(message.text);
      const audio = response.audio;
      if (!audio?.data || !audio.mime_type) throw new Error("轻读服务没有返回可播放的声音。");
      const player = new Audio(`data:${audio.mime_type};base64,${audio.data}`);
      activeAudio.current = player;
      player.addEventListener("ended", () => {
        activeAudio.current = null;
        setSpeakingId(null);
      }, { once: true });
      player.addEventListener("error", () => {
        setSendError("声音播放被中断了，可以稍后再试。");
        activeAudio.current = null;
        setSpeakingId(null);
      }, { once: true });
      await player.play();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "轻读暂时不可用。");
      setSpeakingId(null);
    }
  };

  const handleSend = async (text: string) => {
    stopSpeaking();
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      timestamp: timeLabel(new Date().toISOString()),
    };
    setMessages((current) => [...current, userMessage]);
    setSendError(null);
    setIsSending(true);

    try {
      const response = await workspace.sendReflect({ message: text });
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: response.text || "我在。我们可以沿着这句话，慢一点继续。",
        timestamp: timeLabel(new Date().toISOString()),
      };
      setMessages((current) => [...current, assistantMessage]);
      if (settings.preferences.lightReadingEnabled && workspace.apiInfo?.capabilities?.tts) {
        window.setTimeout(() => void handleSpeak(assistantMessage), 0);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "这句话暂时没能写入，请稍后再试。");
    } finally {
      setIsSending(false);
    }
  };

  const handleStepChange = async (task: TaskNode) => {
    if (!workspace.updateLearningStep || learningSession?.id === undefined || task.status !== "active") return;
    const stepIndex = Number(task.id);
    try {
      await workspace.updateLearningStep(learningSession.id, stepIndex, "done");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "学习步骤暂时未能更新。");
    }
  };

  const handleLightReadingChange = async (enabled: boolean) => {
    if (enabled && !workspace.apiInfo?.capabilities?.tts) {
      setSection("settings");
      return;
    }
    if (!enabled) stopSpeaking();
    setSettings((current) => ({
      ...current,
      preferences: { ...current.preferences, lightReadingEnabled: enabled },
    }));
    if (window.marginDesktop?.updateSettings) {
      try {
        const result = await window.marginDesktop.updateSettings({ preferences: { lightReadingEnabled: enabled } });
        setSettings(result.settings);
      } catch {
        setSettingsNotice("轻读偏好暂时未能保存，本次使用仍然有效。");
      }
    }
  };

  const handleSettingsSave = async (patch: MarginSettingsPatch) => {
    if (!window.marginDesktop?.updateSettings) return;
    setSettingsSaving(true);
    setSettingsNotice("正在验证设置并重新连接服务……");
    try {
      const result = await window.marginDesktop.updateSettings(patch);
      setSettings(result.settings);
      setSettingsNotice(result.message || "设置已经安全保存并应用。");
      await workspace.refresh();
    } catch (error) {
      setSettingsNotice(error instanceof Error ? `设置没有生效：${error.message}` : "设置没有生效，已保留原来的可用配置。");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleTranscribe = async (audio: Blob) => {
    const result = await workspace.transcribeAudio(audio);
    if (!result.transcript?.trim()) throw new Error("语音服务没有识别出可写入的文字。");
    return result.transcript;
  };

  const shelf = useMemo(
    () => buildShelf(section, workspace, setOperationNotice, setPendingProposal),
    [section, workspace],
  );
  const managementShelf = useMemo(
    () => buildShelf("management", workspace, setOperationNotice, setPendingProposal),
    [workspace],
  );
  const keptShelf = useMemo(
    () => buildKeptShelf(workspace, setOperationNotice),
    [workspace],
  );

  const openManagement = () => {
    setPendingProposal(null);
    setOperationNotice(null);
    setManagementOpen(true);
  };

  const closeManagement = () => {
    setPendingProposal(null);
    setManagementOpen(false);
  };

  const handleConfirmProposal = async (proposal: ManagementProposal) => {
    await confirmProposal(workspace, proposal, setOperationNotice);
    setPendingProposal(null);
  };

  const handleCancelProposal = async (proposal: ManagementProposal) => {
    if (proposal.id === undefined) return;
    try {
      setOperationNotice("正在收起这份未执行的草案……");
      await workspace.cancelManagementProposal?.(proposal.id, "用户从整理确认纸取消草案");
      setOperationNotice("草案已取消，没有改动原有内容。");
      setPendingProposal(null);
    } catch (error) {
      setOperationNotice(error instanceof Error ? `草案未能取消：${error.message}` : "草案暂时未能取消。");
    }
  };
  const hasAnyData = Boolean(
    workspace.state || workspace.actions || workspace.learningLine || workspace.memoryView || workspace.achievements || workspace.managementOverview || workspace.summaries,
  );
  const newestUnlock = workspace.achievements?.recent_unlocks?.find((unlock) => unlock.is_new);
  const newestUnlockRecord = workspace.achievements?.achievements?.find((achievement) => (
    String(achievement.id) === String(newestUnlock?.achievement_id) && achievement.key !== dismissedUnlockKey
  ));

  const acknowledgeUnlock = async (key: string) => {
    setDismissedUnlockKey(key);
    try {
      const newKeys = (workspace.achievements?.recent_unlocks || [])
        .filter((unlock) => unlock.is_new)
        .map((unlock) => workspace.achievements?.achievements?.find((achievement) => (
          String(achievement.id) === String(unlock.achievement_id)
        ))?.key)
        .filter((candidate): candidate is string => Boolean(candidate));
      for (const candidate of new Set([key, ...newKeys])) {
        await workspace.acknowledgeAchievement(candidate);
      }
      await workspace.refresh();
    } catch {
      // The notice stays dismissed locally; a later refresh may safely retry acknowledgement.
    }
  };

  if (workspace.loading && !hasAnyData) {
    return (
      <main className="app-shell">
        <WindowControls />
        <div className="notebook-frame loading-page">纸页正在慢慢展开……</div>
      </main>
    );
  }

  if (workspace.error && !hasAnyData) {
    return (
      <main className="app-shell">
        <WindowControls />
        <div className="notebook-frame loading-page">
          <div className="fatal-error">
            <h1>纸页暂时没有连接上</h1>
            <p>{workspace.error.message}</p>
            <button onClick={() => void workspace.refresh()} type="button">重新连接</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <WindowControls />
      <div className={`notebook-frame section-${section}`}>
        <SidebarTabs activeTab={section} onSelect={setSection} tabs={NAVIGATION} />
        {section === "journal" ? (
          <>
            <div className="page-left">
            <ReflectiveMargin
              error={sendError || (workspace.error ? "部分内容暂时未同步，已保留当前纸页。" : null)}
              isSending={isSending}
              lightReadingEnabled={settings.preferences.lightReadingEnabled}
              messages={messages}
              onLightReadingChange={handleLightReadingChange}
              onOpenSettings={() => setSection("settings")}
              onRecordingStart={stopSpeaking}
              onSend={handleSend}
              onSpeak={handleSpeak}
              onStopSpeak={stopSpeaking}
              onTranscribe={handleTranscribe}
              speakingId={speakingId}
              sttAvailable={Boolean(workspace.apiInfo?.capabilities?.stt)}
              ttsAvailable={Boolean(workspace.apiInfo?.capabilities?.tts)}
            />
            </div>
            <ConversationAnnotations
              growthSuggestion={learning?.topic ? {
                title: "这条线可以继续生长",
                detail: `“${learning.topic}”已经形成一条成长线，可以在另一页慢慢推进。`,
              } : undefined}
              noticed={learning?.current_step?.action || "有些真正重要的话，往往会在停顿和反复里慢慢显出来。"}
              onOpenGrowth={() => setSection("learning")}
              prompt={learning?.topic
                ? `如果不要求一次做得完整，关于“${learning.topic}”，下一小步可以是什么？`
                : "如果不急着得出结论，刚才哪句话还值得多停留一会儿？"}
              ribbonLabel={workspace.refreshing ? "正在同步纸页" : "随对话慢慢形成"}
              seen={learning?.summary || "这段对话里，已经有一些感受和想法开始变得清楚。"}
            />
          </>
        ) : section === "settings" ? (
          <SettingsSheet
            desktopAvailable={Boolean(window.marginDesktop?.getSettings)}
            notice={settingsNotice}
            onOpenManagement={openManagement}
            onSave={handleSettingsSave}
            saving={settingsSaving}
            settings={settings}
          />
        ) : section === "learning" ? (
          <GrowthJourney
            currentAction={learning?.current_step?.action || "把这一小步做完，再回来留下结果。"}
            model={growthPageModel}
            onCompleteCurrent={workspace.updateLearningStep ? () => {
              const activeTask = learningTasks.find((task) => task.status === "active");
              if (activeTask) void handleStepChange(activeTask);
            } : undefined}
            otherLines={(workspace.learningLine?.sessions || []).map((session) => session.topic || "一条未命名的成长线").filter((topic) => topic !== learning?.topic)}
            records={workspace.memoryView?.memories || []}
          />
        ) : (
          <div className={`workspace-page section-paper section-paper-${section}`}>
            {section === "memory" && <TraceSectionNav active={memorySubpage} onSelect={setMemorySubpage} />}
            {section === "memory" && memorySubpage === "imprints" ? (
              <ImprintCollection
                achievements={workspace.achievements}
                onAcknowledge={acknowledgeUnlock}
                onBack={() => setMemorySubpage("traces")}
              />
            ) : section === "memory" && memorySubpage === "profile" ? (
              <ProfilePage
                onOverride={workspace.overrideProfile}
                onRefresh={workspace.refreshProfile}
                profile={workspace.profile}
              />
            ) : (
              <ShelfView
                eyebrow={section === "memory" && memorySubpage === "kept" ? "被主动留下的" : undefined}
                footerText={section === "memory" && memorySubpage === "kept" ? "长期留下并不意味着永远不能修正。" : undefined}
                items={section === "memory" && memorySubpage === "kept" ? keptShelf.items : shelf.items}
                notice={operationNotice}
                onOpenImprints={section === "memory" ? () => setMemorySubpage("imprints") : undefined}
                onOpenManagement={openManagement}
                section={section}
                summary={section === "memory" && memorySubpage === "kept" ? keptShelf.summary : shelf.summary}
                title={section === "memory" && memorySubpage === "kept" ? "长期留下" : undefined}
              />
            )}
          </div>
        )}
        {managementOpen && (
          <ManagementSheet
            items={managementShelf.items}
            notice={operationNotice}
            onBack={() => setPendingProposal(null)}
            onCancel={handleCancelProposal}
            onClose={closeManagement}
            onConfirm={handleConfirmProposal}
            pendingProposal={pendingProposal}
            summary={managementShelf.summary}
          />
        )}
        {newestUnlockRecord?.key && (
          <ImprintUnlockNotice
            onAcknowledge={acknowledgeUnlock}
            onOpen={() => {
              setSection("memory");
              setMemorySubpage("imprints");
            }}
            record={newestUnlockRecord}
          />
        )}
      </div>
    </main>
  );
}

function buildShelf(
  section: WorkspaceSection | "management",
  workspace: WorkspaceEnhancements,
  setNotice: (notice: string | null) => void,
  requestConfirmation: (proposal: ManagementProposal) => void,
): { summary: string; items: ShelfItem[] } {
  if (section === "learning") {
    const sessions = workspace.learningLine?.sessions || [];
    const currentLearning = workspace.learningLine?.current_learning;
    const currentSession = workspace.learningLine?.current_session;
    const currentStep = currentLearning?.current_step;
    const currentStepItem: ShelfItem[] = currentStep ? [{
      id: `current-step-${currentSession?.id ?? "active"}-${currentStep.index}`,
      eyebrow: "当前一步",
      title: currentStep.title || "把这一小步做完",
      detail: currentStep.action || "完成后再继续下一步，不必一次走完整条线。",
      accent: "#76868a",
      actionLabel: workspace.updateLearningStep && currentSession?.id !== undefined ? "完成这个小步" : undefined,
      onAction: workspace.updateLearningStep && currentSession?.id !== undefined
        ? () => void completeCurrentLearningStep(workspace, currentSession.id as number | string, currentStep.index, setNotice)
        : undefined,
    }] : [];
    const actions: ShelfItem[] = (workspace.actions?.actions || [])
      .filter((action) => action.status !== "dismissed")
      .map((action, index) => ({
        id: `action-${action.id ?? index}`,
        eyebrow: action.status === "active" ? "当前行动" : action.status === "done" ? "已经完成" : "行动队列",
        title: displayTitle(action.title, "一项待处理行动"),
        detail: cleanText(action.detail || action.completion_hint || "把它缩小到下一步即可。"),
        accent: action.status === "done" ? "#7b8c74" : "#9a7442",
        actionLabel: action.status === "done" ? undefined : action.status === "active" ? "标记完成" : "设为当前",
        onAction: action.id === undefined || action.status === "done"
          ? undefined
          : () => void changeActionStatus(workspace, action.id as number | string, action.status === "active" ? "done" : "active", setNotice),
      }));
    return {
      summary: workspace.learningLine?.current_learning?.summary || "把正在推进的主题放在同一条线上，不急着一次完成。",
      items: [...currentStepItem, ...sessions.map((session, index) => ({
        id: String(session.id ?? `learning-${index}`),
        eyebrow: session.status === "active" ? "正在推进" : "学习线",
        title: session.topic || "未命名主题",
        detail: session.steps?.find((step) => step.status === "active")?.action || "这条线会保留已经走过的位置。",
        accent: session.status === "active" ? "#9a7442" : "#8d887f",
      })), ...actions],
    };
  }

  if (section === "memory") {
    const memories = (workspace.memoryView?.memories || []).filter((memory) => readable(memory.memory_note));
    const memoryItems: ShelfItem[] = memories.slice(0, 7).map((memory, index) => ({
      id: `memory-${memory.id ?? index}`,
      eyebrow: memory.pinned ? "长期锚点" : memory.priority_bucket === "core" ? "核心记忆" : "最近留下",
      title: displayTitle(memory.memory_note, "一条早期留下的线索"),
      detail: cleanText(memory.insight_note || readable(memory.user_input) && memory.user_input || "它会在相关时刻重新回到上下文里。"),
      accent: memory.pinned ? "#9a7442" : "#8d887f",
      actionLabel: memory.id === undefined ? undefined : memory.pinned ? "这条只是当时" : "留住这条",
      onAction: memory.id === undefined ? undefined : () => void calibrateMemory(
        workspace,
        memory.id as number | string,
        Boolean(memory.pinned),
        setNotice,
      ),
    }));
    const achievementItems: ShelfItem[] = (workspace.achievements?.achievements || [])
      .filter((achievement) => achievement.unlocked)
      .slice(0, 3)
      .map((achievement, index) => ({
        id: `achievement-${achievement.id ?? index}`,
        eyebrow: "被看见的变化",
        title: achievement.title || "一件小事被完成",
        detail: achievement.description || "这段变化已经被悄悄记下。",
        accent: achievement.accent_color,
      }));
    const summaryItems: ShelfItem[] = (workspace.summaries?.summaries || []).slice(0, 3).map((summary, index) => ({
      id: `summary-${summary.id ?? index}`,
      eyebrow: `近期反思 · ${summary.date || "最近"}`,
      title: cleanText(summary.echo_reflection || "这一段变化被留了下来"),
      detail: cleanText(summary.summary || summary.behavioral_pattern || "回看最近发生的变化。"),
      accent: "#8b7355",
    }));
    const summaryControl: ShelfItem = {
      id: "summary-generate",
      eyebrow: "每日留白",
      title: "把今天收束成一页反思",
      detail: "从真实对话、学习事件和记忆中生成；重复点击不会伪造新的经历。",
      actionLabel: "生成今日总结",
      onAction: () => void createDailySummary(workspace, setNotice),
      accent: "#9a7442",
    };
    return {
      summary: workspace.memoryView?.current_memory?.summary || "这里不是档案柜，只放那些以后仍可能帮到你的线索。",
      items: [summaryControl, ...summaryItems, ...achievementItems, ...memoryItems],
    };
  }

  const proposals = workspace.managementProposals?.proposals || [];
  const proposalItems: ShelfItem[] = proposals.map((proposal, index) => ({
    id: `proposal-${proposal.id ?? index}`,
    eyebrow: `整理草案 · ${proposal.status || "等待确认"}`,
    title: proposal.summary || "一份待确认的整理草案",
    detail: proposal.risk_level === "destructive"
      ? "这项操作不可恢复，确认时需要输入明确口令。"
      : "草案不会自行执行，只有你确认后才会改变数据。",
    accent: proposal.risk_level === "destructive" ? "#98584f" : "#8b7355",
    actionLabel: proposal.status === "awaiting_confirmation"
      ? proposal.risk_level === "destructive" ? "当前版本不执行" : "检查并确认"
      : undefined,
    actionDisabled: proposal.risk_level === "destructive",
    onAction: proposal.status === "awaiting_confirmation" && proposal.id !== undefined && proposal.risk_level !== "destructive"
      ? () => requestConfirmation(proposal)
      : undefined,
  }));
  const scopedCandidates = (workspace.managementOverview?.scopes || []).flatMap((scope) => {
    const value = scope as { candidates?: ManagementOverviewCandidate[] };
    return value.candidates || [];
  });
  const candidates = [...(workspace.managementOverview?.candidates || []), ...scopedCandidates];
  const candidateItems: ShelfItem[] = candidates.map((candidate, index) => {
    const actionable = candidate.risk_level !== "read_only" && candidate.suggested_operation !== "review";
    return {
      id: `candidate-${candidate.id ?? index}`,
      eyebrow: `${actionable ? "整理候选" : "只读建议"} · ${candidate.suggested_operation || "review"}`,
      title: displayTitle(candidate.title, "一条需要回看的旧记录"),
      detail: cleanText(candidate.reason || candidate.description || "先形成草案，再决定是否执行。"),
      actionLabel: actionable && workspace.createManagementProposal ? "形成草案" : undefined,
      onAction: actionable && workspace.createManagementProposal
        ? () => void createProposal(workspace, candidate, setNotice)
        : undefined,
    };
  });
  return {
    summary: workspace.managementOverview?.summary || "这里先提出整理建议，不会在你没有确认时改动任何内容。",
    items: [...proposalItems, ...candidateItems],
  };
}

function buildKeptShelf(
  workspace: WorkspaceEnhancements,
  setNotice: (notice: string | null) => void,
): { summary: string; items: ShelfItem[] } {
  const memories = (workspace.memoryView?.memories || []).filter((memory) => (
    memory.pinned || memory.priority_bucket === "core" || memory.priority_bucket === "important"
  ));
  return {
    summary: memories.length
      ? "这些线索被主动保留，或在长期对话中反复证明仍然重要。"
      : "还没有需要长期留下的线索。最近留下的内容仍会保留，不必急着决定。",
    items: memories.map((memory, index) => ({
      id: `kept-${memory.id ?? index}`,
      eyebrow: memory.pinned ? "主动留住" : memory.priority_bucket === "core" ? "长期锚点" : "仍然重要",
      title: displayTitle(memory.memory_note, "一条值得继续保留的线索"),
      detail: cleanText(memory.insight_note || memory.user_input || "它会在相关时刻重新回到上下文里。"),
      accent: memory.pinned ? "#927046" : "#777f75",
      actionLabel: memory.id === undefined ? undefined : "这条只是当时",
      onAction: memory.id === undefined ? undefined : () => void calibrateMemory(
        workspace,
        memory.id as number | string,
        true,
        setNotice,
      ),
    })),
  };
}

async function createProposal(
  workspace: WorkspaceEnhancements,
  candidate: ManagementOverviewCandidate,
  setNotice: (notice: string | null) => void,
) {
  try {
    setNotice("正在形成一份不会自动执行的整理草案……");
    await workspace.createManagementProposal?.({
      scope: scopeForCandidate(candidate),
      operation_intent: candidate.suggested_operation || "review",
      target_id: candidate.target_id,
      reason: candidate.reason,
      summary: `整理建议：${displayTitle(candidate.title, "旧记录")}`,
    });
    setNotice("草案已经写好。请在上方确认内容后，再决定是否执行。");
  } catch (error) {
    setNotice(error instanceof Error ? `草案未能生成：${error.message}` : "草案未能生成，请稍后再试。");
  }
}

async function changeActionStatus(
  workspace: WorkspaceEnhancements,
  id: number | string,
  status: "active" | "done",
  setNotice: (notice: string | null) => void,
) {
  try {
    setNotice(status === "done" ? "正在收好这项行动……" : "正在把这项行动放到当前页……");
    await workspace.updateActionStatus(id, status);
    setNotice(status === "done" ? "这项行动已经完成。" : "这项行动已成为当前一步。");
  } catch (error) {
    setNotice(error instanceof Error ? `行动未能更新：${error.message}` : "行动暂时未能更新。");
  }
}

async function completeCurrentLearningStep(
  workspace: WorkspaceEnhancements,
  sessionId: number | string,
  stepIndex: number,
  setNotice: (notice: string | null) => void,
) {
  try {
    setNotice("正在把这一步写进学习线……");
    await workspace.updateLearningStep?.(sessionId, stepIndex, "done");
    setNotice("这一步已经完成，新的线段会从这里继续。");
  } catch (error) {
    setNotice(error instanceof Error ? `这一步未能更新：${error.message}` : "这一步暂时未能更新。");
  }
}

async function createDailySummary(
  workspace: WorkspaceEnhancements,
  setNotice: (notice: string | null) => void,
) {
  try {
    setNotice("正在回看今天留下的对话与行动……");
    await workspace.generateSummary();
    setNotice("今天的反思已经写好并留在这一页了。");
  } catch (error) {
    setNotice(error instanceof Error ? `总结未能生成：${error.message}` : "总结暂时未能生成。");
  }
}

async function calibrateMemory(
  workspace: WorkspaceEnhancements,
  id: number | string,
  currentlyPinned: boolean,
  setNotice: (notice: string | null) => void,
) {
  try {
    setNotice(currentlyPinned ? "正在把这条放回当时的位置……" : "正在把这条留成长期线索……");
    if (currentlyPinned) {
      await workspace.softenMemory(id);
      setNotice("这条仍然保留，但不再作为长期锚点。");
    } else {
      await workspace.keepMemory(id);
      setNotice("这条已经被留住，会在相关时刻重新回到纸面。");
    }
  } catch (error) {
    setNotice(error instanceof Error ? `留痕未能更新：${error.message}` : "留痕暂时未能更新。");
  }
}

async function confirmProposal(
  workspace: WorkspaceEnhancements,
  proposal: ManagementProposal,
  setNotice: (notice: string | null) => void,
) {
  if (proposal.id === undefined) return;
  if (proposal.risk_level === "destructive") {
    setNotice("当前版本不执行不可恢复的整理操作。");
    return;
  }
  try {
    setNotice("正在执行已确认的整理草案……");
    await workspace.executeManagementProposal(proposal.id, "");
    setNotice("整理已经完成，纸页正在同步最新状态。");
  } catch (error) {
    setNotice(error instanceof Error ? `整理未执行：${error.message}` : "整理未能执行，请稍后再试。");
  }
}
