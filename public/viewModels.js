export const MOCK_MANAGEMENT_OVERVIEWS = {
  learning: {
    scope: "learning",
    summary: "当前有 3 条学习线，其中 1 条正在推进，1 条可能需要回看，1 条可以考虑归档。",
    stats: { total: 3, active: 1, completed: 1, stale: 1 },
    candidates: [
      {
        id: "learning:1",
        target_type: "learning_session",
        target_id: 1,
        title: "Node.js 入门",
        description: "当前步骤停在“说清 Node.js 是什么”。",
        reason: "仍有未完成步骤，适合先回看而不是删除。",
        suggested_operation: "review",
        risk_level: "read_only"
      },
      {
        id: "learning:2",
        target_type: "learning_session",
        target_id: 2,
        title: "旧的 CSS 动画练习",
        description: "长时间没有推进，且最近上下文没有再提到。",
        reason: "可能已经不代表当前重点。",
        suggested_operation: "archive",
        risk_level: "reversible"
      }
    ],
    recommendations: [
      { operation_type: "review", label: "先回看 Node.js 入门", reason: "这条学习线仍然活着，直接删除会丢失上下文。" },
      { operation_type: "archive", label: "归档旧的 CSS 动画练习", reason: "它暂时不像当前主线，可以先从 active 视野移开。" }
    ],
    risk_level: "read_only",
    available_operations: ["review", "rename", "archive"]
  },
  memory: {
    scope: "memory",
    summary: "当前记忆里有 2 条可能重复，1 条长期锚点值得保留。",
    stats: { total: 24, core: 3, working: 7, duplicate_candidates: 2 },
    candidates: [
      {
        id: "memory:12",
        target_type: "memory",
        target_id: 12,
        title: "想学 Node.js 但总在开始前拖延",
        description: "与 memory:18 的主题高度重叠。",
        reason: "内容已被更新、更完整的记忆覆盖。",
        suggested_operation: "merge",
        risk_level: "reversible"
      },
      {
        id: "memory:5",
        target_type: "memory",
        target_id: 5,
        title: "长期锚点：需要把入口缩小",
        description: "这条记忆反复影响当前行动建议。",
        reason: "适合保持置顶，作为长期模式的一部分。",
        suggested_operation: "pin",
        risk_level: "read_only"
      }
    ],
    recommendations: [
      { operation_type: "merge", label: "合并重复的 Node.js 记忆", reason: "保留更完整的版本，减少召回噪音。" },
      { operation_type: "pin", label: "保留入口缩小这条锚点", reason: "它对当前状态判断仍然有解释力。" }
    ],
    risk_level: "read_only",
    available_operations: ["pin", "unpin", "merge", "archive"]
  },
  actions: {
    scope: "actions",
    summary: "当前有 5 个任务，其中 2 个可能重复，1 个适合继续推进。",
    stats: { total: 5, active: 1, pending: 4, duplicate_candidates: 2 },
    candidates: [
      {
        id: "action:7",
        target_type: "action",
        target_id: 7,
        title: "把 Node.js 第一节说清楚",
        description: "与 action:9 都指向同一学习步骤。",
        reason: "两个任务可以合并，避免队列重复。",
        suggested_operation: "merge",
        risk_level: "reversible"
      },
      {
        id: "action:3",
        target_type: "action",
        target_id: 3,
        title: "打开编辑器写第一行",
        description: "当前 active action。",
        reason: "这是现在最具体的入口。",
        suggested_operation: "keep_active",
        risk_level: "read_only"
      }
    ],
    recommendations: [
      { operation_type: "merge", label: "合并重复的 Node.js 任务", reason: "它们都指向同一个学习步骤。" },
      { operation_type: "keep_active", label: "保留当前 active action", reason: "它是最小、最可执行的一步。" }
    ],
    risk_level: "read_only",
    available_operations: ["merge", "dismiss", "reprioritize"]
  }
};

