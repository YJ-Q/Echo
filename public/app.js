import {
  MANAGEMENT_SCOPE_LABELS,
  MOCK_ACHIEVEMENTS,
  MOCK_ACHIEVEMENT_ICONS,
  MOCK_MANAGEMENT_OVERVIEWS,
  MOCK_OPERATION_EVENTS,
  PROPOSAL_STATUS_LABELS,
  RARITY_LABELS,
  RISK_LABELS,
  fetchSupplementalViewModels
} from "./viewModels.js";

const FALLBACK_STATE = {
  current_state: {
    emotion: "neutral",
    focus: "等待状态同步",
    pattern: "starting_friction",
    context_note: "正在整理当前线索，准备继续推进。"
  },
  next_action: {
    label: "先把当前线索说清楚",
    detail: "首版先保证状态明确、动作可执行。"
  },
  current_action: null,
  current_learning: null,
  current_reflection: null,
  current_memory: null,
  active_learning: [],
  recent_memories: [],
  recent_reflections: [],
  action_queue: [],
  profile: {
    summary: {}
  }
};

const FALLBACK_DASHBOARD = {
  actions: [],
  learningSessions: [],
  currentLearning: null,
  learningEvents: [],
  memories: [],
  currentMemory: null,
  profile: [],
  profileSummary: "",
  summaries: [],
  managementOverviews: {
    memory: null,
    learning: null,
    actions: null
  },
  proposals: [],
  operationEvents: [],
  achievements: null,
  recentAchievements: [],
  achievementIcons: [],
  syncMeta: {
    sections: {},
    failedCount: 0,
    fallbackCount: 0
  },
  viewModelMode: "mock"
};

const STATE_LABELS = {
  pending: "待处理",
  active: "进行中",
  done: "已完成",
  dismissed: "已移除",
  suggested: "建议中"
};

const EMOTION_PRESETS = {
  anxious: {
    hero: "焦虑",
    label: "焦虑",
    copy: "当前阻力偏高，先把动作缩小。"
  },
  motivated: {
    hero: "有动力",
    label: "有动力",
    copy: "节奏正在往前，可以直接推进。"
  },
  focused: {
    hero: "专注",
    label: "专注",
    copy: "线索稳定，适合继续执行。"
  },
  distracted: {
    hero: "分散",
    label: "分散",
    copy: "先收窄范围，再回到一个动作。"
  },
  neutral: {
    hero: "平静",
    label: "平静",
    copy: "当前没有明显波动，可以继续梳理。"
  }
};

const MINIMAL_VIEW_META = {
  now: { title: "此刻", subtitle: "先留在这里，再慢慢续写。", chip: "页边陪伴" },
  learn: { title: "学习", subtitle: "只看当前这一行。", chip: "学习这条线" },
  actions: { title: "行动", subtitle: "只续写下一行。", chip: "继续这一线" },
  memory: { title: "记忆", subtitle: "只留下值得回来的痕迹。", chip: "留痕连续性" },
  management: { title: "整理", subtitle: "先看清，再决定要不要落笔。", chip: "页边整理" },
  achievements: { title: "记录", subtitle: "把已经发生的变化轻轻收好。", chip: "留痕记录" }
};

const dom = {
  body: document.body,
  launchScreen: document.querySelector("#launch-screen"),
  clock: document.querySelector("#clock"),
  dateLabel: document.querySelector("#date-label"),
  mainWindow: document.querySelector(".main-window"),
  navItems: Array.from(document.querySelectorAll(".nav-item[data-view]")),
  workspaceViews: Array.from(document.querySelectorAll(".workspace-view")),
  statusJumpPanels: Array.from(document.querySelectorAll(".instrument-panel[data-jump-view]")),
  syncChip: document.querySelector("#sync-chip"),
  dataChip: document.querySelector("#data-chip"),
  presenceLabel: document.querySelector("#presence-label"),
  toolbarLabel: document.querySelector("#toolbar-label"),
  viewTitle: document.querySelector("#view-title"),
  viewSubtitle: document.querySelector("#view-subtitle"),
  activeViewChip: document.querySelector("#active-view-chip"),
  secondaryViewChip: document.querySelector("#secondary-view-chip"),
  timelinePanel: document.querySelector("#timeline-panel"),
  boardBadges: document.querySelector("#board-badges"),
  composerForm: document.querySelector("#composer-form"),
  composerInput: document.querySelector("#composer-input"),
  composerSubmit: document.querySelector("#composer-submit"),
  composerSubmitLabel: document.querySelector("#composer-submit-label"),
  playLatestEchoButton: document.querySelector("#play-latest-echo"),
  quickPromptButtons: Array.from(document.querySelectorAll(".quick-prompt")),
  startNextActionButton: document.querySelector("#start-next-action"),
  heroStartActionButton: document.querySelector("#hero-start-action"),
  manualActionForm: document.querySelector("#manual-action-form"),
  manualActionTitle: document.querySelector("#manual-action-title"),
  manualActionDetail: document.querySelector("#manual-action-detail"),
  manualActionSubmit: document.querySelector("#manual-action-submit"),
  suggestedActionForm: document.querySelector("#suggested-action-form"),
  suggestedActionQuery: document.querySelector("#suggested-action-query"),
  suggestedActionSubmit: document.querySelector("#suggested-action-submit"),
  toast: document.querySelector("#app-toast"),
  toastMessage: document.querySelector("#app-toast-message"),
  windowMinimize: document.querySelector("#window-minimize"),
  windowMaximize: document.querySelector("#window-maximize"),
  windowClose: document.querySelector("#window-close")
};

const PRODUCT_NAME = "Margin";

const TTS_UI_COPY = {
  idle: "轻读这一段",
  idleEmpty: "暂无可轻读的内容",
  loading: "正在准备轻读",
  playing: "轻读中",
  error: "再试一次",
  unavailable: "轻读暂不可用"
};

const TTS_ERROR_COPY = {
  tts_not_configured: "轻读功能还没有配置，入口已暂时收起。",
  tts_provider_http_error: "轻读服务暂时没有成功响应，稍后可以重试。",
  tts_provider_json_response: "轻读服务返回了非音频内容，已停止播放。",
  tts_empty_audio: "轻读服务返回了空音频，换一句或稍后再试。",
  tts_provider_request_failed: "还没有连上轻读服务，请稍后重试。"
};

let currentState = structuredClone(FALLBACK_STATE);
let dashboardData = structuredClone(FALLBACK_DASHBOARD);
let timelineEntries = [];
let activeView = "now";
let pendingUserMessage = "";
let dashboardLoading = false;
let isSubmitting = false;
let actionMutationId = null;
let learningMutationKey = "";
let memoryMutationId = null;
let proposalMutationKey = "";
let manualActionSubmitting = false;
let suggestedActionSubmitting = false;
let apiCapabilities = { tts: false };
let toastTimer = null;
let activeManagementScope = "memory";
let activeAchievementSource = "all";
let activeAchievementRarity = "all";
let ttsUiState = "unavailable";
let activeTtsAudio = null;
let activeTtsAudioCleanup = null;
let activeTtsPlaybackToken = 0;
let lastTtsText = "";

function unwrapEnvelope(payload) {
  if (payload && typeof payload === "object" && "ok" in payload) {
    return payload.ok ? payload.data : null;
  }
  return payload;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok || (payload && typeof payload === "object" && payload.ok === false)) {
    const error = new Error(
      payload?.error?.message
      || `Request failed for ${url} with ${response.status}`
    );
    error.code = payload?.error?.code || "request_error";
    error.status = response.status;
    throw error;
  }

  return unwrapEnvelope(payload);
}

function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body || {})
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getErrorMessage(error, fallback = "刚刚的操作没有成功同步。") {
  const message = String(error?.message || "").trim();
  return message || fallback;
}

function showToast(message, tone = "info", duration = 2600) {
  if (!dom.toast || !dom.toastMessage) return;

  dom.toastMessage.textContent = message;
  dom.toast.dataset.tone = tone;
  dom.toast.classList.remove("hidden");

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    dom.toast.classList.add("hidden");
  }, duration);
}

function localizeState(status) {
  return STATE_LABELS[status] || status || "待处理";
}

function conciseText(value, fallback, limit = 26) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function readableText(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  const replacementCount = (text.match(/�/g) || []).length;
  const questionRun = /\?{5,}/.test(text);
  const replacementHeavy = replacementCount >= 2 && replacementCount / Math.max(text.length, 1) > 0.08;

  return questionRun || replacementHeavy ? fallback : text;
}

function quoteForPrompt(value, fallback = "这一步") {
  const text = String(value || "").trim();
  return text || fallback;
}

