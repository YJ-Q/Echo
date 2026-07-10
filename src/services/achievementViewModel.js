import {
  acknowledgeAchievementUnlock,
  getActions,
  getAchievementDefinitions,
  getAchievementUnlocks,
  getLearningEvents,
  getLearningSessions,
  getMemories,
  getOperationEvents,
  recordAchievementUnlockCandidates,
  syncAchievementDefinitions
} from '../storage/memoryStore.js';

const ACHIEVEMENT_DEFINITIONS = [
  {
    id: 1,
    key: 'learning:new_path',
    group_key: 'learning',
    group_label: '学习线',
    title: '新路径被点亮',
    description: '你把一个想学的主题变成了可以继续推进的学习线。',
    locked_description: '形成第一条学习线后显影。',
    rarity: 'common',
    source_type: 'learning_session',
    icon_type: 'new_path',
    palette_key: 'blue_warm',
    accent_color: '#667d83',
    hidden: false,
    resolve: ({ sessions }) => {
      const session = sessions[0];
      return session ? unlocked(session.id, session.created_at) : locked();
    }
  },
  {
    id: 2,
    key: 'learning:first_step',
    group_key: 'learning',
    group_label: '学习线',
    title: '第一步已经落地',
    description: '你把一个模糊主题推进成了可继续的一步。',
    locked_description: '完成学习线的第一步后显影。',
    rarity: 'common',
    source_type: 'learning_session',
    icon_type: 'first_step',
    palette_key: 'blue_warm',
    accent_color: '#667d83',
    hidden: false,
    resolve: ({ sessions }) => {
      const session = sessions.find((item) => countDoneSteps(item) >= 1);
      return session ? unlocked(session.id, session.updated_at) : locked();
    }
  },
  {
    id: 3,
    key: 'learning:breakthrough',
    group_key: 'learning',
    group_label: '学习线',
    title: '卡点被松开',
    description: '你从一个说不清的卡点里找到了下一步。',
    locked_description: '记录卡点并重新推进学习线后显影。',
    rarity: 'rare',
    source_type: 'learning_session',
    icon_type: 'breakthrough',
    palette_key: 'green_growth',
    accent_color: '#708574',
    hidden: false,
    resolve: ({ learningEvents }) => {
      const stuckEvent = learningEvents.find((event) => /stuck/i.test(event.event_type || event.note || ''));
      const progressEvent = learningEvents.find((event) => {
        return stuckEvent
          && event.session_id === stuckEvent.session_id
          && Date.parse(event.created_at) > Date.parse(stuckEvent.created_at)
          && /(partial|complete|done|progress)/i.test(event.event_type || event.note || '');
      });

      return progressEvent ? unlocked(progressEvent.session_id, progressEvent.created_at) : locked();
    }
  },
  {
    id: 4,
    key: 'learning:completion',
    group_key: 'learning',
    group_label: '学习线',
    title: '完成一个闭环',
    description: '这条学习线已经从想法走到一次完整收束。',
    locked_description: '完成学习线最后一步后显影。',
    rarity: 'core',
    source_type: 'learning_session',
    icon_type: 'completion',
    palette_key: 'gold_soft',
    accent_color: '#9b7d4c',
    hidden: false,
    resolve: ({ sessions }) => {
      const session = sessions.find((item) => item.status === 'completed');
      return session ? unlocked(session.id, session.updated_at) : locked();
    }
  },
  {
    id: 5,
    key: 'actions:first_done',
    group_key: 'actions',
    group_label: '行动',
    title: '一个行动被完成',
    description: '你把一条行动从等待推进到了完成。',
    locked_description: '完成任意一个行动后显影。',
    rarity: 'common',
    source_type: 'action',
    icon_type: 'action_done',
    palette_key: 'gold_soft',
    accent_color: '#9b7d4c',
    hidden: false,
    resolve: ({ actions }) => {
      const action = actions.find((item) => item.status === 'done');
      return action ? unlocked(action.id, action.updated_at) : locked();
    }
  },
  {
    id: 6,
    key: 'memory:core_anchor',
    group_key: 'memory',
    group_label: '留痕整理',
    title: '留下一个长期锚点',
    description: '你把一条重要记忆留成了更稳定的长期线索。',
    locked_description: '主动留住一条重要线索后显影。',
    rarity: 'rare',
    source_type: 'memory',
    icon_type: 'memory_cleanse',
    palette_key: 'ink_silver',
    accent_color: '#766e65',
    hidden: false,
    resolve: ({ memories }) => {
      const memory = memories.find((item) => item.pinned || item.priority_bucket === 'core');
      return memory ? unlocked(memory.id, memory.last_accessed_at || memory.timestamp) : locked();
    }
  },
  {
    id: 7,
    key: 'management:first_proposal',
    group_key: 'memory',
    group_label: '留痕整理',
    title: '一份整理草案',
    description: '你把一次模糊的整理想法变成了可检查、可确认的草案。',
    locked_description: '形成第一份整理草案后显影。',
    rarity: 'common',
    source_type: 'operation_proposal',
    icon_type: 'memory_cleanse',
    palette_key: 'ink_silver',
    accent_color: '#766e65',
    hidden: false,
    resolve: ({ operationEvents }) => {
      const event = operationEvents.find((item) => item.event_type === 'proposal_created');
      return event ? unlocked(event.proposal_id, event.created_at) : locked();
    }
  },
  {
    id: 8,
    key: 'secret:returning',
    group_key: 'secret',
    group_label: '隐藏',
    title: '重新接回旧线',
    description: null,
    locked_description: '还有一件事，会在你重新接回一条旧线时显影。',
    rarity: 'secret',
    source_type: 'global',
    icon_type: 'hidden_spark',
    palette_key: 'umber_secret',
    accent_color: '#766b5c',
    hidden: true,
    resolve: ({ sessions }) => {
      const reopened = sessions.find((item) => item.status === 'active' && countDoneSteps(item) >= 2);
      return reopened ? unlocked(null, reopened.updated_at) : locked();
    }
  }
];

