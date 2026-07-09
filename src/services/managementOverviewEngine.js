import {
  getActions,
  getLearningSessions,
  getMemories
} from '../storage/memoryStore.js';

const SUPPORTED_SCOPES = ['learning', 'memory', 'actions'];

export async function buildManagementOverview({ scope = 'all' } = {}) {
  const normalizedScope = normalizeScope(scope);

  if (normalizedScope === 'all') {
    const overviews = await Promise.all(SUPPORTED_SCOPES.map((item) => buildScopedOverview(item)));
    return {
      scope: 'all',
      headline: '整理总览',
      summary: summarizeAll(overviews),
      scopes: overviews,
      risk_level: highestRiskLevel(overviews.map((overview) => overview.risk_level)),
      stats_items: overviews.flatMap((overview) => overview.stats_items),
      suggested_operations: overviews.flatMap((overview) => overview.suggested_operations),
      available_operations: [...new Set(overviews.flatMap((overview) => overview.available_operations))]
    };
  }

  return buildScopedOverview(normalizedScope);
}

export function normalizeManagementScope(scope = 'all') {
  return normalizeScope(scope);
}

async function buildScopedOverview(scope) {
  switch (scope) {
    case 'learning':
      return buildLearningOverview();
    case 'memory':
      return buildMemoryOverview();
    case 'actions':
      return buildActionsOverview();
    default:
      return buildManagementOverview({ scope: 'all' });
  }
}

async function buildLearningOverview() {
  const sessions = await getLearningSessions({ limit: 50 });
  const active = sessions.filter((session) => session.status === 'active');
  const completed = sessions.filter((session) => session.status === 'completed');
  const stale = active.filter(isStaleRecord);
  const candidates = [
    ...active.slice(0, 3).map((session) => learningCandidate(session, 'review')),
    ...stale.slice(0, 3).map((session) => learningCandidate(session, 'archive'))
  ];

  return {
    scope: 'learning',
    headline: '学习线整理',
    summary: sessions.length
      ? `当前有 ${sessions.length} 条学习线，其中 ${active.length} 条正在推进，${stale.length} 条可能需要回看。`
      : '当前还没有学习线，可以先从一次对话创建主线。',
    stats: {
      total: sessions.length,
      active: active.length,
      completed: completed.length,
      stale: stale.length
    },
    stats_items: buildStats([
      ['total', '全部学习线', sessions.length],
      ['active', '进行中', active.length],
      ['completed', '已完成', completed.length],
      ['stale', '待回看', stale.length]
    ]),
    candidates: dedupeCandidates(candidates),
    recommendations: buildLearningRecommendations(active, stale),
    suggested_operations: buildLearningRecommendations(active, stale),
    risk_level: 'read_only',
    available_operations: ['review', 'rename', 'archive']
  };
}

async function buildMemoryOverview() {
  const memories = await getMemories({ limit: 100 });
  const core = memories.filter((memory) => memory.pinned || memory.priority_bucket === 'core');
  const duplicateCandidates = findDuplicateMemoryCandidates(memories);
  const archiveCandidates = memories
    .filter((memory) => !memory.pinned && memory.priority_bucket === 'ambient' && (memory.salience || 0) <= 0.35)
    .slice(0, 3)
    .map((memory) => memoryCandidate(memory, 'archive', '这条记忆优先级较低，可以先作为归档候选。'));
  const candidates = [
    ...duplicateCandidates,
    ...archiveCandidates,
    ...core.slice(0, 2).map((memory) => memoryCandidate(memory, 'keep', '这条记忆像长期锚点，建议保留。'))
  ];

  return {
    scope: 'memory',
    headline: '记忆整理',
    summary: memories.length
      ? `当前可检查 ${memories.length} 条记忆，其中 ${core.length} 条像长期锚点，${duplicateCandidates.length} 条可能重复。`
      : '当前还没有可整理的记忆。',
    stats: {
      total: memories.length,
      core: core.length,
      working: memories.filter((memory) => memory.priority_bucket === 'important').length,
      duplicate_candidates: duplicateCandidates.length
    },
    stats_items: buildStats([
      ['total', '全部记忆', memories.length],
      ['core', '长期锚点', core.length],
      ['working', '重要记忆', memories.filter((memory) => memory.priority_bucket === 'important').length],
      ['duplicate_candidates', '重复候选', duplicateCandidates.length]
    ]),
    candidates: dedupeCandidates(candidates),
    recommendations: buildMemoryRecommendations(duplicateCandidates, archiveCandidates, core),
    suggested_operations: buildMemoryRecommendations(duplicateCandidates, archiveCandidates, core),
    risk_level: 'read_only',
    available_operations: ['review', 'pin', 'merge', 'archive']
  };
}

async function buildActionsOverview() {
  const actions = await getActions({ limit: 100 });
  const active = actions.filter((action) => action.status === 'active');
  const pending = actions.filter((action) => action.status === 'pending');
  const duplicateCandidates = findDuplicateActionCandidates(actions);
  const candidates = [
    ...active.map((action) => actionCandidate(action, 'keep_active', '这是当前 active action，建议保留为主任务。')),
    ...duplicateCandidates,
    ...pending.slice(0, 3).map((action) => actionCandidate(action, 'review', '这是待处理任务，可以回看是否仍然有效。'))
  ];

  return {
    scope: 'actions',
    headline: '行动整理',
    summary: actions.length
      ? `当前有 ${actions.length} 个任务，其中 ${active.length} 个进行中，${duplicateCandidates.length} 个可能重复。`
      : '当前还没有任务队列。',
    stats: {
      total: actions.length,
      active: active.length,
      pending: pending.length,
      duplicate_candidates: duplicateCandidates.length
    },
    stats_items: buildStats([
      ['total', '全部行动', actions.length],
      ['active', '进行中', active.length],
      ['pending', '待处理', pending.length],
      ['duplicate_candidates', '重复候选', duplicateCandidates.length]
    ]),
    candidates: dedupeCandidates(candidates),
    recommendations: buildActionRecommendations(active, duplicateCandidates),
    suggested_operations: buildActionRecommendations(active, duplicateCandidates),
    risk_level: 'read_only',
    available_operations: ['review', 'merge', 'dismiss', 'reprioritize']
  };
}

