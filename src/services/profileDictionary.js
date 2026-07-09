const PROFILE_KEY_DEFINITIONS = {
  preferred_language: {
    key: 'preferred_language',
    label: '偏好语言',
    category: 'identity',
    includeInSummary: true,
    includeInProfileNote: false
  },
  current_learning_focus: {
    key: 'current_learning_focus',
    label: '当前学习重点',
    category: 'learning',
    includeInSummary: true,
    includeInProfileNote: true
  },
  active_growth_area: {
    key: 'active_growth_area',
    label: '当前成长方向',
    category: 'learning',
    includeInSummary: true,
    includeInProfileNote: false
  },
  recurring_pattern: {
    key: 'recurring_pattern',
    label: '重复模式',
    category: 'pattern',
    includeInSummary: true,
    includeInProfileNote: true
  },
  start_friction: {
    key: 'start_friction',
    label: '启动阻力',
    category: 'pattern',
    includeInSummary: true,
    includeInProfileNote: true
  },
  emotional_trigger: {
    key: 'emotional_trigger',
    label: '情绪触发点',
    category: 'emotion',
    includeInSummary: true,
    includeInProfileNote: false
  },
  emotional_baseline: {
    key: 'emotional_baseline',
    label: '情绪底色',
    category: 'emotion',
    includeInSummary: true,
    includeInProfileNote: false
  },
  learning_preference: {
    key: 'learning_preference',
    label: '学习偏好',
    category: 'learning',
    includeInSummary: true,
    includeInProfileNote: true
  },
  execution_style: {
    key: 'execution_style',
    label: '执行方式',
    category: 'execution',
    includeInSummary: true,
    includeInProfileNote: false
  },
  planning_style: {
    key: 'planning_style',
    label: '规划方式',
    category: 'execution',
    includeInSummary: true,
    includeInProfileNote: false
  },
  recovery_path: {
    key: 'recovery_path',
    label: '恢复路径',
    category: 'regulation',
    includeInSummary: true,
    includeInProfileNote: false
  },
  self_regulation_pattern: {
    key: 'self_regulation_pattern',
    label: '自我调节模式',
    category: 'regulation',
    includeInSummary: true,
    includeInProfileNote: false
  },
  sustained_learning_topic: {
    key: 'sustained_learning_topic',
    label: '持续学习主题',
    category: 'learning',
    includeInSummary: true,
    includeInProfileNote: false
  },
  echo_interaction_style: {
    key: 'echo_interaction_style',
    label: 'Echo 互动风格',
    category: 'interaction',
    includeInSummary: true,
    includeInProfileNote: false
  }
};

const PROFILE_VALUE_LABELS = {
  'procrastination around starting tasks': '启动任务前的拖延',
  'learning and study execution': '学习与执行',
  'small executable steps': '小而可执行的步骤',
  'difficulty entering the first action': '进入第一个动作很难',
  'future pressure entering the present': '未来压力提前进入当下',
  'responds to small starts': '对小启动动作反应更好',
  'needs one main task and a stop point': '需要一个主任务和一个停止点',
  'reflective we-perspective with one next action': '我们视角 + 一个下一步动作',
  focused: '专注',
  distracted: '分心',
  anxious: '焦虑',
  neutral: '平静',
  motivated: '有动力',
  'start resistance matters more than task difficulty': '比起任务难度，真正卡住我们的更常常是开始那一下',
  'small visible action restores momentum': '先做一个看得见的小动作，比继续想更容易把自己带回来',
  'ground into one visible next step': '先落回一件眼前能做的事',
  'returns through small executable learning steps': '通过小而可执行的学习动作，更容易重新进入状态'
};

const UNKNOWN_PROFILE_KEY_DEFINITION = Object.freeze({
  key: '',
  label: '自定义字段',
  category: 'custom',
  includeInSummary: false,
  includeInProfileNote: false,
  known: false
});

export function getProfileKeyDefinition(key) {
  const definition = PROFILE_KEY_DEFINITIONS[key];

  if (definition) {
    return {
      ...definition,
      known: true
    };
  }

  return {
    ...UNKNOWN_PROFILE_KEY_DEFINITION,
    key,
    label: key || UNKNOWN_PROFILE_KEY_DEFINITION.label
  };
}

export function isKnownProfileKey(key) {
  return Object.hasOwn(PROFILE_KEY_DEFINITIONS, key);
}

export function humanizeProfileValue(value) {
  return PROFILE_VALUE_LABELS[value] || value;
}

export { PROFILE_KEY_DEFINITIONS, PROFILE_VALUE_LABELS };