export async function buildAchievementViewModel() {
  await syncAchievementDefinitions(ACHIEVEMENT_DEFINITIONS);

  const context = await buildAchievementContext();
  const discoveryCandidates = ACHIEVEMENT_DEFINITIONS.flatMap((definition) => {
    const state = definition.resolve(context);

    if (!state.unlocked) {
      return [];
    }

    return [buildAchievementUnlockCandidate(definition, state)];
  });

  await recordAchievementUnlockCandidates(discoveryCandidates);

  const [definitions, unlocks] = await Promise.all([
    getAchievementDefinitions(),
    getAchievementUnlocks()
  ]);

  const unlockMap = new Map(unlocks.map((unlock) => [unlock.key, unlock]));
  const achievements = definitions.map((definition) => buildAchievement(definition, unlockMap.get(definition.key)));

  return {
    summary: {
      total: definitions.length,
      unlocked: unlocks.length,
      hidden: definitions.filter((definition) => definition.hidden).length
    },
    recent_unlocks: buildRecentUnlocks(definitions, unlocks),
    groups: buildGroups(definitions),
    achievements
  };
}

export async function buildRecentAchievementViewModel({ limit = 5 } = {}) {
  const viewModel = await buildAchievementViewModel();
  return {
    recent_unlocks: viewModel.recent_unlocks.slice(0, normalizeLimit(limit, 5))
  };
}

export async function acknowledgeAchievement(key) {
  await syncAchievementDefinitions(ACHIEVEMENT_DEFINITIONS);
  const definition = ACHIEVEMENT_DEFINITIONS.find((item) => item.key === key);

  if (!definition) {
    return null;
  }

  const unlock = await acknowledgeAchievementUnlock(key);

  if (!unlock) {
    return null;
  }

  return buildAchievement(definition, unlock);
}

