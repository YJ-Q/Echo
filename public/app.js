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
  summaries: []
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
  now: { title: "此刻", subtitle: "继续说下去。", chip: "连续陪伴" },
  learn: { title: "学习", subtitle: "只看当前一步。", chip: "学习主线" },
  actions: { title: "行动", subtitle: "只推进一件事。", chip: "执行推进" },
  reflections: { title: "反思", subtitle: "看清最近发生了什么。", chip: "近期总结" },
  memory: { title: "记忆", subtitle: "只保留关键线索。", chip: "连续性" }
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
  refreshSummaryButton: document.querySelector("#refresh-summary"),
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
let summaryRefreshing = false;
let manualActionSubmitting = false;
let suggestedActionSubmitting = false;
let ttsRequesting = false;
let apiCapabilities = { tts: false };
let toastTimer = null;

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

function emotionCopy(emotion) {
  switch (emotion) {
    case "anxious": return "先缩小一步。";
    case "motivated": return "可以继续推进。";
    case "focused": return "适合继续执行。";
    case "distracted": return "先回到一个动作。";
    default: return "可以继续梳理。";
  }
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
          actor: "Echo",
          text: memory.echo_response,
          timestamp: memory.timestamp,
          active: false
        });
      }
      return items;
    });
}

function getLatestEchoText() {
  const latest = [...timelineEntries].reverse().find((entry) => entry.actor === "Echo" && entry.text);
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
  activeView = nextView;
  const meta = MINIMAL_VIEW_META[nextView] || MINIMAL_VIEW_META.now;

  dom.navItems.forEach((item) => {
    const isActive = item.dataset.view === nextView;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  dom.workspaceViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.viewPanel === nextView);
  });

  dom.mainWindow.dataset.activeView = nextView;
  dom.toolbarLabel.textContent = `Workspace / ${meta.title}`;
  dom.viewTitle.textContent = meta.title;
  dom.viewSubtitle.textContent = meta.subtitle;
  dom.activeViewChip.textContent = meta.title;
  dom.secondaryViewChip.textContent = dashboardLoading ? "同步中" : meta.chip;
}

function setDashboardLoading(nextLoading) {
  dashboardLoading = nextLoading;
  dom.body.dataset.dashboardLoading = String(nextLoading);
  dom.dataChip.textContent = nextLoading ? "同步中" : "已同步";
  dom.presenceLabel.textContent = nextLoading ? "数据更新中" : "桌面会话";
  setActiveView(activeView);
}

function setSubmitting(nextSubmitting) {
  isSubmitting = nextSubmitting;
  dom.composerSubmit.disabled = nextSubmitting;
  dom.composerInput.disabled = nextSubmitting;
  dom.composerSubmitLabel.textContent = nextSubmitting ? "发送中" : "发送";
}