function learningCandidate(session, operation) {
  const currentStep = session.steps?.[session.current_step] || null;
  return {
    id: `learning:${session.id}:${operation}`,
    target_type: 'learning_session',
    target_id: session.id,
    title: session.topic,
    description: currentStep?.title || `${session.steps?.length || 0} 个步骤`,
    reason: operation === 'archive'
      ? '这条学习线最近没有明显推进，可以作为归档候选。'
      : '这条学习线仍在 active 状态，适合先回看当前步骤。',
    suggested_operation: operation,
    risk_level: operation === 'archive' ? 'reversible' : 'read_only'
  };
}

function memoryCandidate(memory, operation, reason) {
  return {
    id: `memory:${memory.id}:${operation}`,
    target_type: 'memory',
    target_id: memory.id,
    title: memory.memory_note || memory.user_input || `记忆 ${memory.id}`,
    description: memory.insight_note || memory.echo_response || '',
    reason,
    suggested_operation: operation,
    risk_level: operation === 'keep' || operation === 'pin' ? 'read_only' : 'reversible'
  };
}

function actionCandidate(action, operation, reason) {
  return {
    id: `action:${action.id}:${operation}`,
    target_type: 'action',
    target_id: action.id,
    title: action.title,
    description: action.detail || action.type,
    reason,
    suggested_operation: operation,
    risk_level: operation === 'keep_active' || operation === 'review' ? 'read_only' : 'reversible'
  };
}

function findDuplicateMemoryCandidates(memories) {
  const seen = new Map();
  const candidates = [];

  for (const memory of memories) {
    const key = normalizeTitle(memory.memory_note || memory.user_input || '');
    if (!key) continue;

    if (seen.has(key)) {
      candidates.push(memoryCandidate(
        memory,
        'merge',
        '这条记忆与另一条近期记忆主题接近，可以作为合并候选。'
      ));
    } else {
      seen.set(key, memory);
    }
  }

  return candidates.slice(0, 5);
}

function findDuplicateActionCandidates(actions) {
  const seen = new Map();
  const candidates = [];

  for (const action of actions.filter((item) => ['pending', 'active'].includes(item.status))) {
    const key = normalizeTitle(action.title);
    if (!key) continue;

    if (seen.has(key)) {
      candidates.push(actionCandidate(
        action,
        'merge',
        '这个任务与另一条未完成任务标题接近，可以作为合并候选。'
      ));
    } else {
      seen.set(key, action);
    }
  }

  return candidates.slice(0, 5);
}

function buildLearningRecommendations(active, stale) {
  const recommendations = [];

  if (active.length > 0) {
    recommendations.push({
      operation_type: 'review',
      label: '先回看当前 active 学习线',
      reason: 'active 学习线仍然代表当前主线，不建议直接删除。'
    });
  }

  if (stale.length > 0) {
    recommendations.push({
      operation_type: 'archive',
      label: '把长期未推进的学习线列为归档候选',
      reason: '归档比删除更安全，后续仍可恢复。'
    });
  }

  return recommendations;
}

function buildMemoryRecommendations(duplicates, archiveCandidates, core) {
  const recommendations = [];

  if (duplicates.length > 0) {
    recommendations.push({
      operation_type: 'merge',
      label: '合并重复记忆',
      reason: '减少召回噪音，同时保留更完整的上下文。'
    });
  }

  if (archiveCandidates.length > 0) {
    recommendations.push({
      operation_type: 'archive',
      label: '归档低优先级旧记忆',
      reason: '先移出主要召回视野，不做不可逆删除。'
    });
  }

  if (core.length > 0) {
    recommendations.push({
      operation_type: 'keep',
      label: '保留长期锚点记忆',
      reason: '这些记忆仍能解释当前模式。'
    });
  }

  return recommendations;
}

function buildActionRecommendations(active, duplicates) {
  const recommendations = [];

  if (active.length > 0) {
    recommendations.push({
      operation_type: 'keep_active',
      label: '保留当前 active action',
      reason: '当前主任务应保持稳定，避免频繁切换。'
    });
  }

  if (duplicates.length > 0) {
    recommendations.push({
      operation_type: 'merge',
      label: '合并重复任务',
      reason: '减少队列噪音，让当前任务更清楚。'
    });
  }

  return recommendations;
}

function summarizeAll(overviews) {
  const parts = overviews.map((overview) => overview.summary);
  return parts.join(' ');
}

function buildStats(entries) {
  return entries.map(([key, label, value]) => ({
    key,
    label,
    value
  }));
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function normalizeScope(scope) {
  const normalized = String(scope || 'all').trim().toLowerCase();

  if (['learning', 'memory', 'actions', 'all'].includes(normalized)) {
    return normalized;
  }

  return 'all';
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[，。！？,.!?;；:"“”'‘’]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 24);
}

function isStaleRecord(record) {
  const updatedAt = Date.parse(record.updated_at || record.created_at || '');
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  const ageMs = Date.now() - updatedAt;
  return ageMs > 1000 * 60 * 60 * 24 * 14;
}

function highestRiskLevel(levels) {
  if (levels.includes('destructive')) return 'destructive';
  if (levels.includes('reversible')) return 'reversible';
  return 'read_only';
}
