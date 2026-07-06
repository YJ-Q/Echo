const FALLBACK_STATE = {
  current_state: {
    emotion: "anxious",
    context_note: "Listening. Observing. No immediate action.",
    focus: "Report + Meeting Prep",
    pattern: "starting friction"
  },
  next_action: {
    label: "Outline section 2",
    detail: "Keep the motion small. Finish the opening structure first."
  },
  active_learning: [
    {
      topic: "Managing workload",
      current_step: 2,
      steps: [
        { title: "Map the pressure" },
        { title: "Shrink the next move" },
        { title: "Run one opening pass" },
        { title: "Check the meeting edge" },
        { title: "Name the friction" },
        { title: "Close the loop" }
      ]
    }
  ],
  recent_memories: [
    {
      timestamp: new Date(Date.now() - 4 * 60000).toISOString(),
      user_input: "A lot is going on with work and study.",
      echo_response: "You sounded a little anxious earlier.",
      tags: ["motivated", "learning", "planning"]
    },
    {
      timestamp: new Date(Date.now() - 2 * 60000).toISOString(),
      user_input: "I need help finding the next move.",
      echo_response: "Let's find the next small step.",
      tags: ["learning", "planning"]
    }
  ]
};

const clock = document.querySelector("#clock");
const launchScreen = document.querySelector("#launch-screen");
const timelinePanel = document.querySelector("#timeline-panel");
const boardBadges = document.querySelector("#board-badges");
const composerForm = document.querySelector("#composer-form");
const composerInput = document.querySelector("#composer-input");
const composerSubmit = document.querySelector("#composer-submit");
const composerSubmitLabel = document.querySelector("#composer-submit-label");
const windowMinimize = document.querySelector("#window-minimize");
const windowMaximize = document.querySelector("#window-maximize");
const windowClose = document.querySelector("#window-close");
const navItems = Array.from(document.querySelectorAll(".nav-item[data-view]"));
const workspaceViews = Array.from(document.querySelectorAll(".workspace-view"));
const statusViews = Array.from(document.querySelectorAll(".status-view"));
const viewSubtitle = document.querySelector("#view-subtitle");
const activeViewChip = document.querySelector("#active-view-chip");
const secondaryViewChip = document.querySelector("#secondary-view-chip");
const rootBody = document.body;
const quickPromptButtons = Array.from(document.querySelectorAll(".quick-prompt"));
const jumpButtons = Array.from(document.querySelectorAll("[data-jump-view]"));
const startNextActionButton = document.querySelector("#start-next-action");
const refreshSummaryButton = document.querySelector("#refresh-summary");

const FALLBACK_DASHBOARD = {
  actions: [],
  learningSessions: [],
  learningEvents: [],
  memories: [],
  profile: [],
  profileSummary: "",
  summaries: []
};

let currentState = structuredClone(FALLBACK_STATE);
let timelineEntries = buildTimelineEntries(FALLBACK_STATE.recent_memories);
let pendingUserMessage = "";
let isSubmitting = false;
let activeView = "now";
let dashboardData = structuredClone(FALLBACK_DASHBOARD);
let actionMutationId = null;
let learningMutationKey = "";
let memoryMutationId = null;
let summaryRefreshing = false;
let dashboardLoading = false;

const VIEW_META = {
  now: {
    subtitle: "当前线索保持可见。",
    chip: "聚焦"
  },
  learn: {
    subtitle: "模式会沉淀成可复用的支持逻辑。",
    chip: "自适应"
  },
  actions: {
    subtitle: "下一步行动应该始终近在手边。",
    chip: "执行中"
  },
  reflections: {
    subtitle: "反思会把线程压缩成真正可用的内容。",
    chip: "意义"
  },
  memory: {
    subtitle: "记忆让上下文保持活着，同时不让界面变重。",
    chip: "召回"
  }
};

const VIEW_LABELS = {
  now: "此刻",
  learn: "学习",
  actions: "行动",
  reflections: "反思",
  memory: "记忆"
};

const STATE_LABELS = {
  pending: "待处理",
  active: "进行中",
  done: "已完成"
};

