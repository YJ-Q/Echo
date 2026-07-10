import {
  addLearningEvent,
  createLearningSession,
  getActiveLearningSession,
  getLatestActiveLearningSession,
  updateLearningStep
} from '../storage/memoryStore.js';
import { buildLearningEvent, LEARNING_EVENT_TYPES } from './learningEvents.js';
import { extractLearningTopic } from './topicExtractor.js';

export async function prepareLearningSession(userInput) {
  const topic = extractLearningTopic(userInput);
  const activeSession = await getActiveLearningSession(topic);

  if (activeSession) {
    await addLearningEvent(buildLearningEvent({
      session: activeSession,
      eventType: LEARNING_EVENT_TYPES.SESSION_REUSED,
      reason: 'same_topic_active_session',
      userInput
    }));

    return {
      session: activeSession,
      created: false
    };
  }

  const steps = buildLearningSteps(topic);
  const session = await createLearningSession({
    topic,
    steps
  });
  await addLearningEvent(buildLearningEvent({
    session,
    eventType: LEARNING_EVENT_TYPES.SESSION_CREATED,
    reason: 'learning_intent',
    userInput
  }));

  return {
    session,
    created: true
  };
}

export function buildLearningSteps(topic) {
  return [
    {
      title: `说清 ${topic} 是什么`,
      action: `用一句话写下：${topic} 解决什么问题。`,
      status: 'active'
    },
    {
      title: '做一个最小例子',
      action: '找一个小到 10 分钟能完成的例子，亲手跑通。',
      status: 'pending'
    },
    {
      title: '记录卡住点',
      action: '写下一个你不懂、但能具体描述的问题。',
      status: 'pending'
    },
    {
      title: '复述给自己',
      action: '不用术语，把刚学到的东西讲成自己的话。',
      status: 'pending'
    }
  ];
}

export async function assessLearningProgress(userInput) {
  const session = await getLatestActiveLearningSession();

  if (!session) {
    return null;
  }

  if (!isLearningRelatedMessage(userInput, session)) {
    return null;
  }

  const assessment = classifyLearningReply(userInput);

  if (assessment.status === 'complete') {
    const previousStep = session.steps[session.current_step];
    const updatedSession = await updateLearningStep(session.id, session.current_step, 'done');
    await addLearningEvent(buildLearningEvent({
      session,
      eventType: LEARNING_EVENT_TYPES.STEP_COMPLETED,
      reason: assessment.reason,
      userInput
    }));

    return {
      type: 'progress',
      status: 'complete',
      session: updatedSession,
      previous_step: previousStep,
      message: 'step_completed'
    };
  }

  if (assessment.status === 'stuck') {
    await addLearningEvent(buildLearningEvent({
      session,
      eventType: LEARNING_EVENT_TYPES.STEP_STUCK,
      reason: assessment.reason,
      userInput
    }));

    return {
      type: 'progress',
      status: 'stuck',
      session,
      current_step: session.steps[session.current_step],
      message: assessment.reason
    };
  }

  if (assessment.status === 'partial') {
    await addLearningEvent(buildLearningEvent({
      session,
      eventType: LEARNING_EVENT_TYPES.STEP_ATTEMPTED,
      reason: assessment.reason,
      userInput
    }));

    return {
      type: 'progress',
      status: 'partial',
      session,
      current_step: session.steps[session.current_step],
      message: assessment.reason
    };
  }

  return null;
}

export function isLearningRelatedMessage(input, session = {}) {
  const text = normalizeText(input);

  if (!text || isShortAcknowledgement(text)) {
    return false;
  }

  const currentStep = session.steps?.[session.current_step] || null;

  if (matchesTopic(text, session.topic) || matchesStep(text, currentStep)) {
    return true;
  }

  const assessment = classifyLearningReply(input);

  if (assessment.status === 'ignore' || isCasualOffTopic(text)) {
    return false;
  }

  if (assessment.status === 'stuck') {
    return hasConcreteStuckObject(text);
  }

  if (assessment.status === 'complete') {
    return hasCompletionObject(text) || hasStepActionCue(text, currentStep);
  }

  return hasStepActionCue(text, currentStep);
}