function setSummaryRefreshing(nextRefreshing) {
  summaryRefreshing = nextRefreshing;
  dom.refreshSummaryButton.disabled = nextRefreshing;
  dom.refreshSummaryButton.textContent = nextRefreshing ? "刷新中..." : "刷新总结";
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

function updateTtsAvailability() {
  const hasText = Boolean(getLatestEchoText());
  dom.playLatestEchoButton.classList.toggle("hidden", !apiCapabilities.tts);
  dom.playLatestEchoButton.disabled = !apiCapabilities.tts || !hasText || ttsRequesting;
  dom.playLatestEchoButton.textContent = ttsRequesting ? "朗读中..." : "朗读最新回复";
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
      actor: "Echo",
      typing: true,
      timestamp: new Date().toISOString(),
      active: false
    });
  }

  if (!entries.length) {
    dom.timelinePanel.innerHTML = `<div class="empty-state">还没有对话记录，先从当前状态说起。</div>`;
    updateTtsAvailability();
    return;
  }

  dom.timelinePanel.innerHTML = entries.map((entry) => {
    const timeText = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(entry.timestamp));
    const body = entry.typing
      ? `<div class="typing-dots" aria-label="输入中"><span></span><span></span><span></span></div>`
      : `<p>${escapeHtml(entry.text)}</p>`;

    return `
      <article class="timeline-row${entry.active ? " active" : ""}${entry.tone === "error" ? " error" : ""}">
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
  const ratioText = totalSteps ? `${Math.min(currentStepIndex + 1, totalSteps)} / ${totalSteps}` : "0 / 0";
  const progress = totalSteps ? Math.max(16, Math.round(((currentStepIndex + 1) / totalSteps) * 100)) : 0;
  const nextActionLabel = state?.next_action?.label || "等待下一步";
  const nextActionDetail = conciseText(state?.next_action?.detail, "先把下一步说清楚。");

  document.querySelector("#hero-emotion").textContent = preset.hero;
  document.querySelector("#hero-copy").textContent = note;
  document.querySelector("#hero-focus-topic").textContent = focus;
  document.querySelector("#hero-learning-ratio").textContent = ratioText;
  document.querySelector("#hero-next-action").textContent = nextActionLabel;
  document.querySelector("#hero-next-copy").textContent = nextActionDetail;
  document.querySelector("#hero-focus-percentage").textContent = `${progress}%`;
  document.querySelector("#hero-focus-track-fill").style.width = `${progress}%`;

  document.querySelector("#emotion-label").textContent = preset.label;
  document.querySelector("#emotion-copy").textContent = emotionCopy(emotion);
  document.querySelector("#focus-title").textContent = focus;
  document.querySelector("#focus-percentage").textContent = `${progress}%`;
  document.querySelector("#focus-track-fill").style.width = `${progress}%`;
  document.querySelector("#action-title").textContent = nextActionLabel;
  document.querySelector("#action-copy").textContent = nextActionDetail;
  document.querySelector("#learning-ratio").textContent = ratioText;
  document.querySelector("#learning-topic").textContent = session?.topic || "等待学习主题";
  document.querySelector("#learning-step-copy").textContent =
    session?.current_step?.title
    || session?.steps?.[currentStepIndex]?.title
    || "等待学习步骤。";
  document.querySelector("#reflection-side-trend").textContent =
    state?.current_reflection?.latest_summary?.emotional_trend
    || dashboardData.summaries[0]?.emotional_trend
    || "等待";
  document.querySelector("#reflection-side-copy").textContent = conciseText(
    state?.current_reflection?.summary || dashboardData.summaries[0]?.summary,
    "等待趋势摘要。"
  );

  const segments = document.querySelector("#learning-segments");
  const segmentLength = totalSteps || 6;
  segments.innerHTML = Array.from({ length: segmentLength }, (_, index) => {
    if (!totalSteps) return "<span></span>";
    if (index < currentStepIndex) return '<span class="done"></span>';
    if (index === currentStepIndex) return '<span class="current"></span>';
    return "<span></span>";
  }).join("");
}

function renderLearnView(state) {
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
    `;
  } else {
    currentActions.innerHTML = "";
  }

  const stepsList = document.querySelector("#learn-steps-list");
  if (!stepLabels.length) {
    stepsList.innerHTML = `<div class="empty-state">当前没有学习主线。</div>`;
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
        </div>
      </article>
    `;
  }).join("");
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
    return `<div class="empty-state">还没有明确的当前主任务，先通过对话或建议任务生成入口创建下一步。</div>`;
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
             <button class="mini-action" type="button" data-action-id="${primaryAction.id}" data-action-status="dismissed"${isBusy ? " disabled" : ""}>移除主任务</button>`
          : `<button class="mini-action" type="button" data-compose-next="true">带回对话继续</button>`}
      </div>
    </article>
  `;
}

function renderActionsView(state) {
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
  document.querySelector("#actions-open-chip").textContent = `${pendingCount} 个待处理`;
  document.querySelector("#actions-active-chip").textContent = `${activeCount} 个进行中`;

  const currentTask = document.querySelector("#actions-current-task");
  currentTask.innerHTML = renderPrimaryActionCard(primaryAction, currentAction, state?.next_action);

  const actionList = document.querySelector("#action-list");
  if (!queueActions.length) {
    actionList.innerHTML = `<div class="empty-state">当前没有任务队列。</div>`;
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
        </div>
      </article>
    `;
  }).join("");
}