function unwrapEnvelope(payload) {
  if (payload && typeof payload === "object" && "ok" in payload) {
    return payload.ok ? payload.data : null;
  }

  return payload;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with ${response.status}`);
  }

  const payload = await response.json();
  return unwrapEnvelope(payload);
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body || {})
  });
}

function updateClock() {
  if (!clock) return;
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  clock.textContent = `${values.hour}:${values.minute}:${values.second}`;
}

function updateDensityMode() {
  if (!rootBody) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const isCompact = dpr >= 1.25 || width <= 1720 || height <= 1020;

  rootBody.dataset.density = isCompact ? "compact" : "regular";
}

function setDashboardLoading(nextLoading) {
  dashboardLoading = nextLoading;
  if (secondaryViewChip) {
    secondaryViewChip.textContent = nextLoading ? "同步中" : (VIEW_META[activeView]?.chip || "聚焦");
  }
}

function hideLaunchScreen() {
  if (!launchScreen) return;
  window.setTimeout(() => {
    launchScreen.classList.add("hidden");
  }, 900);
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function localizeView(view) {
  return VIEW_LABELS[view] || view || "";
}

function localizeState(status) {
  return STATE_LABELS[status] || status || "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function simplifyContextNote(note, fallback) {
  const source = String(note || "").trim();
  if (!source) return fallback;

  if (source.length <= 52) {
    return source;
  }

  const parts = source
    .split(/[.。！？!?]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 0 && parts[0].length <= 28) {
    return `${parts[0]}.`;
  }

  return fallback;
}

function formatTime(timestamp) {
  if (!timestamp) return "--:--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateLabel(timestamp) {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "2-digit"
  }).format(date);
}

function emotionPreset(emotion) {
  const presets = {
    anxious: {
      label: "焦虑",
      hero: "平静",
      copy: "频率偏高，需要先落地。"
    },
    motivated: {
      label: "有动力",
      hero: "就绪",
      copy: "节奏向前，适合开始推进。"
    },
    focused: {
      label: "专注",
      hero: "专注",
      copy: "线条稳定，干扰较低。"
    },
    distracted: {
      label: "分散",
      hero: "漂移",
      copy: "节奏不规则，需要收缩界面负担。"
    },
    neutral: {
      label: "中性",
      hero: "平静",
      copy: "线条平稳，暂时没有紧急事项。"
    }
  };

  return presets[emotion] || {
    label: emotion || "平静",
    hero: emotion || "平静",
    copy: "信号已经出现，但仍在形成中。"
  };
}

function buildTimelineEntries(memories = []) {
  const sorted = [...memories]
    .filter((memory) => memory && (memory.user_input || memory.echo_response))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return sorted.flatMap((memory) => {
    const entries = [];

    if (memory.echo_response) {
      entries.push({
        actor: "Echo",
        text: memory.echo_response,
        timestamp: memory.timestamp,
        active: false
      });
    }

    if (memory.user_input) {
      entries.push({
        actor: "你",
        text: memory.user_input,
        timestamp: memory.timestamp,
        active: true
      });
    }

    return entries;
  });
}

function renderTimeline() {
  if (!timelinePanel) return;

  const entries = [...timelineEntries];
  if (pendingUserMessage) {
    entries.push({
      actor: "You",
      text: pendingUserMessage,
      timestamp: new Date().toISOString(),
      active: true,
      pending: true
    });
  }

  entries.push({
    actor: pendingUserMessage ? "Echo" : "你",
    typing: true,
    timestamp: new Date().toISOString(),
    active: !pendingUserMessage
  });

  timelinePanel.innerHTML = entries.map((entry) => {
    const activeClass = entry.active ? " active" : "";
    const actorClass = entry.actor === "你" ? " user" : "";
    const actor = escapeHtml(entry.actor);
    const time = escapeHtml(formatTime(entry.timestamp));
    const body = entry.typing
      ? `<div class="typing-dots" aria-label="输入中"><span></span><span></span><span></span></div>`
      : `<p>${escapeHtml(entry.text)}</p>`;

    return `
      <article class="timeline-row${activeClass}${actorClass}">
        <time class="mono">${time}</time>
        <span class="timeline-dot"></span>
        <div class="timeline-copy">
          <h3>${actor}</h3>
          ${body}
        </div>
      </article>
    `;
  }).join("");
}

function renderBadges() {
  if (!boardBadges) return;
  const latestTags = currentState?.recent_memories?.[0]?.tags || [];
  const fallbackTags = ["有动力", "学习中", "规划中"];
  const tags = (latestTags.length ? latestTags : fallbackTags).slice(0, 3);

  boardBadges.innerHTML = tags.map((tag, index) => {
    const mutedClass = index === 2 ? " muted-badge" : "";
    return `<span class="status-badge${mutedClass}">${escapeHtml(tag)}</span>`;
  }).join("");
}

function setActiveView(nextView) {
  activeView = nextView;
  const meta = VIEW_META[nextView] || VIEW_META.now;

  navItems.forEach((item) => {
    const isActive = item.dataset.view === nextView;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  workspaceViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.viewPanel === nextView);
  });

  statusViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.statusPanel === nextView);
  });

  if (viewSubtitle) viewSubtitle.textContent = meta.subtitle;
  if (activeViewChip) activeViewChip.textContent = localizeView(nextView);
  if (secondaryViewChip) secondaryViewChip.textContent = meta.chip;
}

function setComposerValue(value) {
  if (!composerInput) return;
  composerInput.value = value;
  composerInput.focus();
  composerInput.setSelectionRange(value.length, value.length);
}

function renderEmotion(state) {
  const emotion = state?.current_state?.emotion || FALLBACK_STATE.current_state.emotion;
  const note = state?.current_state?.context_note || FALLBACK_STATE.current_state.context_note;
  const preset = emotionPreset(emotion);
  const conciseNote = simplifyContextNote(note, "正在倾听，正在观察，暂不急于行动。");

  const emotionLabel = document.querySelector("#emotion-label");
  const heroEmotion = document.querySelector("#hero-emotion");
  const heroCopy = document.querySelector("#hero-copy");
  const emotionCopy = document.querySelector("#emotion-copy");

  if (emotionLabel) emotionLabel.textContent = preset.label;
  if (heroEmotion) heroEmotion.textContent = preset.hero;
  if (heroCopy) heroCopy.textContent = conciseNote;
  if (emotionCopy) emotionCopy.textContent = preset.copy;
}

function renderFocus(state) {
  const focus = state?.current_state?.focus || FALLBACK_STATE.current_state.focus;
  const focusTitle = document.querySelector("#focus-title");
  const focusLaneTitle = document.querySelector("#focus-lane-title");
  const memoryCount = state?.recent_memories?.length || FALLBACK_STATE.recent_memories.length;
  const progress = Math.min(92, Math.max(18, 34 + memoryCount * 14));
  const progressText = `${progress}%`;

  if (focusTitle) focusTitle.textContent = focus;
  if (focusLaneTitle) focusLaneTitle.textContent = focus;

  const focusProgressFill = document.querySelector("#focus-progress-fill");
  const focusTrackFill = document.querySelector("#focus-track-fill");
  const focusProgressValue = document.querySelector("#focus-progress-value");
  const focusPercentage = document.querySelector("#focus-percentage");

  if (focusProgressFill) focusProgressFill.style.width = progressText;
  if (focusTrackFill) focusTrackFill.style.width = progressText;
  if (focusProgressValue) focusProgressValue.textContent = progressText;
  if (focusPercentage) focusPercentage.textContent = progressText;
}

function renderNextAction(state) {
  const nextLabel = state?.next_action?.label || FALLBACK_STATE.next_action.label;
  const nextDetail = state?.next_action?.detail || FALLBACK_STATE.next_action.detail;

  const actionTitle = document.querySelector("#action-title");
  const heroAction = document.querySelector("#hero-next-action");
  const actionCopy = document.querySelector("#action-copy");
  const heroNextCopy = document.querySelector("#hero-next-copy");

  if (actionTitle) actionTitle.textContent = nextLabel;
  if (heroAction) heroAction.textContent = nextLabel;
  if (actionCopy) actionCopy.textContent = nextDetail;
  if (heroNextCopy) heroNextCopy.textContent = nextDetail;
}

function renderLearning(state) {
  const session = state?.active_learning?.[0] || FALLBACK_STATE.active_learning[0];
  const total = session?.steps?.length || 0;
  const currentStepIndex = Number.isFinite(session?.current_step) ? session.current_step : 0;
  const ratio = total ? `${currentStepIndex + 1}/${total}` : "0/0";
  const currentStepTitle = session?.steps?.[currentStepIndex]?.title || "当前步骤正在形成。";

  const learningRatio = document.querySelector("#learning-ratio");
  const learningTopic = document.querySelector("#learning-topic");
  const learningStepCopy = document.querySelector("#learning-step-copy");
  const learningSegments = document.querySelector("#learning-segments");

  if (learningRatio) learningRatio.textContent = ratio;
  if (learningTopic) learningTopic.textContent = session?.topic || FALLBACK_STATE.active_learning[0].topic;
  if (learningStepCopy) learningStepCopy.textContent = `当前步骤：${currentStepTitle}`;

  if (learningSegments && total) {
    learningSegments.innerHTML = Array.from({ length: total }, (_, index) => {
      if (index < currentStepIndex) return `<span class="done"></span>`;
      if (index === currentStepIndex) return `<span class="current"></span>`;
      return `<span></span>`;
    }).join("");
  }
}

function renderMemory(state) {
  const memories = state?.recent_memories || FALLBACK_STATE.recent_memories;
  const memoryCount = document.querySelector("#memory-count");
  const memoryGrid = document.querySelector("#memory-grid");

  if (memoryCount) {
    memoryCount.textContent = `${memories.length} 条`;
  }

  if (memoryGrid) {
    const cells = 30;
    const hotEvery = Math.max(3, 9 - memories.length);
    memoryGrid.innerHTML = Array.from({ length: cells }, (_, index) => {
      const hot = (index + 2) % hotEvery === 0;
      return `<span${hot ? ' class="hot"' : ""}></span>`;
    }).join("");
  }
}

function renderSecondaryViews(state) {
  const learningSession = state?.active_learning?.[0] || FALLBACK_STATE.active_learning[0];
  const nextAction = state?.next_action?.label || FALLBACK_STATE.next_action.label;
  const pattern = state?.current_state?.pattern || FALLBACK_STATE.current_state.pattern;
  const memories = dashboardData.memories.length
    ? dashboardData.memories
    : state?.recent_memories || FALLBACK_STATE.recent_memories;
  const actions = dashboardData.actions.length ? dashboardData.actions : [];
  const activeSession = dashboardData.learningSessions[0] || learningSession;
  const learningEvents = dashboardData.learningEvents;
  const summaries = dashboardData.summaries;
  const profileSummary = dashboardData.profileSummary;
  const totalSteps = activeSession?.steps?.length || 0;
  const currentStep = Number.isFinite(activeSession?.current_step) ? activeSession.current_step : 0;
  const tags = Array.from(new Set(memories.flatMap((memory) => memory.tags || []))).slice(0, 3);

  const learnHeroTopic = document.querySelector("#learn-hero-topic");
  const learnHeroCopy = document.querySelector("#learn-hero-copy");
  const learnStepStat = document.querySelector("#learn-step-stat");
  const learnTotalStat = document.querySelector("#learn-total-stat");
  const learnStepsList = document.querySelector("#learn-steps-list");
  const learnPatternTitle = document.querySelector("#learn-pattern-title");
  const learnLessonRatio = document.querySelector("#learn-lesson-ratio");
  const learnSideTopic = document.querySelector("#learn-side-topic");
  const learnSideSegments = document.querySelector("#learn-side-segments");
  const learnCuesCount = document.querySelector("#learn-cues-count");
  const actionsBlockerLabel = document.querySelector("#actions-blocker-label");
  const actionsAssistLabel = document.querySelector("#actions-assist-label");

  if (learnHeroTopic) learnHeroTopic.textContent = activeSession.topic;
  if (learnHeroCopy) {
    const recentLearningEvent = learningEvents[0];
    learnHeroCopy.textContent = recentLearningEvent?.note
      || `当前线索正在教会 Echo 如何更好地帮助你处理“${activeSession.topic}”。`;
  }
  if (learnStepStat) learnStepStat.textContent = String(currentStep + 1).padStart(2, "0");
  if (learnTotalStat) learnTotalStat.textContent = String(totalSteps).padStart(2, "0");
  if (learnPatternTitle) learnPatternTitle.textContent = capitalize(pattern);
  if (learnLessonRatio) learnLessonRatio.textContent = `${currentStep + 1}/${totalSteps}`;
  if (learnSideTopic) learnSideTopic.textContent = activeSession.topic;
  if (learnCuesCount) learnCuesCount.textContent = String(tags.length || 3).padStart(2, "0");

  if (learnStepsList) {
    const steps = Array.isArray(activeSession.steps) ? activeSession.steps : [];
    learnStepsList.innerHTML = steps.length ? steps.map((step, index) => {
      const stateClass = index < currentStep ? "done" : index === currentStep ? "current" : "";
      const matchingEvent = learningEvents.find((event) => event.step_index === index);
      const stepStatus = step.status || (index < currentStep ? "done" : index === currentStep ? "active" : "pending");
      const isBusy = learningMutationKey === `${activeSession.id}:${index}`;
      return `
        <article class="step-row ${stateClass}">
          <span class="step-index mono">${String(index + 1).padStart(2, "0")}</span>
          <div class="step-copy">
            <strong>${escapeHtml(step.title)}</strong>
            <p>${escapeHtml(matchingEvent?.note || (index === currentStep ? "这是下一轮辅助的当前焦点。" : "先保留在序列中，稍后再推进。"))}</p>
            <div class="inline-actions">
              <button class="mini-action${stepStatus === "active" ? " selected" : ""}" type="button" data-learning-session="${activeSession.id}" data-learning-step="${index}" data-learning-status="active"${isBusy ? " disabled" : ""}>进行中</button>
              <button class="mini-action${stepStatus === "done" ? " selected" : ""}" type="button" data-learning-session="${activeSession.id}" data-learning-step="${index}" data-learning-status="done"${isBusy ? " disabled" : ""}>完成</button>
            </div>
          </div>
        </article>
      `;
    }).join("") : `<div class="empty-state">暂时还没有激活的学习步骤。</div>`;
  }

  if (learnSideSegments && totalSteps) {
    learnSideSegments.innerHTML = Array.from({ length: totalSteps }, (_, index) => {
      if (index < currentStep) return `<span class="done"></span>`;
      if (index === currentStep) return `<span class="current"></span>`;
      return `<span></span>`;
    }).join("");
  }

  const actionList = document.querySelector("#action-list");
  const actionsOpenCount = document.querySelector("#actions-open-count");
  const actionsNextLabel = document.querySelector("#actions-next-label");
  const actionItems = actions.length
    ? actions.slice(0, 4).map((action) => ({
      id: action.id,
      title: action.title,
      state: localizeState(action.status),
      status: action.status,
      detail: action.detail || action.metadata?.reason || "等待下一步动作出现。",
      isPrimary: action.status === "active" || action.status === "pending"
    }))
    : [
      { id: "", title: nextAction, state: "进行中", status: "active", detail: "当前主动作。", isPrimary: true },
      { id: "", title: "起草开头", state: "就绪", status: "pending", detail: "投入低，撬动高。", isPrimary: false },
      { id: "", title: "会议清单", state: "等待", status: "pending", detail: "等章节草稿出来后再处理。", isPrimary: false },
      { id: "", title: "回看总结", state: "排队中", status: "pending", detail: "执行启动后再做更有效。", isPrimary: false }
    ];

  if (actionsOpenCount) actionsOpenCount.textContent = String(actionItems.length).padStart(2, "0");
  if (actionsNextLabel) actionsNextLabel.textContent = actionItems[0]?.title || nextAction;
  if (actionsBlockerLabel) {
    actionsBlockerLabel.textContent = actions[0]?.metadata?.reason || pattern.replaceAll("_", " ");
  }
  if (actionsAssistLabel) {
    actionsAssistLabel.textContent = profileSummary ? "由画像引导" : "按章节拆分";
  }
  if (actionList) {
    actionList.innerHTML = actionItems.length ? actionItems.map((item, index) => `
      <article class="action-row ${index === 0 ? "active" : ""}">
        <div class="action-row-head">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="status-badge${item.isPrimary ? "" : " muted-badge"}">${escapeHtml(item.state)}</span>
        </div>
        <p>${escapeHtml(item.detail)}</p>
        ${item.id ? `
          <div class="inline-actions">
            <button class="mini-action${item.status === "active" ? " selected" : ""}" type="button" data-action-id="${item.id}" data-action-status="active"${actionMutationId === item.id ? " disabled" : ""}>设为进行中</button>
            <button class="mini-action${item.status === "done" ? " selected" : ""}" type="button" data-action-id="${item.id}" data-action-status="done"${actionMutationId === item.id ? " disabled" : ""}>标记完成</button>
          </div>
        ` : ""}
      </article>
    `).join("") : `<div class="empty-state">当前没有排队中的行动，线程推进后 Echo 会给出下一步建议。</div>`;
  }

  const reflectionPatternCopy = document.querySelector("#reflection-pattern-copy");
  const reflectionTheme = document.querySelector("#reflection-theme");
  const reflectionSummaryCopy = document.querySelector("#reflection-summary-copy");
  const reflectionEchoCopy = document.querySelector("#reflection-echo-copy");
  const latestSummary = summaries[0];
  if (reflectionSummaryCopy) {
    reflectionSummaryCopy.textContent = latestSummary?.summary
      || "当下一步变得具体，压力就会明显下降。";
  }
  if (reflectionEchoCopy) {
    reflectionEchoCopy.textContent = latestSummary?.echo_reflection
      || "当 Echo 给出更少但更明确的选项时，专注度会更好。";
  }
  if (reflectionPatternCopy) {
    reflectionPatternCopy.textContent = latestSummary?.behavioral_pattern
      || `重复出现的阻力集中在${pattern.replaceAll("_", " ")}。`;
  }
  if (reflectionTheme) {
    reflectionTheme.textContent = latestSummary?.emotional_trend
      ? latestSummary.emotional_trend
      : "启动";
  }

  const memoryTotalStat = document.querySelector("#memory-total-stat");
  const memorySideTotal = document.querySelector("#memory-side-total");
  const memoryClusters = document.querySelector("#memory-clusters");
  const memoryList = document.querySelector("#memory-list");
  const memorySideGrid = document.querySelector("#memory-side-grid");
  const memoryTags = document.querySelector("#memory-tags");

  if (memoryTotalStat) memoryTotalStat.textContent = String(memories.length).padStart(2, "0");
  if (memorySideTotal) memorySideTotal.textContent = String(memories.length).padStart(2, "0");

  if (memoryClusters) {
    const clusters = [
      { label: "工作负荷", count: Math.max(2, memories.length), tone: "hot" },
      { label: "规划", count: Math.max(1, Math.ceil(memories.length / 2)), tone: "" },
      { label: "情绪", count: Math.max(1, Math.ceil(memories.length / 3)), tone: "" },
      { label: "支持线索", count: tags.length || 3, tone: "hot" }
    ];
    memoryClusters.innerHTML = clusters.map((cluster) => `
      <article class="cluster-card ${cluster.tone}">
        <strong>${escapeHtml(cluster.label)}</strong>
        <span class="mono">${String(cluster.count).padStart(2, "0")}</span>
      </article>
    `).join("");
  }

  if (memoryList) {
    memoryList.innerHTML = memories.length ? memories.slice(0, 4).map((memory) => `
      <article class="memory-row">
        <span class="mono">${escapeHtml(formatDateLabel(memory.timestamp))}</span>
        <div>
          <strong>${escapeHtml(memory.user_input || "Echo 召回了上下文")}</strong>
          <p>${escapeHtml(memory.memory_note || memory.insight_note || memory.echo_response || "这段先前的回应会被保留下来维持连续性。")}</p>
          ${memory.id ? `
            <div class="inline-actions">
              <button class="mini-action${memory.pinned ? " selected" : ""}" type="button" data-memory-id="${memory.id}" data-memory-mode="pin"${memoryMutationId === memory.id ? " disabled" : ""}>${memory.pinned ? "已置顶" : "置顶"}</button>
              <button class="mini-action" type="button" data-memory-id="${memory.id}" data-memory-mode="boost"${memoryMutationId === memory.id ? " disabled" : ""}>提升</button>
            </div>
          ` : ""}
        </div>
      </article>
    `).join("") : `<div class="empty-state">暂时还没有召回的片段，近期对话会逐步积累到这里。</div>`;
  }

  if (memorySideGrid) {
    memorySideGrid.innerHTML = Array.from({ length: 30 }, (_, index) => {
      const hot = (index + memories.length) % 5 === 0;
      return `<span${hot ? ' class="hot"' : ""}></span>`;
    }).join("");
  }

  if (memoryTags) {
    const chosenTags = (tags.length ? tags : ["规划", "学习", "动力"]).slice(0, 3);
    memoryTags.innerHTML = chosenTags.map((tag, index) => `
      <span class="status-badge${index === 2 ? " muted-badge" : ""}">${escapeHtml(tag)}</span>
    `).join("");
  }

  const learnPatternFallback = document.querySelector("#learn-hero-copy");
  if (learnPatternFallback && profileSummary && !learningEvents[0]?.note) {
    learnPatternFallback.textContent = profileSummary;
  }
}

function renderState(state) {
  currentState = state;
  renderEmotion(state);
  renderFocus(state);
  renderNextAction(state);
  renderLearning(state);
  renderMemory(state);
  renderSecondaryViews(state);
  renderBadges();
}

function setSubmitting(nextSubmitting) {
  isSubmitting = nextSubmitting;
  if (!composerSubmit || !composerSubmitLabel || !composerInput) return;
  composerSubmit.disabled = nextSubmitting;
  composerInput.disabled = nextSubmitting;
  composerSubmitLabel.textContent = nextSubmitting ? "发送中" : "继续";
}

function setSummaryRefreshing(nextRefreshing) {
  summaryRefreshing = nextRefreshing;
  if (!refreshSummaryButton) return;
  refreshSummaryButton.disabled = nextRefreshing;
  refreshSummaryButton.textContent = nextRefreshing ? "刷新中..." : "刷新总结";
}

function bindDesktopWindowControls() {
  if (!window.echoDesktop) return;

  windowMinimize?.addEventListener("click", () => window.echoDesktop.minimize());
  windowMaximize?.addEventListener("click", () => window.echoDesktop.toggleMaximize());
  windowClose?.addEventListener("click", () => window.echoDesktop.close());

  if (typeof window.echoDesktop.onWindowState === "function" && windowMaximize) {
    window.echoDesktop.onWindowState((state) => {
      const maximized = Boolean(state?.isMaximized);
      windowMaximize.classList.toggle("is-maximized", maximized);
      windowMaximize.setAttribute(
        "aria-label",
        maximized ? "还原窗口" : "最大化窗口"
      );
    });
  }
}

function bindViewNavigation() {
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      setActiveView(item.dataset.view || "now");
    });
  });
}

function bindProductInteractions() {
  quickPromptButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt || "";
      setActiveView("now");
      setComposerValue(prompt);
    });
  });

  jumpButtons.forEach((element) => {
    element.addEventListener("click", (event) => {
      const target = event.currentTarget;
      const view = target.dataset.jumpView;
      if (!view) return;

      if (target.tagName === "BUTTON") {
        event.stopPropagation();
      }

      setActiveView(view);
    });
  });

  startNextActionButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextAction = currentState?.next_action?.label || FALLBACK_STATE.next_action.label;
    setActiveView("now");
    setComposerValue(`开始这个动作：${nextAction}`);
  });

  document.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action-id]");
    if (actionButton) {
      event.stopPropagation();
      const actionId = Number.parseInt(actionButton.dataset.actionId, 10);
      const status = actionButton.dataset.actionStatus;

      if (!Number.isFinite(actionId) || !status || actionMutationId === actionId) {
        return;
      }

      actionMutationId = actionId;
      renderState(currentState);

      try {
        await postJson(`/actions/${actionId}/status`, { status });
        await hydrateFromState();
      } catch {
        actionMutationId = null;
        renderState(currentState);
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

      if (!Number.isFinite(sessionId) || !Number.isFinite(stepIndex) || !status || learningMutationKey === mutationKey) {
        return;
      }

      learningMutationKey = mutationKey;
      renderState(currentState);

      try {
        await postJson(`/learning/${sessionId}/steps/${stepIndex}`, { status });
        await hydrateFromState();
      } catch {
        learningMutationKey = "";
        renderState(currentState);
      } finally {
        learningMutationKey = "";
        renderState(currentState);
      }

      return;
    }

    const memoryButton = event.target.closest("[data-memory-id]");
    if (memoryButton) {
      event.stopPropagation();
      const memoryId = Number.parseInt(memoryButton.dataset.memoryId, 10);
      const mode = memoryButton.dataset.memoryMode;

      if (!Number.isFinite(memoryId) || !mode || memoryMutationId === memoryId) {
        return;
      }

      memoryMutationId = memoryId;
      renderState(currentState);

      try {
        if (mode === "pin") {
          await postJson(`/memory/${memoryId}/pin`, {});
        }

        if (mode === "boost") {
          await postJson(`/memory/${memoryId}/priority`, {
            salience: 0.96,
            priorityBucket: "core",
            pinned: true
          });
        }

        await hydrateFromState();
      } catch {
        memoryMutationId = null;
        renderState(currentState);
      } finally {
        memoryMutationId = null;
        renderState(currentState);
      }
    }
  });

  refreshSummaryButton?.addEventListener("click", async () => {
    if (summaryRefreshing) return;

    setSummaryRefreshing(true);

    try {
      await postJson("/summary", {});
      await hydrateFromState();
    } catch {
      // Keep existing summary if refresh fails.
    } finally {
      setSummaryRefreshing(false);
    }
  });
}

async function fetchState() {
  return fetchJson("/state", {
    headers: { Accept: "application/json" }
  });
}

async function fetchDashboardData() {
  const [
    actionsData,
    learningData,
    learningEventsData,
    memoryData,
    profileData,
    summaryData
  ] = await Promise.all([
    fetchJson("/actions?limit=8"),
    fetchJson("/learning/active"),
    fetchJson("/learning/events?limit=12"),
    fetchJson("/memory?limit=24"),
    fetchJson("/memory/profile"),
    fetchJson("/summary/recent?limit=5")
  ]);

  return {
    actions: actionsData?.actions || [],
    learningSessions: learningData?.sessions || [],
    learningEvents: learningEventsData?.events || [],
    memories: memoryData?.memories || [],
    profile: profileData?.profile || [],
    profileSummary: profileData?.summary || "",
    summaries: summaryData?.summaries || []
  };
}

async function hydrateFromState() {
  setDashboardLoading(true);
  try {
    const [state, nextDashboardData] = await Promise.all([
      fetchState(),
      fetchDashboardData().catch(() => structuredClone(FALLBACK_DASHBOARD))
    ]);
    dashboardData = nextDashboardData;
    timelineEntries = buildTimelineEntries(state.recent_memories);
    renderState(state);
    renderTimeline();
  } catch {
    dashboardData = structuredClone(FALLBACK_DASHBOARD);
    renderState(FALLBACK_STATE);
    renderTimeline();
  } finally {
    setDashboardLoading(false);
  }
}

async function submitMessage(event) {
  event.preventDefault();
  if (!composerInput) return;

  const message = composerInput.value.trim();
  if (!message || isSubmitting) return;

  pendingUserMessage = message;
  renderTimeline();
  setSubmitting(true);

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      throw new Error(`Chat request failed with ${response.status}`);
    }

    const payload = await response.json();
    const chatResult = unwrapEnvelope(payload) || {};
    timelineEntries.push(
      {
        actor: "你",
        text: message,
        timestamp: new Date().toISOString(),
        active: true
      },
      {
        actor: "Echo",
        text: chatResult.reply || "已经收到，这一轮状态正在继续形成。",
        timestamp: new Date().toISOString(),
        active: false
      }
    );

    composerInput.value = "";
    pendingUserMessage = "";
    renderTimeline();
    await hydrateFromState();
  } catch {
    timelineEntries.push(
      {
        actor: "你",
        text: message,
        timestamp: new Date().toISOString(),
        active: true
      },
      {
        actor: "Echo",
        text: "当前线程还停留在本地态，等后端就绪后，它会带着状态一起流动。",
        timestamp: new Date().toISOString(),
        active: false
      }
    );
    composerInput.value = "";
    pendingUserMessage = "";
    renderTimeline();
  } finally {
    setSubmitting(false);
  }
}

updateClock();
updateDensityMode();
hideLaunchScreen();
renderState(currentState);
renderTimeline();
bindDesktopWindowControls();
bindViewNavigation();
bindProductInteractions();
setActiveView(activeView);
setInterval(updateClock, 1000);
window.addEventListener("resize", updateDensityMode);

if (composerForm) {
  composerForm.addEventListener("submit", submitMessage);
}

hydrateFromState();