export function classifyLearningReply(input) {
  const text = normalizeText(input);

  if (matchesAny(text, [
    'done',
    'finished',
    'complete',
    'i did it',
    '搞定',
    '完成',
    '做完',
    '写完',
    '好了'
  ])) {
    return { status: 'complete', reason: 'explicit_completion' };
  }

  if (matchesAny(text, [
    'stuck',
    'confused',
    "don't understand",
    '不懂',
    '不会',
    '卡住',
    '看不懂',
    '没明白'
  ])) {
    return { status: 'stuck', reason: 'explicit_stuck' };
  }

  if (text.length >= 12 || (/[\u4e00-\u9fff]/.test(text) && text.length >= 8)) {
    return { status: 'partial', reason: 'substantive_reply' };
  }

  return { status: 'ignore', reason: 'too_short' };
}

function matchesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeText(input) {
  return String(input || '').toLowerCase().trim();
}

function isShortAcknowledgement(text) {
  return [
    '嗯',
    '好',
    '好的',
    '收到',
    'ok',
    'okay',
    'yes',
    '行',
    '可以'
  ].includes(text);
}

function matchesTopic(text, topic) {
  const normalizedTopic = normalizeText(topic);

  if (!normalizedTopic || normalizedTopic === '这件事') {
    return false;
  }

  if (text.includes(normalizedTopic)) {
    return true;
  }

  return topicAliases(normalizedTopic).some((alias) => text.includes(alias));
}

function topicAliases(topic) {
  const aliases = {
    javascript: ['js', '闭包', '原型', 'promise', '异步', 'dom'],
    'node.js': ['node', 'npm', 'express'],
    nodejs: ['node', 'npm', 'express'],
    typescript: ['ts', '类型', '泛型'],
    rust: ['borrow', 'ownership', '所有权', '借用']
  };

  return aliases[topic] || [];
}

function matchesStep(text, step) {
  if (!step) {
    return false;
  }

  return extractStepKeywords(step).some((keyword) => text.includes(keyword));
}

function extractStepKeywords(step) {
  return [
    step.title,
    step.action
  ]
    .filter(Boolean)
    .flatMap((value) => normalizeText(value).split(/[\s，。,.!?！？；;：:"“”'（）()、]+/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .filter((value) => ![
      '一个',
      '一句话',
      '写下',
      '当前',
      '步骤',
      '问题',
      '什么',
      '自己',
      '不用',
      '术语',
      '刚学到',
      '东西'
    ].includes(value));
}

function isCasualOffTopic(text) {
  return matchesAny(text, [
    '只想聊聊',
    '随便聊',
    '有点累',
    '今天很累',
    '不想学',
    '先不学',
    '换个话题',
    '聊点别的'
  ]);
}

function hasConcreteStuckObject(text) {
  if (!matchesAny(text, [
    'stuck',
    'confused',
    "don't understand",
    '不懂',
    '不会',
    '卡住',
    '看不懂',
    '没明白'
  ])) {
    return false;
  }

  const remainder = text
    .replace(/i'?m|i am|stuck|confused|don'?t understand|不懂|不会|卡住|看不懂|没明白|我|还是|有点|这个|这里|那里/g, '')
    .trim();

  return remainder.length >= 2;
}

function hasCompletionObject(text) {
  return matchesAny(text, [
    'demo',
    'example',
    '练习',
    '例子',
    '小例子',
    '代码',
    '步骤',
    '这一节',
    '这一步',
    '跑通',
    '复述',
    '笔记'
  ]);
}

function hasStepActionCue(text, step) {
  if (matchesStep(text, step)) {
    return true;
  }

  return matchesAny(text, [
    'demo',
    'example',
    '练习',
    '例子',
    '小例子',
    '代码',
    '跑通',
    '复述',
    '笔记',
    '实现',
    '写了',
    '做了',
    '试了'
  ]);
}

function hasStudyCue(text) {
  return matchesAny(text, [
    'learn',
    'study',
    'practice',
    'demo',
    'example',
    '学习',
    '练习',
    '例子',
    '小例子',
    '代码',
    '跑通',
    '复述',
    '笔记',
    '实现',
    '写了',
    '做了',
    '试了',
    '闭包'
  ]);
}