function formatEventTime(value) {
  if (!value) return "刚刚";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function localizeOperationEventType(eventType) {
  switch (String(eventType || "").toLowerCase()) {
    case "proposal_created": return "已创建";
    case "proposal_executed": return "已执行";
    case "proposal_cancelled": return "已取消";
    case "proposal_execution_rejected": return "执行被拒绝";
    default: return "已记录";
  }
}

function describeOperationEvent(event) {
  const payload = event?.payload || {};
  const eventType = String(event?.event_type || "").toLowerCase();

  if (eventType === "proposal_created") {
    return Number.isFinite(payload.operation_count)
      ? `已生成 ${payload.operation_count} 项待确认操作。`
      : "治理草案已经生成，等待确认。";
  }

  if (eventType === "proposal_executed") {
    return Number.isFinite(payload.operation_count)
      ? `已执行 ${payload.operation_count} 项操作。`
      : "这条草案已经执行完成。";
  }

  if (eventType === "proposal_cancelled") {
    return payload.cancellation_reason || "这条草案已被取消，不会进入执行阶段。";
  }

  if (eventType === "proposal_execution_rejected") {
    return payload.reason === "destructive_operation_not_supported"
      ? "这条草案包含当前流程不支持的高风险操作。"
      : "这条草案在执行前被拦下。";
  }

  return "这里保留整理历史，方便回看发生过什么。";
}

function summarizeSectionHealth(sectionKeys = []) {
  const statuses = dashboardData.syncMeta?.sections || {};
  const resolved = sectionKeys
    .map((key) => statuses[key])
    .filter(Boolean);

  if (!resolved.length) {
    return "unknown";
  }

  if (resolved.some((status) => status === "failed")) {
    return "failed";
  }

  if (resolved.some((status) => status === "mock")) {
    return "mock";
  }

  return "api";
}

function buildSourceNote(sectionKeys, apiCopy, mockCopy, failedCopy) {
  if (dashboardLoading) {
    return "正在同步。";
  }

  const health = summarizeSectionHealth(sectionKeys);
  switch (health) {
    case "failed":
      return failedCopy;
    case "mock":
      return mockCopy;
    case "api":
      return apiCopy;
    default:
      return "当前状态还在准备中。";
  }
}

function emotionCopy(emotion) {
  switch (emotion) {
    case "anxious": return "先缩小一步。";
    case "motivated": return "可以继续推进。";
    case "focused": return "适合继续执行。";
    case "distracted": return "先回到一个动作。";
    default: return "可以继续梳理。";
  }
}

function describeContinuity(totalSteps, currentStepIndex) {
  if (!totalSteps) {
    return "这条线索已经被留在这里。";
  }

  const safeIndex = Math.min(Math.max(currentStepIndex, 0), Math.max(totalSteps - 1, 0));
  const remaining = Math.max(totalSteps - safeIndex - 1, 0);

  if (safeIndex === 0) {
    return `刚刚把开头放稳，后面还有 ${remaining} 小步。`;
  }

  if (remaining === 0) {
    return "已经走到收束处，可以慢慢把它说完整。";
  }

  if (remaining === 1) {
    return "这条线已经走到后段，再往前一点就能接上。";
  }

  return `这条线已经走到中段，后面还留着 ${remaining} 小步。`;
}

function buildTimelineEntries(memories = []) {
  return [...memories]
    .filter((memory) => memory && (memory.user_input || memory.echo_response))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .flatMap((memory) => {
      const items = [];
      if (memory.user_input) {
        items.push({
          actor: "你",
          text: memory.user_input,
          timestamp: memory.timestamp,
          active: true
        });
      }
      if (memory.echo_response) {
        items.push({
          actor: PRODUCT_NAME,
          text: memory.echo_response,
          timestamp: memory.timestamp,
          active: false
        });
      }
      return items;
    });
}

function getLatestEchoText() {
  const latest = [...timelineEntries].reverse().find((entry) => entry.actor === PRODUCT_NAME && entry.text);
  if (latest?.text) return latest.text;
  return currentState?.next_action?.detail || "";
}

function formatClock() {
  const now = new Date();
  dom.clock.textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);
  dom.dateLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function updateDensityMode() {
  const compact = window.innerWidth <= 1560 || window.innerHeight <= 960 || (window.devicePixelRatio || 1) > 1.25;
  dom.body.dataset.density = compact ? "compact" : "regular";
}

function hideLaunchScreen() {
  window.setTimeout(() => dom.launchScreen?.classList.add("hidden"), 850);
}

function setActiveView(nextView) {
  const hasTargetView = dom.workspaceViews.some((view) => view.dataset.viewPanel === nextView);
  activeView = hasTargetView ? nextView : "now";
  const meta = MINIMAL_VIEW_META[activeView] || MINIMAL_VIEW_META.now;

  dom.navItems.forEach((item) => {
    const isActive = item.dataset.view === activeView;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  dom.workspaceViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.viewPanel === activeView);
  });

  dom.mainWindow.dataset.activeView = activeView;
  dom.toolbarLabel.textContent = `Margin / ${meta.title}`;
  dom.viewTitle.textContent = meta.title;
  dom.viewSubtitle.textContent = meta.subtitle;
  dom.activeViewChip.textContent = meta.title;
  dom.secondaryViewChip.textContent = dashboardLoading ? "同步中" : meta.chip;
}

function setDashboardLoading(nextLoading) {
  dashboardLoading = nextLoading;
  dom.body.dataset.dashboardLoading = String(nextLoading);
  dom.dataChip.textContent = nextLoading
    ? "同步中"
    : dashboardData.viewModelMode === "mock"
      ? "Mock 视图"
      : "API 视图";
  dom.presenceLabel.textContent = nextLoading ? "正在整理页边" : "页边会话";
  setActiveView(activeView);
}

function setSubmitting(nextSubmitting) {
  isSubmitting = nextSubmitting;
  dom.composerSubmit.disabled = nextSubmitting;
  dom.composerInput.disabled = nextSubmitting;
  dom.composerSubmitLabel.textContent = nextSubmitting ? "发送中" : "发送";
}

function setManualActionSubmitting(nextSubmitting) {
  manualActionSubmitting = nextSubmitting;
  dom.manualActionTitle.disabled = nextSubmitting;
  dom.manualActionDetail.disabled = nextSubmitting;
  dom.manualActionSubmit.disabled = nextSubmitting;
  dom.manualActionSubmit.textContent = nextSubmitting ? "添加中..." : "添加任务";
}

function setSuggestedActionSubmitting(nextSubmitting) {
  suggestedActionSubmitting = nextSubmitting;
  dom.suggestedActionQuery.disabled = nextSubmitting;
  dom.suggestedActionSubmit.disabled = nextSubmitting;
  dom.suggestedActionSubmit.textContent = nextSubmitting ? "生成中..." : "生成建议任务";
}

function setTtsUiState(nextState) {
  ttsUiState = nextState;
  updateTtsAvailability();
}

function updateTtsAvailability() {
  const latestText = getLatestEchoText();
  const hasText = Boolean(latestText);
  const isBusy = ttsUiState === "loading" || ttsUiState === "playing";

  if (!apiCapabilities.tts) {
    ttsUiState = "unavailable";
  } else if (ttsUiState === "unavailable") {
    ttsUiState = "idle";
  } else if (latestText !== lastTtsText && !isBusy) {
    ttsUiState = "idle";
  }

  lastTtsText = latestText;
  dom.playLatestEchoButton.classList.toggle("hidden", !apiCapabilities.tts);
  dom.playLatestEchoButton.disabled = !apiCapabilities.tts || !hasText || isBusy;
  dom.playLatestEchoButton.dataset.ttsState = ttsUiState;
  dom.playLatestEchoButton.setAttribute("aria-busy", isBusy ? "true" : "false");
  dom.playLatestEchoButton.textContent = hasText
    ? TTS_UI_COPY[ttsUiState] || TTS_UI_COPY.idle
    : TTS_UI_COPY.idleEmpty;
}

function getTtsErrorMessage(error) {
  return TTS_ERROR_COPY[error?.code] || getErrorMessage(error, "轻读失败，请稍后再试。");
}

function releaseActiveTtsAudio() {
  if (activeTtsAudioCleanup) {
    activeTtsAudioCleanup();
  }
  activeTtsAudioCleanup = null;
  activeTtsAudio = null;
}

function stopActiveTtsAudio({ resetState = true } = {}) {
  activeTtsPlaybackToken += 1;
  const audio = activeTtsAudio;
  releaseActiveTtsAudio();

  if (audio && !audio.paused) {
    audio.pause();
  }

  if (resetState && ttsUiState === "playing") {
    setTtsUiState("idle");
  }
}

function attachTtsAudio(audio, token) {
  const isCurrent = () => token === activeTtsPlaybackToken && activeTtsAudio === audio;
  const finishPlayback = () => {
    if (!isCurrent()) return;
    releaseActiveTtsAudio();
    setTtsUiState("idle");
  };
  const failPlayback = () => {
    if (!isCurrent()) return;
    releaseActiveTtsAudio();
    setTtsUiState("error");
    showToast("轻读被中断了，可以再试一次。", "error", 3200);
  };
  const pausePlayback = () => {
    if (!isCurrent() || audio.ended) return;
    finishPlayback();
  };

  audio.addEventListener("ended", finishPlayback);
  audio.addEventListener("pause", pausePlayback);
  audio.addEventListener("error", failPlayback);
  activeTtsAudio = audio;
  activeTtsAudioCleanup = () => {
    audio.removeEventListener("ended", finishPlayback);
    audio.removeEventListener("pause", pausePlayback);
    audio.removeEventListener("error", failPlayback);
  };
}

function buildPromptFromContext(kind, payload = {}) {
  switch (kind) {
    case "next-action":
      return `我想继续推进“${quoteForPrompt(payload.label, "当前动作")}”，你帮我把这一步说清楚。`;
    case "learning-step":
      return `围绕“${quoteForPrompt(payload.title, "当前学习步骤")}”这一步继续，帮我先确认现在最适合怎么做。`;
    case "reflection":
      return `结合刚才这条反思：“${quoteForPrompt(payload.summary, "最近的变化")}”，帮我提炼一个接下来可执行的小动作。`;
    case "memory":
      return `把这条记忆带回当前对话：“${quoteForPrompt(payload.note, "这条记忆")}”，帮我看看它对现在这一步有什么提醒。`;
    case "focus":
      return `我想继续围绕“${quoteForPrompt(payload.focus, "当前重点")}”推进，先帮我缩成一个更容易开始的小动作。`;
    default:
      return payload.text || "";
  }
}

function fillComposerFromContext(kind, payload) {
  const prompt = buildPromptFromContext(kind, payload);
  if (!prompt) return;
  setActiveView("now");
  fillComposer(prompt);
}