function renderReflectionsView() {
  const reflectionView = currentState?.current_reflection || null;
  const latest = reflectionView?.latest_summary || dashboardData.summaries[0] || null;

  document.querySelector("#reflection-headline").textContent = latest?.summary || "近期总结";
  document.querySelector("#reflection-summary").textContent = conciseText(
    reflectionView?.summary || latest?.echo_reflection,
    "等待最近总结。",
    34
  );
  document.querySelector("#reflection-theme-chip").textContent =
    latest?.emotional_trend || reflectionView?.dominant_patterns?.[0]?.pattern || "等待主题";
  document.querySelector("#reflection-summary-copy").textContent = latest?.summary || "等待总结。";
  document.querySelector("#reflection-echo-copy").textContent = conciseText(latest?.echo_reflection, "等待 Echo 反思。", 34);
  document.querySelector("#reflection-pattern-copy").textContent =
    latest?.behavioral_pattern
    || reflectionView?.dominant_patterns?.map((item) => `${item.pattern} x${item.count}`).join(" / ")
    || "等待模式识别。";
  document.querySelector("#reflection-theme-title").textContent =
    latest?.emotional_trend || reflectionView?.emotional_trend?.[0]?.emotion || "等待趋势";

  const historyContainer = ensureReflectionHistory();
  if (!historyContainer) return;

  const history = reflectionView?.history || dashboardData.summaries || [];
  historyContainer.innerHTML = history.length
    ? history.slice(0, 3).map((item) => `
      <article class="reflection-card">
        <span class="mono">${escapeHtml(item.date || "recent")}</span>
        <p>${escapeHtml(conciseText(item.summary || item.echo_reflection, "等待摘要。", 28))}</p>
      </article>
    `).join("")
    : `<div class="empty-state">还没有近期总结。</div>`;
}

function renderMemoryView() {
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
    : `<div class="empty-state">当前还没有明显标签。</div>`;

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
          </div>
        </article>
      `;
    }).join("")
    : `<div class="empty-state">还没有可召回记忆。</div>`;
}

function renderState(state) {
  currentState = state || structuredClone(FALLBACK_STATE);
  renderBadges(currentState);
  renderNowView(currentState);
  renderLearnView(currentState);
  renderActionsView(currentState);
  renderReflectionsView();
  renderMemoryView();
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

  if (results.some((r) => r.status === "rejected")) {
    const failedCount = results.filter((r) => r.status === "rejected").length;
    console.warn(`[Echo] ${failedCount}/${results.length} dashboard APIs failed`);
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
    summaries: summaryResult.status === "fulfilled" ? summaryResult.value?.summaries || [] : []
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
      showToast("后端暂时不可用，已切回本地占位视图。", "error", 3200);
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
        actor: "Echo",
        text: result?.reply || "已经收到，我们继续把这一步变得更清楚。",
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
        actor: "Echo",
        text: "当前还没有拿到后端回复，但这条输入已经保留在桌面会话里。",
        timestamp: new Date().toISOString(),
        active: false
      }
    );
    dom.composerInput.value = "";
    pendingUserMessage = "";
    renderTimeline();
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
      showToast("任务已加入队列。", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "任务创建失败，请稍后再试。"), "error", 3200);
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
      showToast("建议任务已生成。", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "建议任务生成失败，请稍后再试。"), "error", 3200);
    } finally {
      setSuggestedActionSubmitting(false);
    }
  });

  dom.refreshSummaryButton.addEventListener("click", async () => {
    if (summaryRefreshing) return;
    setSummaryRefreshing(true);
    try {
      await postJson("/summary", {});
      await hydrateFromState();
      showToast("总结已刷新。", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "总结刷新失败，请稍后再试。"), "error", 3200);
    } finally {
      setSummaryRefreshing(false);
    }
  });

  dom.playLatestEchoButton.addEventListener("click", async () => {
    const text = getLatestEchoText();
    if (!text || !apiCapabilities.tts || ttsRequesting) return;

    ttsRequesting = true;
    updateTtsAvailability();
    try {
      const result = await postJson("/tts", { text });
      const audio = result?.audio;
      if (!audio?.data || !audio?.mime_type) {
        throw new Error("Missing audio payload");
      }
      const player = new Audio(`data:${audio.mime_type};base64,${audio.data}`);
      await player.play();
    } catch (error) {
      if (error?.code === "tts_not_configured") {
        apiCapabilities.tts = false;
      }
      showToast(getErrorMessage(error, "朗读失败，请稍后再试。"), "error", 3200);
    } finally {
      ttsRequesting = false;
      updateTtsAvailability();
    }
  });

  document.addEventListener("click", async (event) => {
    const composeButton = event.target.closest("[data-compose-next]");
    if (composeButton) {
      setActiveView("now");
      fillComposer(`我想继续推进"${currentState?.next_action?.label || "当前动作"}"`);
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
        showToast(`任务状态已更新为${localizeState(status)}。`, "success");
      } catch (error) {
        showToast(getErrorMessage(error, "任务状态更新失败，请稍后再试。"), "error", 3200);
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
        showToast(`学习步骤已更新为${localizeState(status)}。`, "success");
      } catch (error) {
        showToast(getErrorMessage(error, "学习步骤更新失败，请稍后再试。"), "error", 3200);
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