export const MOCK_PROPOSALS = [
  {
    id: 1,
    scope: "memory",
    status: "awaiting_confirmation",
    summary: "建议合并 2 条重复的 Node.js 记忆。",
    risk_level: "reversible",
    operations: [
      {
        operation_type: "merge",
        target_type: "memory",
        target_id: 12,
        target_ids: [12, 18],
        reason: "两条记忆都描述了 Node.js 开始前拖延，memory:18 更完整。"
      }
    ],
    preview: {
      before: ["想学 Node.js 但总在开始前拖延", "Node.js 学习入口需要缩小到第一步"],
      after: ["Node.js 学习需要从一个很小的入口开始，避免在开始前耗尽动力。"]
    },
    created_at: "2026-07-08T00:00:00.000Z"
  },
  {
    id: 2,
    scope: "actions",
    status: "draft",
    summary: "建议 dismiss 1 个已经过期的任务。",
    risk_level: "reversible",
    operations: [
      {
        operation_type: "dismiss",
        target_type: "action",
        target_id: 4,
        reason: "这个任务已经被更新后的任务覆盖。"
      }
    ],
    preview: {
      before: ["旧任务仍在 pending 队列中"],
      after: ["旧任务从主队列移除，但仍保留历史记录"]
    },
    created_at: "2026-07-08T00:00:00.000Z"
  }
];

export const MOCK_OPERATION_EVENTS = [
  {
    id: 1,
    proposal_id: 1,
    event_type: "proposal_created",
    scope: "memory",
    risk_level: "reversible",
    operation_summary: "建议合并 2 条重复的 Node.js 记忆。",
    payload: {
      operation_count: 1
    },
    created_at: "2026-07-08T00:00:00.000Z"
  },
  {
    id: 2,
    proposal_id: 2,
    event_type: "proposal_cancelled",
    scope: "actions",
    risk_level: "reversible",
    operation_summary: "建议 dismiss 1 个已经过期的任务。",
    payload: {
      cancellation_reason: "当前先不处理这条草案。"
    },
    created_at: "2026-07-08T02:00:00.000Z"
  }
];

export const MOCK_ACHIEVEMENTS = {
  summary: { total: 8, unlocked: 3, hidden: 2 },
  recent_unlocks: [
    {
      id: 1,
      achievement_id: 1,
      title: "第一步已经落地",
      description: "你把一个模糊主题推进成了可继续的一步。",
      rarity: "common",
      icon_type: "first_step",
      palette_key: "blue_warm",
      accent_color: "#6f74b8",
      unlocked_at: "2026-07-08T00:00:00.000Z"
    }
  ],
  groups: [
    { key: "learning", label: "学习线", count: 4 },
    { key: "actions", label: "行动", count: 2 },
    { key: "memory", label: "记忆整理", count: 2 }
  ],
  achievements: [
    {
      id: 1,
      key: "learning:first_step",
      title: "第一步已经落地",
      description: "你把一个模糊主题推进成了可继续的一步。",
      locked_description: "完成学习线的第一步后解锁。",
      unlocked: true,
      hidden: false,
      rarity: "common",
      source_type: "learning_session",
      source_id: 1,
      icon_type: "first_step",
      palette_key: "blue_warm",
      accent_color: "#6f74b8",
      unlocked_at: "2026-07-08T00:00:00.000Z"
    },
    {
      id: 2,
      key: "learning:breakthrough",
      title: "卡点被松开",
      description: "你从一个说不清的卡点里找到了下一步。",
      locked_description: "从 stuck 状态恢复推进后解锁。",
      unlocked: false,
      hidden: false,
      rarity: "rare",
      source_type: "learning_session",
      source_id: 1,
      icon_type: "breakthrough",
      palette_key: "green_growth",
      accent_color: "#6f9f85",
      unlocked_at: null
    },
    {
      id: 3,
      key: "learning:completion",
      title: "完成一个闭环",
      description: "这条学习线已经从想法走到一次完整收束。",
      locked_description: "完成学习线最后一步后解锁。",
      unlocked: false,
      hidden: false,
      rarity: "core",
      source_type: "learning_session",
      source_id: 1,
      icon_type: "completion",
      palette_key: "gold_soft",
      accent_color: "#c8a95c",
      unlocked_at: null
    },
    {
      id: 4,
      key: "memory:cleanse",
      title: "把旧线索收进抽屉",
      description: "你整理了一条不再代表当前自己的旧记忆。",
      locked_description: "完成一次记忆整理后解锁。",
      unlocked: true,
      hidden: false,
      rarity: "rare",
      source_type: "memory",
      source_id: null,
      icon_type: "memory_cleanse",
      palette_key: "ink_silver",
      accent_color: "#8a837c",
      unlocked_at: "2026-07-08T00:00:00.000Z"
    },
    {
      id: 5,
      key: "secret:returning",
      title: "隐藏成就",
      description: null,
      locked_description: "还有一件事会在你重新接回旧主线时出现。",
      unlocked: false,
      hidden: true,
      rarity: "secret",
      source_type: "global",
      source_id: null,
      icon_type: "hidden_spark",
      palette_key: "violet_secret",
      accent_color: "#7d72c7",
      unlocked_at: null
    }
  ]
};

