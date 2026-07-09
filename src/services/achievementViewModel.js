import {
  getActions,
  getLearningEvents,
  getLearningSessions,
  getMemories,
  getOperationEvents
} from '../storage/memoryStore.js';

const ACHIEVEMENT_DEFINITIONS = [
  {
    id: 1,
    key: 'learning:new_path',
    group_key: 'learning',
    group_label: '学习线',
    title: '新路径被点亮',
    description: '你把一个想学的主题变成了可以继续推进的学习线。',
    locked_description: '创建第一条学习线后解锁。',
    rarity: 'common',
    source_type: 'learning_session',
    icon_type: 'new_path',
    palette_key: 'blue_warm',
    accent_color: '#6f74b8',
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
    locked_description: '完成学习线的第一步后解锁。',
    rarity: 'common',
    source_type: 'learning_session',
    icon_type: 'first_step',
    palette_key: 'blue_warm',
    accent_color: '#6f74b8',
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
    locked_description: '出现卡住记录后重新推进学习线时解锁。',
    rarity: 'rare',
    source_type: 'learning_session',
    icon_type: 'breakthrough',
    palette_key: 'green_growth',
    accent_color: '#6f9f85',
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
    locked_description: '完成学习线最后一步后解锁。',
    rarity: 'core',
    source_type: 'learning_session',
    icon_type: 'completion',
    palette_key: 'gold_soft',
    accent_color: '#c8a95c',
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
    title: '一个动作完成了',
    description: '你把一条行动从队列里推进到了完成。',
    locked_description: '完成任意一个 action 后解锁。',
    rarity: 'common',
    source_type: 'action',
    icon_type: 'action_done',
    palette_key: 'gold_soft',
    accent_color: '#c8a95c',
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
    group_label: '记忆整理',
    title: '留下一个长期锚点',
    description: '你把一条重要记忆标成了更稳定的长期线索。',
    locked_description: '置顶或强化一条核心记忆后解锁。',
    rarity: 'rare',
    source_type: 'memory',
    icon_type: 'memory_cleanse',
    palette_key: 'ink_silver',
    accent_color: '#8a837c',
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
    group_label: '记忆整理',
    title: '整理草案已经出现',
    description: '你把一次后台整理从模糊想法变成了可确认的草案。',
    locked_description: '创建第一条治理 proposal 后解锁。',
    rarity: 'common',
    source_type: 'operation_proposal',
    icon_type: 'memory_cleanse',
    palette_key: 'ink_silver',
    accent_color: '#8a837c',
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
    title: '隐藏成就',
    description: null,
    locked_description: '还有一件事会在你重新接回旧主线时出现。',
    rarity: 'secret',
    source_type: 'global',
    icon_type: 'hidden_spark',
    palette_key: 'violet_secret',
    accent_color: '#7d72c7',
    hidden: true,
    resolve: ({ sessions }) => {
      const reopened = sessions.find((item) => item.status === 'active' && countDoneSteps(item) >= 2);
      return reopened ? unlocked(null, reopened.updated_at) : locked();
    }
  }
];

export async function buildAchievementViewModel() {
  const context = await buildAchievementContext();
  const achievements = ACHIEVEMENT_DEFINITIONS.map((definition) => buildAchievement(definition, context));
  const recentUnlocks = buildRecentUnlocks(achievements);

  return {
    summary: {
      total: achievements.length,
      unlocked: achievements.filter((achievement) => achievement.unlocked).length,
      hidden: achievements.filter((achievement) => achievement.hidden).length
    },
    recent_unlocks: recentUnlocks,
    groups: buildGroups(achievements),
    achievements
  };
}

export async function buildRecentAchievementViewModel({ limit = 5 } = {}) {
  const viewModel = await buildAchievementViewModel();
  return {
    recent_unlocks: viewModel.recent_unlocks.slice(0, normalizeLimit(limit, 5))
  };
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

function buildAchievement(definition, context) {
  const state = definition.resolve(context);
  const hiddenLocked = definition.hidden && !state.unlocked;

  return {
    id: definition.id,
    key: definition.key,
    title: hiddenLocked ? '隐藏成就' : definition.title,
    description: hiddenLocked ? null : definition.description,
    locked_description: definition.locked_description,
    unlocked: state.unlocked,
    hidden: definition.hidden,
    rarity: definition.rarity,
    source_type: definition.source_type,
    source_id: state.source_id,
    icon_type: definition.icon_type,
    palette_key: definition.palette_key,
    accent_color: definition.accent_color,
    unlocked_at: state.unlocked_at
  };
}

function buildRecentUnlocks(achievements) {
  return achievements
    .filter((achievement) => achievement.unlocked && achievement.unlocked_at)
    .sort((a, b) => Date.parse(b.unlocked_at) - Date.parse(a.unlocked_at))
    .map((achievement, index) => ({
      id: index + 1,
      achievement_id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      rarity: achievement.rarity,
      icon_type: achievement.icon_type,
      palette_key: achievement.palette_key,
      accent_color: achievement.accent_color,
      unlocked_at: achievement.unlocked_at
    }));
}

function buildGroups(achievements) {
  const labels = new Map(ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.group_key, definition.group_label]));
  const counts = achievements.reduce((result, achievement) => {
    const definition = ACHIEVEMENT_DEFINITIONS.find((item) => item.id === achievement.id);
    const key = definition.group_key;
    result.set(key, (result.get(key) || 0) + 1);
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