async function buildAchievementContext() {
  const [sessions, learningEvents, actions, memories, operationEvents] = await Promise.all([
    getLearningSessions({ limit: 100 }),
    getLearningEvents({ limit: 200 }),
    getActions({ limit: 100 }),
    getMemories({ limit: 100 }),
    getOperationEvents({ limit: 100 })
  ]);

  return {
    sessions,
    learningEvents,
    actions,
    memories,
    operationEvents
  };
}

function buildAchievement(definition, unlock = null) {
  const hiddenLocked = definition.hidden && !unlock;

  return {
    id: definition.definition_id ?? definition.id,
    key: definition.key,
    title: hiddenLocked ? '未显影的印记' : definition.title,
    description: hiddenLocked ? null : definition.description,
    locked_description: definition.locked_description,
    unlocked: Boolean(unlock),
    hidden: Boolean(definition.hidden),
    rarity: definition.rarity,
    source_type: definition.source_type,
    source_id: unlock ? unlock.source_id : null,
    icon_type: definition.icon_type,
    palette_key: definition.palette_key,
    accent_color: definition.accent_color,
    unlocked_at: unlock ? unlock.unlocked_at : null,
    acknowledged_at: unlock ? unlock.acknowledged_at : null,
    is_new: Boolean(unlock && !unlock.acknowledged_at)
  };
}

function buildAchievementUnlockCandidate(definition, state) {
  return {
    key: definition.key,
    source_type: definition.source_type,
    source_id: normalizeSourceId(state.source_id),
    unlocked_at: state.unlocked_at || new Date().toISOString()
  };
}

function buildRecentUnlocks(definitions, unlocks) {
  const definitionMap = new Map(definitions.map((definition) => [definition.key, definition]));

  return [...unlocks]
    .filter((unlock) => unlock.unlocked_at)
    .sort((a, b) => {
      const timeDelta = Date.parse(b.unlocked_at) - Date.parse(a.unlocked_at);

      if (timeDelta !== 0) {
        return timeDelta;
      }

      return a.key.localeCompare(b.key);
    })
    .map((unlock, index) => {
      const definition = definitionMap.get(unlock.key);

      return {
        id: index + 1,
        key: unlock.key,
        achievement_id: definition ? definition.definition_id ?? definition.id : index + 1,
        title: definition ? definition.title : unlock.key,
        description: definition ? definition.description : null,
        rarity: definition ? definition.rarity : 'common',
        icon_type: definition ? definition.icon_type : null,
        palette_key: definition ? definition.palette_key : null,
        accent_color: definition ? definition.accent_color : null,
        source_id: unlock.source_id,
        unlocked_at: unlock.unlocked_at,
        acknowledged_at: unlock.acknowledged_at,
        is_new: !unlock.acknowledged_at
      };
    });
}

function buildGroups(definitions) {
  const labels = new Map(definitions.map((definition) => [definition.group_key, definition.group_label]));
  const counts = definitions.reduce((result, definition) => {
    result.set(definition.group_key, (result.get(definition.group_key) || 0) + 1);
    return result;
  }, new Map());

  return Array.from(counts.entries()).map(([key, count]) => ({
    key,
    label: labels.get(key) || key,
    count
  }));
}

function countDoneSteps(session) {
  return (session.steps || []).filter((step) => step.status === 'done').length;
}

function normalizeSourceId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = Number(value);
  if (Number.isFinite(normalized) && String(normalized) === String(value)) {
    return normalized;
  }

  return value;
}

function unlocked(sourceId, unlockedAt) {
  return {
    unlocked: true,
    source_id: sourceId,
    unlocked_at: unlockedAt || new Date().toISOString()
  };
}

function locked() {
  return {
    unlocked: false,
    source_id: null,
    unlocked_at: null
  };
}

function normalizeLimit(value, fallback) {
  const limit = Number(value || fallback);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : fallback;
}