function renderQuickPrompts(state) {
  const emotion = state?.current_state?.emotion || "neutral";
  const nextActionLabel = state?.next_action?.label;
  const focus = state?.current_state?.focus;
  const currentStepTitle =
    state?.current_learning?.current_step?.title
    || state?.active_learning?.[0]?.current_step?.title
    || state?.active_learning?.[0]?.steps?.[state?.active_learning?.[0]?.current_step]?.title;

  const prompts = [
    nextActionLabel
      ? {
        label: "继续下一步",
        prompt: buildPromptFromContext("next-action", { label: nextActionLabel })
      }
      : {
        label: "继续这一行",
        prompt: "沿着刚才的线索继续，帮我先理清最值得推进的一步。"
      },
    currentStepTitle
      ? {
        label: "回到学习这步",
        prompt: buildPromptFromContext("learning-step", { title: currentStepTitle })
      }
      : emotion === "anxious" || emotion === "distracted"
        ? {
          label: "帮我缩小一步",
          prompt: "我有点卡住了，帮我把下一步再缩小一点。"
        }
        : {
          label: "我完成一步了",
          prompt: "我完成了上一步，帮我判断下一步该做什么。"
        },
    focus
      ? {
        label: "围绕当前重点",
        prompt: buildPromptFromContext("focus", { focus })
      }
      : {
        label: "继续这一行",
        prompt: "沿着刚才的线索继续。"
      }
  ];

  dom.quickPromptButtons.forEach((button, index) => {
    const config = prompts[index];
    if (!config) return;
    button.textContent = config.label;
    button.dataset.prompt = config.prompt;
  });
}

function ensureReflectionHistory() {
  let node = document.querySelector("#reflection-history");
  if (node) return node;

  const host = document.querySelector("#reflection-theme-title")?.closest(".content-card");
  if (!host) return null;

  node = document.createElement("div");
  node.id = "reflection-history";
  node.className = "reflection-stack";
  host.appendChild(node);
  return node;
}

function ensureMemoryProfileSummary() {
  let node = document.querySelector("#memory-profile-summary");
  if (node) return node;

  const host = document.querySelector("#memory-tags")?.parentElement;
  if (!host) return null;

  const card = document.createElement("article");
  card.className = "reflection-card";
  card.innerHTML = `
    <span class="mono">Profile</span>
    <p id="memory-profile-summary"></p>
  `;
  host.insertBefore(card, document.querySelector("#memory-tags"));
  return card.querySelector("#memory-profile-summary");
}

function renderTimeline() {
  const entries = [...timelineEntries];

  if (pendingUserMessage) {
    entries.push({
      actor: "你",
      text: pendingUserMessage,
      timestamp: new Date().toISOString(),
      active: true
    });
    entries.push({
      actor: PRODUCT_NAME,
      typing: true,
      timestamp: new Date().toISOString(),
      active: false
    });
  }

  if (!entries.length) {
    dom.timelinePanel.innerHTML = `<div class="empty-state">这一页还没有留下字迹，先把现在的你放在这里。</div>`;
    updateTtsAvailability();
    return;
  }

  dom.timelinePanel.innerHTML = entries.map((entry) => {
    const timeText = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(entry.timestamp));
    const roleClass = entry.typing
      ? "typing"
      : entry.actor === "你"
        ? "user"
        : "echo";
    const body = entry.typing
      ? `<p class="typing-line" aria-label="输入中"><em>${PRODUCT_NAME} 正在整理这一句...</em></p>`
      : `<p>${escapeHtml(entry.text)}</p>`;

    return `
      <article class="timeline-row ${roleClass}${entry.active ? " active" : ""}${entry.tone === "error" ? " error" : ""}">
        <time class="mono">${escapeHtml(timeText)}</time>
        <div class="timeline-copy">
          <h3>${escapeHtml(entry.actor)}</h3>
          ${body}
        </div>
      </article>
    `;
  }).join("");

  dom.timelinePanel.scrollTop = dom.timelinePanel.scrollHeight;
  updateTtsAvailability();
}

function renderBadges(state) {
  const tags = (state?.recent_memories?.[0]?.tags || []).slice(0, 1);
  dom.boardBadges.innerHTML = tags.length
    ? tags.map((tag) => `<span class="status-badge">${escapeHtml(tag)}</span>`).join("")
    : "";
}

function renderNowView(state) {
  const emotion = state?.current_state?.emotion || "neutral";
  const preset = EMOTION_PRESETS[emotion] || EMOTION_PRESETS.neutral;
  const focus = state?.current_state?.focus || "等待专注主题";
  const note = conciseText(state?.current_state?.context_note, "正在整理当前线索。");
  const session = state?.current_learning || state?.active_learning?.[0] || null;
  const totalSteps = session?.total_steps ?? session?.steps?.length ?? 0;
  const currentStepIndex = session?.current_step_index ?? (Number.isFinite(session?.current_step) ? session.current_step : 0);
  const nextActionLabel = state?.next_action?.label || "等待下一步";
  const nextActionDetail = conciseText(state?.next_action?.detail, "先把下一步说清楚。");
  const continuityText = describeContinuity(totalSteps, currentStepIndex);
  const focusNote = totalSteps
    ? `围绕这条线，先照看眼前这一小步。`
    : "这条线索已经被轻轻留在旁边。";
  const learningNote = totalSteps
    ? `学习线还在往前，不需要一次把全部完成。`
    : "还没有需要立刻推进的学习步骤。";

  document.querySelector("#hero-emotion").textContent = preset.hero;
  document.querySelector("#hero-copy").textContent = note;
  document.querySelector("#hero-focus-topic").textContent = focus;
  document.querySelector("#hero-focus-context").textContent = continuityText;
  document.querySelector("#hero-next-action").textContent = nextActionLabel;
  document.querySelector("#hero-next-copy").textContent = nextActionDetail;
  document.querySelector("#hero-next-context").textContent = "你准备好时，再从这一行接着写下去。";

  document.querySelector("#emotion-label").textContent = preset.label;
  document.querySelector("#emotion-copy").textContent = emotionCopy(emotion);
  document.querySelector("#emotion-note").textContent = note;
  document.querySelector("#focus-title").textContent = focus;
  document.querySelector("#focus-note").textContent = focusNote;
  document.querySelector("#action-title").textContent = nextActionLabel;
  document.querySelector("#action-copy").textContent = nextActionDetail;
  document.querySelector("#learning-topic").textContent = session?.topic || "等待学习主题";
  document.querySelector("#learning-step-copy").textContent =
    session?.current_step?.title
    || session?.steps?.[currentStepIndex]?.title
    || "等待学习步骤。";
  document.querySelector("#learning-note").textContent = learningNote;
  document.querySelector("#reflection-side-trend").textContent =
    state?.current_reflection?.latest_summary?.emotional_trend
    || dashboardData.summaries[0]?.emotional_trend
    || "等待";
  document.querySelector("#reflection-side-copy").textContent = conciseText(
    state?.current_reflection?.summary || dashboardData.summaries[0]?.summary,
    "等待趋势摘要。"
  );
  renderNowContextStrip();
}

function getAwaitingProposals() {
  return (dashboardData.proposals || []).filter((proposal) => {
    const status = proposalSimulationStatus[proposal.id] || proposal.status;
    return status === "awaiting_confirmation" || status === "draft";
  });
}

function renderNowContextStrip() {
  const container = document.querySelector("#now-context-strip");
  if (!container) return;

  const recent = dashboardData.recentAchievements?.slice(0, 1) || [];
  const proposals = getAwaitingProposals().slice(0, 1);
  const items = [];

  if (recent.length) {
    items.push(...recent.map((item) => `
      <article class="context-strip-card achievement-context-card">
        <span class="achievement-glyph" style="--achievement-color: ${escapeHtml(item.accent_color || "#6f74b8")}">${escapeHtml((item.title || "?").slice(0, 1))}</span>
        <div>
          <span class="arrival-label">最近解锁</span>
          <strong>${escapeHtml(item.title || "新成就")}</strong>
          <p>${escapeHtml(conciseText(item.description, "刚刚亮起来的记录。", 30))}</p>
        </div>
      </article>
    `));
  }

  if (proposals.length) {
    items.push(...proposals.map((proposal) => `
      <article class="context-strip-card proposal-context-card">
        <div>
          <span class="arrival-label">待确认整理</span>
          <strong>${escapeHtml(proposal.summary || "等待确认的整理草案")}</strong>
          <p>${escapeHtml(RISK_LABELS[proposal.risk_level] || "需要确认后再执行。")}</p>
        </div>
        <button class="mini-action" type="button" data-jump-view="management" data-management-target="${escapeHtml(proposal.scope || "proposals")}">查看</button>
      </article>
    `));
  }

  container.innerHTML = items.length
    ? items.join("")
    : `<article class="context-strip-card quiet"><span class="arrival-label">近期提醒</span><strong>暂时没有需要额外处理的信号</strong><p>可以继续把注意力放回当前对话。</p></article>`;
}

