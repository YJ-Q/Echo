const MANAGEMENT_TERMS = [
  '整理',
  '梳理',
  '清理',
  '管理',
  '删除',
  '删掉',
  '修改',
  '合并',
  '归档',
  '去重',
  '冗余',
  'review',
  'organize',
  'cleanup',
  'clean up',
  'manage',
  'archive',
  'merge',
  'delete',
  'dedupe'
];

const SCOPE_TERMS = {
  memory: ['记忆', '存档', '回忆', 'memory', 'memories'],
  learning: ['学习线', '学习线路', '学习路线', '学习', '课程', 'learning', 'study'],
  actions: ['任务', '行动', '待办', 'todo', 'action', 'actions', 'task', 'tasks'],
  achievements: ['成就', '徽章', '奖章', 'achievement', 'achievements', 'badge', 'badges']
};

export function detectManagementIntent(input = '') {
  const text = normalizeText(input);
  if (!text) {
    return {
      is_management: false,
      scopes: [],
      primary_scope: null,
      risk_level: 'read_only',
      confidence: 0
    };
  }

  const hasManagementTerm = MANAGEMENT_TERMS.some((term) => text.includes(normalizeText(term)));
  const scopes = Object.entries(SCOPE_TERMS)
    .filter(([, terms]) => terms.some((term) => text.includes(normalizeText(term))))
    .map(([scope]) => scope);

  const isManagement = hasManagementTerm && scopes.length > 0;

  return {
    is_management: isManagement,
    scopes,
    primary_scope: scopes[0] || null,
    risk_level: estimateRiskLevel(text),
    confidence: isManagement ? Math.min(0.95, 0.6 + (scopes.length * 0.1)) : 0
  };
}

function estimateRiskLevel(text) {
  if (['删除', '删掉', 'delete', 'remove'].some((term) => text.includes(normalizeText(term)))) {
    return 'destructive';
  }

  if (['合并', '归档', 'archive', 'merge', 'dismiss'].some((term) => text.includes(normalizeText(term)))) {
    return 'reversible';
  }

  return 'read_only';
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