export const MOCK_RECENT_ACHIEVEMENTS = [
  ...MOCK_ACHIEVEMENTS.recent_unlocks,
  {
    id: 2,
    achievement_id: 4,
    title: "把旧线索收进抽屉",
    description: "你整理了一条不再代表当前自己的旧记忆。",
    rarity: "rare",
    icon_type: "memory_cleanse",
    palette_key: "ink_silver",
    accent_color: "#8a837c",
    unlocked_at: "2026-07-08T00:00:00.000Z"
  }
];

export const MOCK_ACHIEVEMENT_ICONS = [
  { icon_type: "new_path", label: "新路径", asset_path: "/assets/achievements/new_path.png", default_palette: "blue_warm", supports_tint: true },
  { icon_type: "first_step", label: "第一步", asset_path: "/assets/achievements/first_step.png", default_palette: "blue_warm", supports_tint: true },
  { icon_type: "breakthrough", label: "突破卡点", asset_path: "/assets/achievements/breakthrough.png", default_palette: "green_growth", supports_tint: true },
  { icon_type: "completion", label: "完成闭环", asset_path: "/assets/achievements/completion.png", default_palette: "gold_soft", supports_tint: true },
  { icon_type: "memory_cleanse", label: "整理记忆", asset_path: "/assets/achievements/memory_cleanse.png", default_palette: "ink_silver", supports_tint: true },
  { icon_type: "hidden_spark", label: "隐藏成就", asset_path: "/assets/achievements/hidden_spark.png", default_palette: "violet_secret", supports_tint: true }
];

export const MANAGEMENT_SCOPE_LABELS = {
  memory: "记忆",
  learning: "学习线",
  actions: "任务",
  proposals: "全部草案"
};

export const RISK_LABELS = {
  read_only: "只读",
  reversible: "可撤回",
  destructive: "高风险"
};

export const PROPOSAL_STATUS_LABELS = {
  draft: "草案",
  awaiting_confirmation: "待确认",
  executed: "已执行",
  dismissed: "已取消",
  cancelled: "已取消",
  simulated_confirmed: "已模拟确认",
  simulated_cancelled: "已模拟取消"
};

export const RARITY_LABELS = {
  common: "普通",
  rare: "稀有",
  core: "核心",
  secret: "隐藏"
};

async function fetchViewModel(fetchJson, url, fallback, state) {
  try {
    return await fetchJson(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    state.fallbackCount += 1;
    console.info(`[Echo] Using mock view model for ${url}`);
    return structuredClone(fallback);
  }
}

export async function fetchSupplementalViewModels(fetchJson) {
  const state = { fallbackCount: 0 };
  const [
    managementLearning,
    managementMemory,
    managementActions,
    proposals,
    operationEvents,
    achievements,
    recentAchievements,
    achievementIcons
  ] = await Promise.all([
    fetchViewModel(fetchJson, "/management/overview?scope=learning", MOCK_MANAGEMENT_OVERVIEWS.learning, state),
    fetchViewModel(fetchJson, "/management/overview?scope=memory", MOCK_MANAGEMENT_OVERVIEWS.memory, state),
    fetchViewModel(fetchJson, "/management/overview?scope=actions", MOCK_MANAGEMENT_OVERVIEWS.actions, state),
    fetchViewModel(fetchJson, "/management/proposals", { proposals: MOCK_PROPOSALS }, state),
    fetchViewModel(fetchJson, "/management/operation-events?limit=24", { events: MOCK_OPERATION_EVENTS }, state),
    fetchViewModel(fetchJson, "/achievements", MOCK_ACHIEVEMENTS, state),
    fetchViewModel(fetchJson, "/achievements/recent", { recent_unlocks: MOCK_RECENT_ACHIEVEMENTS }, state),
    fetchViewModel(fetchJson, "/achievements/icons", { icons: MOCK_ACHIEVEMENT_ICONS }, state)
  ]);

  return {
    managementOverviews: {
      learning: managementLearning,
      memory: managementMemory,
      actions: managementActions
    },
    proposals: proposals?.proposals || [],
    operationEvents: operationEvents?.events || [],
    achievements,
    recentAchievements: recentAchievements?.recent_unlocks || [],
    achievementIcons: achievementIcons?.icons || [],
    viewModelMode: state.fallbackCount > 0 ? "mock" : "api"
  };
}