function renderLearnView(state) {
  const sourceNote = document.querySelector("#learn-source-note");
  const learningView = dashboardData.currentLearning || state?.current_learning || null;
  const session = dashboardData.learningSessions[0] || state?.active_learning?.[0] || null;
  const events = dashboardData.learningEvents;
  const total = learningView?.total_steps ?? session?.steps?.length ?? 0;
  const currentStep = learningView?.current_step_index ?? (Number.isFinite(session?.current_step) ? session.current_step : 0);
  const stepLabels = learningView?.step_labels || session?.steps || [];

  document.querySelector("#learn-topic").textContent = learningView?.topic || session?.topic || "等待学习主题";
  document.querySelector("#learn-summary").textContent = conciseText(
    learningView?.summary || dashboardData.profileSummary,
    "只看当前主线。"
  );
  if (sourceNote) {
    sourceNote.textContent = buildSourceNote(
      ["learning", "learningEvents", "achievements", "recentAchievements"],
      "当前直接消费后端学习与成就摘要，不在前端推导学习线状态。",
      "当前混合了 mock fallback，用来保证学习页结构和邻近成就摘要持续可验收。",
      "学习相关接口当前没有完整返回，页面正在用最小状态和空态保持可读。"
    );
  }
  document.querySelector("#learn-progress-chip").textContent = total ? `${Math.min(currentStep + 1, total)} / ${total}` : "0 / 0";
  document.querySelector("#learn-pattern-chip").textContent = String(state?.current_state?.pattern || "waiting_pattern").replaceAll("_", " ");
  document.querySelector("#learn-current-step-title").textContent =
    learningView?.current_step?.title
    || session?.steps?.[currentStep]?.title
    || "等待当前步骤";
  document.querySelector("#learn-current-step-copy").textContent =
    conciseText(
      learningView?.current_step?.action
      || events.find((event) => event.step_index === currentStep)?.note
      || learningView?.next_step?.action,
      "先完成这一步。",
      30
    );

  const currentActions = document.querySelector("#learn-current-actions");
  if (session?.id !== undefined && total) {
    currentActions.innerHTML = `
      <button class="mini-action" type="button" data-learning-session="${session.id}" data-learning-step="${currentStep}" data-learning-status="active">进行中</button>
      <button class="mini-action" type="button" data-learning-session="${session.id}" data-learning-step="${currentStep}" data-learning-status="done">完成</button>
          <button class="mini-action" type="button" data-compose-kind="learning-step" data-compose-text="${escapeHtml(stepLabels[currentStep]?.title || learningView?.current_step?.title || "")}">接着写</button>
    `;
  } else {
    currentActions.innerHTML = "";
  }

  const stepsList = document.querySelector("#learn-steps-list");
  if (!stepLabels.length) {
    stepsList.innerHTML = `<div class="empty-state">这一页还没有明确的学习线。</div>`;
    renderLearnAchievementSummary(session, learningView);
    return;
  }

  stepsList.innerHTML = stepLabels.map((step, index) => {
    const status = step.status || (index < currentStep ? "done" : index === currentStep ? "active" : "pending");
    const event = events.find((item) => item.step_index === index);
    const isBusy = learningMutationKey === `${session.id}:${index}`;

    return `
      <article class="step-row${index === currentStep ? " current" : ""}${status === "done" ? " done" : ""}">
        <strong>${escapeHtml(step.title)}</strong>
        <p>${escapeHtml(conciseText(event?.note || (index === currentStep ? "这是当前一步。" : "后续步骤。"), index === currentStep ? "这是当前一步。" : "后续步骤。", 24))}</p>
        <div class="inline-actions">
          <button class="mini-action${status === "active" ? " selected" : ""}" type="button" data-learning-session="${session.id}" data-learning-step="${index}" data-learning-status="active"${isBusy ? " disabled" : ""}>进行中</button>
          <button class="mini-action${status === "done" ? " selected" : ""}" type="button" data-learning-session="${session.id}" data-learning-step="${index}" data-learning-status="done"${isBusy ? " disabled" : ""}>完成</button>
          <button class="mini-action" type="button" data-compose-kind="learning-step" data-compose-text="${escapeHtml(step.title || "")}">接着写</button>
        </div>
      </article>
    `;
  }).join("");
  renderLearnAchievementSummary(session, learningView);
}

function renderLearnAchievementSummary(session, learningView) {
  const container = document.querySelector("#learn-achievement-summary");
  if (!container) return;

  const achievements = dashboardData.achievements?.achievements || MOCK_ACHIEVEMENTS.achievements || [];
  const learningAchievements = achievements
    .filter((achievement) => achievement.source_type === "learning_session")
    .slice(0, 4);
  const unlockedCount = learningAchievements.filter((achievement) => achievement.unlocked).length;
  const topic = learningView?.topic || session?.topic || "当前学习线";

  container.innerHTML = learningAchievements.length
    ? `
      <div class="module-summary-line">
        <strong>${escapeHtml(topic)}</strong>
        <span class="status-badge">${unlockedCount} / ${learningAchievements.length} 已亮起</span>
      </div>
      ${learningAchievements.map((achievement) => `
        <article class="compact-signal-row${achievement.unlocked ? "" : " muted"}">
          <span class="achievement-glyph" style="--achievement-color: ${escapeHtml(achievement.accent_color || "#6f74b8")}">${escapeHtml((achievement.hidden && !achievement.unlocked ? "隐" : achievement.title || "?").slice(0, 1))}</span>
          <div>
            <strong>${escapeHtml(achievement.hidden && !achievement.unlocked ? "隐藏成就" : achievement.title)}</strong>
            <p>${escapeHtml(achievement.unlocked ? achievement.description : achievement.locked_description || "继续推进后出现。")}</p>
          </div>
        </article>
      `).join("")}
      <button class="mini-action" type="button" data-jump-view="achievements" data-achievement-source-target="learning">查看成就墙</button>
    `
    : `<div class="empty-state">这条学习线还没有留下新的记录。</div>`;
}

function resolveActionDetail(action) {
  return action?.detail || action?.metadata?.reason || action?.completion_hint || "";
}

function pickPrimaryAction(actions, currentAction, nextAction) {
  if (currentAction?.id) {
    const matched = actions.find((action) => action.id === currentAction.id);
    if (matched) return matched;
  }

  const activeAction = actions.find((action) => action.status === "active");
  if (activeAction) return activeAction;

  if (actions[0]) return actions[0];

  if (currentAction) {
    return {
      id: null,
      title: currentAction.title || nextAction?.label || "等待主任务",
      detail: resolveActionDetail(currentAction) || nextAction?.detail || "当前还没有可执行的任务。",
      status: currentAction.status || "suggested"
    };
  }

  if (nextAction?.label) {
    return {
      id: null,
      title: nextAction.label,
      detail: nextAction.detail || "先从这一小步开始。",
      status: "suggested"
    };
  }

  return null;
}

function renderPrimaryActionCard(primaryAction, currentAction, nextAction) {
  if (!primaryAction) {
    return `<div class="empty-state">这一页还没有明确的下一行，先通过对话或建议入口把它写出来。</div>`;
  }

  const title = primaryAction.title || currentAction?.title || nextAction?.label || "等待主任务";
  const detail = resolveActionDetail(primaryAction)
    || resolveActionDetail(currentAction)
    || currentAction?.current_step?.action
    || nextAction?.detail
    || "把这一小步说清楚，我们就能继续推进。";
  const status = primaryAction.status || currentAction?.status || "suggested";
  const canMutate = Number.isFinite(primaryAction.id);
  const isBusy = canMutate && actionMutationId === primaryAction.id;

  return `
    <article class="reflection-card">
      <div class="board-header compact">
        <div>
          <p class="panel-kicker">当前主任务</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <span class="status-badge">${escapeHtml(localizeState(status))}</span>
      </div>
      <p>${escapeHtml(detail)}</p>
      <div class="inline-actions">
        ${canMutate
          ? `<button class="mini-action${status === "active" ? " selected" : ""}" type="button" data-action-id="${primaryAction.id}" data-action-status="active"${isBusy ? " disabled" : ""}>开始推进</button>
             <button class="mini-action${status === "done" ? " selected" : ""}" type="button" data-action-id="${primaryAction.id}" data-action-status="done"${isBusy ? " disabled" : ""}>完成主任务</button>
             <button class="mini-action" type="button" data-action-id="${primaryAction.id}" data-action-status="dismissed"${isBusy ? " disabled" : ""}>移除主任务</button>
             <button class="mini-action" type="button" data-compose-kind="next-action" data-compose-text="${escapeHtml(title)}">接着写</button>`
          : `<button class="mini-action" type="button" data-compose-next="true">从这里继续</button>`}
      </div>
    </article>
  `;
}

function renderActionsView(state) {
  const sourceNote = document.querySelector("#actions-source-note");
  const sourceActions = dashboardData.actions.length ? dashboardData.actions : state?.action_queue || [];
  const actions = sourceActions.filter((action) => action?.status !== "dismissed");
  const currentAction = state?.current_action || null;
  const primaryAction = pickPrimaryAction(actions, currentAction, state?.next_action);
  const queueActions = primaryAction?.id ? actions.filter((action) => action.id !== primaryAction.id) : actions;
  const nextAction = primaryAction?.title || currentAction?.title || state?.next_action?.label || "等待任务队列";
  const activeCount = actions.filter((action) => action.status === "active").length;
  const pendingCount = actions.filter((action) => action.status === "pending").length;

  document.querySelector("#actions-headline").textContent = nextAction;
  document.querySelector("#actions-summary").textContent = conciseText(
    resolveActionDetail(currentAction)
    || currentAction?.current_step?.action
    || resolveActionDetail(primaryAction)
    || state?.next_action?.detail,
    "只推进当前主任务。",
    34
  );
  if (sourceNote) {
    sourceNote.textContent = buildSourceNote(
      ["actions", "managementActions", "proposals"],
      "当前直接消费后端任务队列与整理信号，前端只负责展示和状态切换。",
      "当前混合了 mock fallback，用来保证任务队列、整理提示和空态在接口波动时仍然稳定。",
      "任务相关接口当前没有完整返回，页面保留了主任务与队列空态，避免把这里变成坏掉的控制台。"
    );
  }
  document.querySelector("#actions-open-chip").textContent = `${pendingCount} 个待处理`;
  document.querySelector("#actions-active-chip").textContent = `${activeCount} 个进行中`;

  const currentTask = document.querySelector("#actions-current-task");
  currentTask.innerHTML = renderPrimaryActionCard(primaryAction, currentAction, state?.next_action);
  renderActionGovernanceHints();

  const actionList = document.querySelector("#action-list");
  if (!queueActions.length) {
    actionList.innerHTML = `<div class="empty-state">这一页还没有排开的下一行。</div>`;
    return;
  }

  actionList.innerHTML = queueActions.map((action) => {
    const isBusy = actionMutationId === action.id;
    return `
      <article class="action-row">
        <div class="board-header compact">
          <strong>${escapeHtml(action.title)}</strong>
          <span class="status-badge">${escapeHtml(localizeState(action.status))}</span>
        </div>
        <p>${escapeHtml(conciseText(action.detail || action.metadata?.reason, "等待处理。", 28))}</p>
        <div class="inline-actions">
          <button class="mini-action${action.status === "active" ? " selected" : ""}" type="button" data-action-id="${action.id}" data-action-status="active"${isBusy ? " disabled" : ""}>进行中</button>
          <button class="mini-action${action.status === "done" ? " selected" : ""}" type="button" data-action-id="${action.id}" data-action-status="done"${isBusy ? " disabled" : ""}>完成</button>
          <button class="mini-action" type="button" data-action-id="${action.id}" data-action-status="dismissed"${isBusy ? " disabled" : ""}>移除</button>
          <button class="mini-action" type="button" data-compose-kind="next-action" data-compose-text="${escapeHtml(action.title || "")}">接着写</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderActionGovernanceHints() {
  const container = document.querySelector("#actions-governance-hints");
  if (!container) return;

  const overview = getManagementOverview("actions");
  const candidates = (overview?.candidates || []).slice(0, 2);
  const proposals = (dashboardData.proposals || []).filter((proposal) => proposal.scope === "actions").slice(0, 1);

  if (!candidates.length && !proposals.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <article class="governance-hint-card">
      <div>
        <span class="arrival-label">队列整理提示</span>
        <strong>${escapeHtml(overview?.summary || "有一些任务队列信号可以回看。")}</strong>
        <p>${escapeHtml(candidates[0]?.reason || proposals[0]?.summary || "这里仅展示后端给出的整理候选，不在前端判断任务是否重复。")}</p>
      </div>
      <button class="mini-action" type="button" data-jump-view="management" data-management-target="actions">去整理</button>
    </article>
  `;
}

function renderMemoryView() {
  const sourceNote = document.querySelector("#memory-source-note");
  const memoryView = dashboardData.currentMemory || currentState?.current_memory || null;
  const memories = dashboardData.memories.length ? dashboardData.memories : currentState.recent_memories || [];
  const overview = memoryView?.overview || null;
  const tags = memoryView?.tag_heatmap || Array.from(new Set(memories.flatMap((memory) => memory.tags || [])))
    .slice(0, 6)
    .map((tag) => ({ tag, count: 1 }));

  document.querySelector("#memory-headline").textContent = memories.length ? "关键记忆与召回" : "等待记忆数据";
  document.querySelector("#memory-summary").textContent = conciseText(
    memoryView?.summary || dashboardData.profileSummary,
    "只保留关键记忆。",
    34
  );
  if (sourceNote) {
    sourceNote.textContent = buildSourceNote(
      ["memory", "profile", "summaries", "managementMemory"],
      "当前直接消费后端记忆、画像摘要与轻量回看信号，不在前端实现记忆治理规则。",
      "当前混合了 mock fallback，用来保证记忆标签、片段、整理入口和反思回看能继续验收。",
      "记忆相关接口当前没有完整返回，页面先保留标签、片段和回看空态，避免误导用户这里已有完整检索能力。"
    );
  }
  document.querySelector("#memory-total-chip").textContent = `${overview?.total_memories ?? memories.length} 条记忆`;
  document.querySelector("#memory-tags-chip").textContent = `${tags.length} 个标签`;

  const profileSummary = ensureMemoryProfileSummary();
  if (profileSummary) {
    profileSummary.textContent = conciseText(
      dashboardData.profileSummary || currentState?.profile?.summary?.profile_note || memoryView?.summary,
      "等待画像摘要。",
      34
    );
  }

  const tagsContainer = document.querySelector("#memory-tags");
  tagsContainer.innerHTML = tags.length
    ? tags.map((item) => `<span class="status-badge">${escapeHtml(item.tag || item)}</span>`).join("")
    : `<div class="empty-state">这里还没有清楚浮出来的标签。</div>`;

  const clusterGrid = document.querySelector("#memory-clusters");
  const clusters = [
    { label: "近期记忆", value: overview?.total_memories ?? memories.length },
    { label: "已置顶", value: overview?.pinned_count ?? memories.filter((memory) => memory.pinned).length },
    { label: "核心优先级", value: overview?.core_count ?? memories.filter((memory) => memory.priority_bucket === "core").length },
    { label: "重要层", value: overview?.important_count ?? 0 }
  ];
  clusterGrid.innerHTML = clusters
    .map((cluster) => `<article class="cluster-card"><strong>${escapeHtml(cluster.label)}</strong><span class="mono">${String(cluster.value).padStart(2, "0")}</span></article>`)
    .join("");

  const memoryList = document.querySelector("#memory-list");
  memoryList.innerHTML = memories.length
    ? memories.slice(0, 5).map((memory) => {
      const isBusy = memoryMutationId === memory.id;
      return `
        <article class="memory-row">
          <strong>${escapeHtml(conciseText(memory.memory_note || memory.user_input || memory.echo_response, "等待记忆片段。", 28))}</strong>
          <p>${escapeHtml(conciseText(memory.insight_note || memory.memory_note || memory.echo_response, "等待说明。", 30))}</p>
          <div class="inline-actions">
            <button class="mini-action" type="button" data-memory-id="${memory.id}" data-memory-mode="pin"${isBusy ? " disabled" : ""}>置顶</button>
            <button class="mini-action" type="button" data-memory-id="${memory.id}" data-memory-mode="boost"${isBusy ? " disabled" : ""}>提升优先级</button>
            <button class="mini-action" type="button" data-compose-kind="memory" data-compose-text="${escapeHtml(memory.memory_note || memory.user_input || memory.echo_response || "")}">接着写</button>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="empty-state">这里还没有值得带回来的旧痕迹。</div>`;

  const reflectionList = document.querySelector("#memory-reflection-list");
  if (reflectionList) {
    const reflections = dashboardData.summaries || [];
    reflectionList.innerHTML = reflections.length
      ? reflections.slice(0, 3).map((item) => `
        <article class="reflection-card">
          <span class="mono">${escapeHtml(item.date || "recent")}</span>
          <p>${escapeHtml(conciseText(item.summary || item.echo_reflection, "等待摘要。", 34))}</p>
          <div class="inline-actions">
            <button class="mini-action" type="button" data-compose-kind="reflection" data-compose-text="${escapeHtml(item.summary || item.echo_reflection || "")}">接着写</button>
          </div>
        </article>
      `).join("")
      : `<div class="empty-state">最近还没有留下可回看的页边笔记。</div>`;
  }
  renderMemoryManagementEntry();
}

function renderMemoryManagementEntry() {
  const container = document.querySelector("#memory-management-entry");
  if (!container) return;

  const overview = getManagementOverview("memory");
  const awaiting = getAwaitingProposals().filter((proposal) => proposal.scope === "memory");
  const candidateCount = overview?.candidates?.length || 0;

  container.innerHTML = `
    <article class="management-entry-card">
      <div>
        <span class="arrival-label">记忆整理</span>
        <strong>${escapeHtml(candidateCount ? `${candidateCount} 条整理信号` : "整理入口已准备好")}</strong>
        <p>${escapeHtml(overview?.summary || "只查看后端给出的整理建议，不直接删除或合并记忆。")}</p>
      </div>
      <div class="inline-actions">
        ${awaiting.length ? `<span class="status-badge">${awaiting.length} 个草案待确认</span>` : ""}
        <button class="mini-action" type="button" data-jump-view="management" data-management-target="memory">去整理</button>
      </div>
    </article>
  `;
}

function getManagementOverview(scope = activeManagementScope) {
  return dashboardData.managementOverviews?.[scope] || MOCK_MANAGEMENT_OVERVIEWS[scope] || null;
}

function getManagementEvents() {
  const events = dashboardData.operationEvents?.length ? dashboardData.operationEvents : MOCK_OPERATION_EVENTS;

  if (activeManagementScope === "proposals") {
    return events;
  }

  return events.filter((event) => event.scope === activeManagementScope);
}

function renderManagementView() {
  const scope = activeManagementScope === "proposals" ? "memory" : activeManagementScope;
  const overview = getManagementOverview(scope);
  const headline = document.querySelector("#management-headline");
  const summary = document.querySelector("#management-summary");
  const sourceNote = document.querySelector("#management-source-note");
  const riskChip = document.querySelector("#management-risk-chip");
  const statsContainer = document.querySelector("#management-stats");
  const candidatesContainer = document.querySelector("#management-candidates");
  const proposalList = document.querySelector("#proposal-list");
  const eventsContainer = document.querySelector("#management-events");
  const scopeButtons = Array.from(document.querySelectorAll("[data-management-scope]"));
  if (!headline || !summary || !sourceNote || !riskChip || !statsContainer || !candidatesContainer || !proposalList || !eventsContainer) return;

  scopeButtons.forEach((button) => {
    const selected = button.dataset.managementScope === activeManagementScope;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });

  headline.textContent = activeManagementScope === "proposals"
    ? "全部待确认草案"
    : `${MANAGEMENT_SCOPE_LABELS[scope]}整理信号`;
  summary.textContent = activeManagementScope === "proposals"
    ? "这里仅展示后端或 mock 已经生成的草案，确认按钮当前只做前端模拟状态。"
    : overview?.summary || "等待整理摘要。";
  sourceNote.textContent = dashboardLoading
    ? "整理视图正在同步。"
    : buildSourceNote(
      ["managementLearning", "managementMemory", "managementActions", "proposals", "operationEvents"],
      "当前直接消费后端 view model，前端不判断治理规则。",
      "当前包含 mock fallback，用来保证整理页在接口暂时不可用时仍能检查结构、风险和确认流。",
      "整理相关接口当前没有完整返回，页面先保留只读摘要与草案空态，避免前端替后端做判断。"
    );
  riskChip.textContent = RISK_LABELS[overview?.risk_level] || "只读";
  riskChip.dataset.risk = overview?.risk_level || "read_only";

  const stats = Object.entries(overview?.stats || {});
  statsContainer.innerHTML = stats.length
    ? stats.map(([key, value]) => `
      <article class="metric-card">
        <span class="metric-key">${escapeHtml(key.replaceAll("_", " "))}</span>
        <strong>${escapeHtml(value)}</strong>
      </article>
    `).join("")
    : `<div class="empty-state">当前 scope 还没有统计数据。</div>`;

  const candidates = activeManagementScope === "proposals" ? [] : overview?.candidates || [];
  const recommendations = activeManagementScope === "proposals" ? [] : overview?.recommendations || [];
  candidatesContainer.innerHTML = candidates.length || recommendations.length
    ? `
      ${candidates.map((candidate) => {
        const title = readableText(candidate.title || candidate.id, "存在一条编码异常的整理候选");
        const description = readableText(candidate.description, candidate.reason || "等待说明。");

        return `
          <article class="management-candidate">
            <div class="board-header compact">
              <strong>${escapeHtml(title)}</strong>
              <span class="status-badge">${escapeHtml(RISK_LABELS[candidate.risk_level] || candidate.risk_level || "只读")}</span>
            </div>
            <p>${escapeHtml(description)}</p>
            <p class="detail-note">${escapeHtml(candidate.reason || "")}</p>
          </article>
        `;
      }).join("")}
      ${recommendations.length ? `<div class="recommendation-strip">${recommendations.map((item) => `
        <span class="status-badge">${escapeHtml(item.label || item.operation_type)}</span>
      `).join("")}</div>` : ""}
    `
    : `<div class="empty-state">当前没有需要前端展示的候选项。</div>`;

  const proposals = (dashboardData.proposals || []).filter((proposal) => (
    activeManagementScope === "proposals" || proposal.scope === activeManagementScope
  ));
  proposalList.innerHTML = proposals.length
    ? proposals.map((proposal) => renderProposalCard(proposal)).join("")
    : `<div class="empty-state">当前没有这个范围内的草案。</div>`;

  const events = getManagementEvents().slice(0, 6);
  eventsContainer.innerHTML = events.length
    ? events.map((event) => `
      <article class="operation-event-row">
        <div class="board-header compact">
          <div>
            <strong>${escapeHtml(localizeOperationEventType(event.event_type))}</strong>
            <p class="detail-note">${escapeHtml(MANAGEMENT_SCOPE_LABELS[event.scope] || event.scope || "整理")} / ${escapeHtml(formatEventTime(event.created_at))}</p>
          </div>
          <span class="status-badge">${escapeHtml(RISK_LABELS[event.risk_level] || event.risk_level || "只读")}</span>
        </div>
        <p>${escapeHtml(event.operation_summary || "已记录一条整理事件。")}</p>
        <p class="detail-note">${escapeHtml(describeOperationEvent(event))}</p>
      </article>
    `).join("")
    : `<div class="empty-state">当前范围下还没有整理历史。</div>`;
}

function renderProposalCard(proposal) {
  const status = proposal.status || "draft";
  const before = proposal.preview?.before || [];
  const after = proposal.preview?.after || [];
  const canConfirm = status === "awaiting_confirmation" || status === "draft" || status === "confirmed";
  const canCancel = status === "awaiting_confirmation" || status === "draft" || status === "confirmed";
  const isBusy = proposalMutationKey === `confirm:${proposal.id}` || proposalMutationKey === `cancel:${proposal.id}`;

  return `
    <article class="proposal-card" data-risk="${escapeHtml(proposal.risk_level || "read_only")}">
      <div class="board-header compact">
        <div>
          <strong>${escapeHtml(proposal.summary || `Proposal ${proposal.id}`)}</strong>
          <p class="detail-note">${escapeHtml(MANAGEMENT_SCOPE_LABELS[proposal.scope] || proposal.scope || "整理")}</p>
        </div>
        <div class="proposal-status-stack">
          <span class="status-badge">${escapeHtml(RISK_LABELS[proposal.risk_level] || proposal.risk_level || "只读")}</span>
          <span class="status-badge">${escapeHtml(PROPOSAL_STATUS_LABELS[status] || status)}</span>
        </div>
      </div>
      <div class="proposal-preview">
        <div>
          <span class="proposal-preview-label">Before</span>
          ${before.length
            ? before.map((item) => `<p>${escapeHtml(item)}</p>`).join("")
            : `<p>等待 before 预览。</p>`}
        </div>
        <div>
          <span class="proposal-preview-label">After</span>
          ${after.length
            ? after.map((item) => `<p>${escapeHtml(item)}</p>`).join("")
            : `<p>等待 after 预览。</p>`}
        </div>
      </div>
      <div class="detail-stack">
        ${(proposal.operations || []).map((operation) => `
          <p class="detail-note">${escapeHtml(operation.operation_type)} / ${escapeHtml(operation.target_type)}: ${escapeHtml(operation.reason || "等待原因。")}</p>
        `).join("")}
      </div>
      <div class="inline-actions">
        <button class="mini-action" type="button" data-proposal-action="confirm" data-proposal-id="${proposal.id}"${canConfirm && !isBusy ? "" : " disabled"}>${isBusy && proposalMutationKey === `confirm:${proposal.id}` ? "确认中..." : "确认执行"}</button>
        <button class="mini-action" type="button" data-proposal-action="cancel" data-proposal-id="${proposal.id}"${canCancel && !isBusy ? "" : " disabled"}>${isBusy && proposalMutationKey === `cancel:${proposal.id}` ? "取消中..." : "取消草案"}</button>
      </div>
    </article>
  `;
}

function renderAchievementsView() {
  const achievementData = dashboardData.achievements || MOCK_ACHIEVEMENTS;
  const sourceNote = document.querySelector("#achievement-source-note");
  const recent = dashboardData.recentAchievements?.length
    ? dashboardData.recentAchievements
    : achievementData.recent_unlocks || [];
  const icons = dashboardData.achievementIcons?.length ? dashboardData.achievementIcons : MOCK_ACHIEVEMENT_ICONS;
  const achievements = achievementData.achievements || [];
  const summary = achievementData.summary || { total: achievements.length, unlocked: 0, hidden: 0 };
  if (!sourceNote) return;

  document.querySelector("#achievement-headline").textContent = `${summary.unlocked || 0} 个记录已经亮起`;
  document.querySelector("#achievement-summary").textContent = `总计 ${summary.total || achievements.length} 个成就，其中 ${summary.hidden || 0} 个仍保持隐藏。`;
  sourceNote.textContent = dashboardLoading
    ? "成就视图正在同步。"
    : buildSourceNote(
      ["achievements", "recentAchievements", "achievementIcons"],
      "当前直接消费后端成就 read model，不在前端推导解锁规则。",
      "当前包含 mock fallback，用来验证 recent unlocks、成就网格和 icon catalog 的结构。",
      "成就相关接口当前没有完整返回，页面先保留解锁区、筛选和图标目录空态。"
    );
  document.querySelector("#achievement-summary-chips").innerHTML = [
    `总计 ${summary.total || achievements.length}`,
    `已解锁 ${summary.unlocked || 0}`,
    `隐藏 ${summary.hidden || 0}`
  ].map((label) => `<span class="summary-chip">${escapeHtml(label)}</span>`).join("");

  document.querySelector("#recent-unlocks-strip").innerHTML = recent.length
    ? recent.map((item) => renderAchievementMiniCard(item)).join("")
    : `<div class="empty-state">最近还没有新解锁。</div>`;

  const groups = [{ key: "all", label: "全部", count: achievements.length }, ...(achievementData.groups || [])];
  document.querySelector("#achievement-group-filters").innerHTML = groups.map((group) => `
    <button class="mini-action${activeAchievementSource === group.key ? " selected" : ""}" type="button" data-achievement-source="${escapeHtml(group.key)}">
      ${escapeHtml(group.label)}${Number.isFinite(group.count) ? ` · ${group.count}` : ""}
    </button>
  `).join("");

  const rarities = ["all", "common", "rare", "core", "secret"];
  document.querySelector("#achievement-rarity-filters").innerHTML = rarities.map((rarity) => `
    <button class="mini-action${activeAchievementRarity === rarity ? " selected" : ""}" type="button" data-achievement-rarity="${escapeHtml(rarity)}">
      ${escapeHtml(rarity === "all" ? "全部稀有度" : RARITY_LABELS[rarity] || rarity)}
    </button>
  `).join("");

  const filtered = achievements.filter((achievement) => {
    const sourceMatch = activeAchievementSource === "all"
      || achievement.source_type === activeAchievementSource
      || (activeAchievementSource === "learning" && achievement.source_type === "learning_session")
      || (activeAchievementSource === "actions" && achievement.source_type === "action")
      || (activeAchievementSource === "memory" && achievement.source_type === "memory");
    const rarityMatch = activeAchievementRarity === "all" || achievement.rarity === activeAchievementRarity;
    return sourceMatch && rarityMatch;
  });

  document.querySelector("#achievement-grid").innerHTML = filtered.length
    ? filtered.map((achievement) => renderAchievementCard(achievement)).join("")
    : `<div class="empty-state">当前筛选下没有成就。</div>`;

  document.querySelector("#achievement-icon-catalog").innerHTML = icons.length
    ? icons.map((icon) => `
      <article class="icon-catalog-item">
        <span class="achievement-glyph" style="--achievement-color: ${escapeHtml(resolvePaletteColor(icon.default_palette))}">${escapeHtml(icon.label?.slice(0, 1) || "?")}</span>
        <div>
          <strong>${escapeHtml(icon.label || icon.icon_type)}</strong>
          <p>${escapeHtml(icon.icon_type)} / ${escapeHtml(icon.default_palette || "default")}</p>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">还没有 icon catalog。</div>`;
}

function renderAchievementMiniCard(item) {
  return `
    <article class="recent-unlock-card">
      <span class="achievement-glyph" style="--achievement-color: ${escapeHtml(item.accent_color || "#6f74b8")}">${escapeHtml((item.title || "?").slice(0, 1))}</span>
      <div>
        <strong>${escapeHtml(item.title || "新成就")}</strong>
        <p>${escapeHtml(conciseText(item.description, "刚刚解锁。", 28))}</p>
      </div>
    </article>
  `;
}

function renderAchievementCard(achievement) {
  const locked = !achievement.unlocked;
  const title = achievement.hidden && locked ? "隐藏成就" : achievement.title;
  const copy = locked
    ? achievement.locked_description || "继续推进后会出现。"
    : achievement.description || "已经记录。";

  return `
    <article class="achievement-card${locked ? " locked" : ""}${achievement.hidden ? " hidden-achievement" : ""}">
      <span class="achievement-glyph" style="--achievement-color: ${escapeHtml(achievement.accent_color || "#6f74b8")}">${escapeHtml((title || "?").slice(0, 1))}</span>
      <div>
        <div class="board-header compact">
          <strong>${escapeHtml(title || "成就")}</strong>
          <span class="status-badge">${escapeHtml(RARITY_LABELS[achievement.rarity] || achievement.rarity || "普通")}</span>
        </div>
        <p>${escapeHtml(copy)}</p>
        <p class="detail-note">${escapeHtml(achievement.source_type || "global")} / ${escapeHtml(achievement.icon_type || "icon")}</p>
      </div>
    </article>
  `;
}

function resolvePaletteColor(palette) {
  switch (palette) {
    case "green_growth": return "#6f9f85";
    case "gold_soft": return "#c8a95c";
    case "ink_silver": return "#8a837c";
    case "violet_secret": return "#7d72c7";
    default: return "#6f74b8";
  }
}

function renderState(state) {
  currentState = state || structuredClone(FALLBACK_STATE);
  renderBadges(currentState);
  renderQuickPrompts(currentState);
  renderNowView(currentState);
  renderLearnView(currentState);
  renderActionsView(currentState);
  renderMemoryView();
  renderManagementView();
  renderAchievementsView();
  updateTtsAvailability();
}

async function fetchState() {
  return fetchJson("/state", { headers: { Accept: "application/json" } });
}

async function fetchDashboardData() {
  const results = await Promise.allSettled([
    fetchJson("/actions?limit=12"),
    fetchJson("/learning/active"),
    fetchJson("/learning/events?limit=12"),
    fetchJson("/memory?limit=24"),
    fetchJson("/memory/profile"),
    fetchJson("/summary/recent?limit=5")
  ]);

  const [actionsResult, learningResult, learningEventsResult, memoryResult, profileResult, summaryResult] = results;
  const supplementalViewModels = await fetchSupplementalViewModels(fetchJson);
  const sectionStatuses = {
    actions: actionsResult.status === "fulfilled" ? "api" : "failed",
    learning: learningResult.status === "fulfilled" ? "api" : "failed",
    learningEvents: learningEventsResult.status === "fulfilled" ? "api" : "failed",
    memory: memoryResult.status === "fulfilled" ? "api" : "failed",
    profile: profileResult.status === "fulfilled" ? "api" : "failed",
    summaries: summaryResult.status === "fulfilled" ? "api" : "failed",
    managementLearning: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api",
    managementMemory: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api",
    managementActions: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api",
    proposals: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api",
    operationEvents: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api",
    achievements: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api",
    recentAchievements: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api",
    achievementIcons: supplementalViewModels.viewModelMode === "mock" ? "mock" : "api"
  };

  if (results.some((r) => r.status === "rejected")) {
    const failedCount = results.filter((r) => r.status === "rejected").length;
    console.warn(`[${PRODUCT_NAME}] ${failedCount}/${results.length} dashboard APIs failed`);
  }

  return {
    actions: actionsResult.status === "fulfilled" ? actionsResult.value?.actions || [] : [],
    learningSessions: learningResult.status === "fulfilled" ? learningResult.value?.sessions || [] : [],
    currentLearning: learningResult.status === "fulfilled" ? learningResult.value?.current_learning || null : null,
    learningEvents: learningEventsResult.status === "fulfilled" ? learningEventsResult.value?.events || [] : [],
    memories: memoryResult.status === "fulfilled" ? memoryResult.value?.memories || [] : [],
    currentMemory: memoryResult.status === "fulfilled" ? memoryResult.value?.current_memory || null : null,
    profile: profileResult.status === "fulfilled" ? profileResult.value?.profile || [] : [],
    profileSummary: profileResult.status === "fulfilled" ? profileResult.value?.summary || "" : "",
    summaries: summaryResult.status === "fulfilled" ? summaryResult.value?.summaries || [] : [],
    syncMeta: {
      sections: sectionStatuses,
      failedCount: results.filter((r) => r.status === "rejected").length,
      fallbackCount: supplementalViewModels.viewModelMode === "mock" ? 1 : 0
    },
    ...supplementalViewModels
  };
}

async function hydrateFromState() {
  setDashboardLoading(true);
  try {
    const [stateResult, dashboardResult, apiResult] = await Promise.allSettled([
      fetchState(),
      fetchDashboardData(),
      fetchJson("/api", { headers: { Accept: "application/json" } })
    ]);

    const state = stateResult.status === "fulfilled" ? stateResult.value : structuredClone(FALLBACK_STATE);
    const nextDashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : structuredClone(FALLBACK_DASHBOARD);
    const apiInfo = apiResult.status === "fulfilled" ? apiResult.value : null;

    apiCapabilities.tts = Boolean(apiInfo?.capabilities?.tts);
    dashboardData = nextDashboard;
    timelineEntries = buildTimelineEntries(state?.recent_memories || []);
    renderState(state);
    renderTimeline();

    const failedCount = [stateResult, dashboardResult, apiResult].filter((r) => r.status === "rejected").length;
    if (failedCount === 0) {
      dom.syncChip.textContent = "后端联调";
    } else if (failedCount === 3) {
      dom.syncChip.textContent = "本地回退";
      showToast("后端暂时不可用，先回到本地占位页继续。", "error", 3200);
    } else {
      dom.syncChip.textContent = `部分同步 (${3 - failedCount}/3)`;
    }
  } finally {
    setDashboardLoading(false);
  }
}

async function submitMessage(event) {
  event.preventDefault();
  const message = dom.composerInput.value.trim();
  if (!message || isSubmitting) return;

  pendingUserMessage = message;
  renderTimeline();
  setSubmitting(true);

  try {
    const result = await postJson("/chat", { message });
    timelineEntries.push(
      {
        actor: "你",
        text: message,
        timestamp: new Date().toISOString(),
        active: true
      },
      {
        actor: PRODUCT_NAME,
        text: result?.reply || "已经留在这里了，我们继续把这一行写清楚。",
        timestamp: new Date().toISOString(),
        active: false
      }
    );
    dom.composerInput.value = "";
    pendingUserMessage = "";
    renderTimeline();
    await hydrateFromState();
  } catch (error) {
    timelineEntries.push(
      {
        actor: "你",
        text: message,
        timestamp: new Date().toISOString(),
        active: true
      },
      {
        actor: PRODUCT_NAME,
        text: "后端回复还没到，但这句话已经替你留在页边了。",
        timestamp: new Date().toISOString(),
        active: false
      }
    );
    dom.composerInput.value = "";
    pendingUserMessage = "";
    renderTimeline();
    showToast(getErrorMessage(error, "刚才这一行还没成功写出去，请稍后再试。"), "error", 3200);
  } finally {
    setSubmitting(false);
  }
}

function fillComposer(value) {
  dom.composerInput.value = value;
  dom.composerInput.focus();
  dom.composerInput.setSelectionRange(value.length, value.length);
}

function bindDesktopWindowControls() {
  if (!window.echoDesktop) return;

  dom.windowMinimize.addEventListener("click", () => window.echoDesktop.minimize());
  dom.windowMaximize.addEventListener("click", () => window.echoDesktop.toggleMaximize());
  dom.windowClose.addEventListener("click", () => window.echoDesktop.close());

  if (typeof window.echoDesktop.onWindowState === "function") {
    window.echoDesktop.onWindowState((state) => {
      dom.windowMaximize.setAttribute("aria-label", state?.isMaximized ? "还原窗口" : "最大化窗口");
    });
  }
}

function bindViewNavigation() {
  dom.navItems.forEach((item) => {
    item.addEventListener("click", () => setActiveView(item.dataset.view || "now"));
  });

  dom.statusJumpPanels.forEach((panel) => {
    panel.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, textarea, form")) {
        return;
      }

      const nextView = panel.dataset.jumpView;
      if (nextView) {
        setActiveView(nextView);
      }
    });
  });
}

function bindProductInteractions() {
  dom.quickPromptButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView("now");
      fillComposer(button.dataset.prompt || "");
    });
  });

  dom.startNextActionButton.addEventListener("click", () => {
    setActiveView("now");
    fillComposer(`我想推进"${currentState?.next_action?.label || "当前动作"}"这个任务`);
  });

  dom.heroStartActionButton.addEventListener("click", () => {
    setActiveView("now");
    fillComposer(`我想继续推进"${currentState?.next_action?.label || "当前动作"}"`);
  });

  dom.manualActionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = dom.manualActionTitle.value.trim();
    const detail = dom.manualActionDetail.value.trim();
    if (!title || manualActionSubmitting) return;

    setManualActionSubmitting(true);
    try {
      await postJson("/actions", {
        type: "manual",
        title,
        detail,
        priority: 2
      });
      dom.manualActionTitle.value = "";
      dom.manualActionDetail.value = "";
      await hydrateFromState();
      setActiveView("actions");
      showToast("这一行已经留好了。", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "这一行没有成功写下，请稍后再试。"), "error", 3200);
    } finally {
      setManualActionSubmitting(false);
    }
  });

  dom.suggestedActionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = dom.suggestedActionQuery.value.trim()
      || currentState?.current_state?.focus
      || currentState?.next_action?.label
      || "继续当前主线";
    if (suggestedActionSubmitting) return;

    setSuggestedActionSubmitting(true);
    try {
      await postJson("/actions/suggested", { query });
      dom.suggestedActionQuery.value = "";
      await hydrateFromState();
      setActiveView("actions");
      showToast("建议下一行已经写出来了。", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "建议下一行暂时没写出来，请稍后再试。"), "error", 3200);
    } finally {
      setSuggestedActionSubmitting(false);
    }
  });

  dom.playLatestEchoButton.addEventListener("click", async () => {
    const text = getLatestEchoText();
    if (!text || !apiCapabilities.tts || ttsUiState === "loading" || ttsUiState === "playing") return;

    stopActiveTtsAudio({ resetState: false });
    setTtsUiState("loading");
    try {
      const result = await postJson("/tts", { text });
      const audio = result?.audio;
      if (!audio?.data || !audio?.mime_type) {
        const payloadError = new Error("Missing audio payload");
        payloadError.code = "tts_empty_audio";
        throw payloadError;
      }
      const player = new Audio(`data:${audio.mime_type};base64,${audio.data}`);
      activeTtsPlaybackToken += 1;
      const token = activeTtsPlaybackToken;
      attachTtsAudio(player, token);
      await player.play();
      if (token === activeTtsPlaybackToken) {
        setTtsUiState("playing");
      }
    } catch (error) {
      stopActiveTtsAudio({ resetState: false });
      if (error?.code === "tts_not_configured") {
        apiCapabilities.tts = false;
        setTtsUiState("unavailable");
      } else {
        setTtsUiState("error");
      }
      showToast(getTtsErrorMessage(error), "error", 3200);
    }
  });

  document.addEventListener("click", async (event) => {
    const jumpTarget = event.target.closest("[data-jump-view]");
    if (jumpTarget) {
      const nextView = jumpTarget.dataset.jumpView;
      if (jumpTarget.dataset.managementTarget) {
        activeManagementScope = jumpTarget.dataset.managementTarget;
      }
      if (jumpTarget.dataset.achievementSourceTarget) {
        activeAchievementSource = jumpTarget.dataset.achievementSourceTarget;
        activeAchievementRarity = "all";
      }
      if (nextView) {
        setActiveView(nextView);
        renderManagementView();
        renderAchievementsView();
        return;
      }
    }

    const managementScopeButton = event.target.closest("[data-management-scope]");
    if (managementScopeButton) {
      activeManagementScope = managementScopeButton.dataset.managementScope || "memory";
      renderManagementView();
      return;
    }

    const proposalButton = event.target.closest("[data-proposal-action]");
    if (proposalButton) {
      const proposalId = Number.parseInt(proposalButton.dataset.proposalId, 10);
      const action = proposalButton.dataset.proposalAction;
      if (!Number.isFinite(proposalId) || !action || proposalMutationKey) return;

      proposalMutationKey = `${action}:${proposalId}`;
      renderManagementView();
      try {
        const endpoint = action === "confirm"
          ? `/management/proposals/${proposalId}/confirm`
          : `/management/proposals/${proposalId}/cancel`;
        const body = action === "confirm"
          ? { confirmation_text: "前端确认执行" }
          : { cancellation_reason: "前端取消草案" };

        await postJson(endpoint, body);
        await hydrateFromState();
        showToast(action === "confirm" ? "这份页边整理已确认落笔。" : "这份页边整理已取消。", "success");
      } catch (error) {
        showToast(
          getErrorMessage(
            error,
            action === "confirm" ? "整理草案确认失败，请稍后再试。" : "整理草案取消失败，请稍后再试。"
          ),
          "error",
          3200
        );
      } finally {
        proposalMutationKey = "";
        renderManagementView();
      }
      return;
    }

    const achievementSourceButton = event.target.closest("[data-achievement-source]");
    if (achievementSourceButton) {
      activeAchievementSource = achievementSourceButton.dataset.achievementSource || "all";
      renderAchievementsView();
      return;
    }

    const achievementRarityButton = event.target.closest("[data-achievement-rarity]");
    if (achievementRarityButton) {
      activeAchievementRarity = achievementRarityButton.dataset.achievementRarity || "all";
      renderAchievementsView();
      return;
    }

    const composeButton = event.target.closest("[data-compose-next]");
    if (composeButton) {
      setActiveView("now");
      fillComposer(`我想继续推进"${currentState?.next_action?.label || "当前动作"}"`);
      return;
    }

    const contextualComposeButton = event.target.closest("[data-compose-kind]");
    if (contextualComposeButton) {
      fillComposerFromContext(contextualComposeButton.dataset.composeKind, {
        text: contextualComposeButton.dataset.composeText,
        label: contextualComposeButton.dataset.composeText,
        title: contextualComposeButton.dataset.composeText,
        summary: contextualComposeButton.dataset.composeText,
        note: contextualComposeButton.dataset.composeText
      });
      return;
    }

    const actionButton = event.target.closest("[data-action-id]");
    if (actionButton) {
      const actionId = Number.parseInt(actionButton.dataset.actionId, 10);
      const status = actionButton.dataset.actionStatus;
      if (!Number.isFinite(actionId) || !status || actionMutationId === actionId) return;

      actionMutationId = actionId;
      renderState(currentState);
      try {
        await postJson(`/actions/${actionId}/status`, { status });
        await hydrateFromState();
        showToast(`这一行的状态已更新为${localizeState(status)}。`, "success");
      } catch (error) {
        showToast(getErrorMessage(error, "这一行的状态还没更新成功，请稍后再试。"), "error", 3200);
      } finally {
        actionMutationId = null;
        renderState(currentState);
      }
      return;
    }

    const learningButton = event.target.closest("[data-learning-session]");
    if (learningButton) {
      const sessionId = Number.parseInt(learningButton.dataset.learningSession, 10);
      const stepIndex = Number.parseInt(learningButton.dataset.learningStep, 10);
      const status = learningButton.dataset.learningStatus;
      const mutationKey = `${sessionId}:${stepIndex}`;
      if (!Number.isFinite(sessionId) || !Number.isFinite(stepIndex) || !status || learningMutationKey === mutationKey) return;

      learningMutationKey = mutationKey;
      renderState(currentState);
      try {
        await postJson(`/learning/${sessionId}/steps/${stepIndex}`, { status });
        await hydrateFromState();
        showToast(`学习这一行已更新为${localizeState(status)}。`, "success");
      } catch (error) {
        showToast(getErrorMessage(error, "学习这一行还没更新成功，请稍后再试。"), "error", 3200);
      } finally {
        learningMutationKey = "";
        renderState(currentState);
      }
      return;
    }

    const memoryButton = event.target.closest("[data-memory-id]");
    if (memoryButton) {
      const memoryId = Number.parseInt(memoryButton.dataset.memoryId, 10);
      const mode = memoryButton.dataset.memoryMode;
      if (!Number.isFinite(memoryId) || !mode || memoryMutationId === memoryId) return;

      memoryMutationId = memoryId;
      renderState(currentState);
      try {
        if (mode === "pin") {
          await postJson(`/memory/${memoryId}/pin`, {});
        } else if (mode === "boost") {
          await postJson(`/memory/${memoryId}/priority`, {
            salience: 0.96,
            priorityBucket: "core",
            pinned: true
          });
        }
        await hydrateFromState();
        showToast(mode === "pin" ? "记忆已置顶。" : "记忆优先级已提升。", "success");
      } catch (error) {
        showToast(getErrorMessage(error, "记忆更新失败，请稍后再试。"), "error", 3200);
      } finally {
        memoryMutationId = null;
        renderState(currentState);
      }
    }
  });
}

function boot() {
  formatClock();
  updateDensityMode();
  hideLaunchScreen();
  ensureReflectionHistory();
  ensureMemoryProfileSummary();
  renderState(structuredClone(FALLBACK_STATE));
  renderTimeline();
  setActiveView(activeView);
  bindDesktopWindowControls();
  bindViewNavigation();
  bindProductInteractions();
  dom.composerForm.addEventListener("submit", submitMessage);
  window.setInterval(formatClock, 1000);
  window.addEventListener("resize", updateDensityMode);
  hydrateFromState();
}

boot();
