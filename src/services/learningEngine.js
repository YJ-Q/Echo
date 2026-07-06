import {
  addLearningEvent,
  createLearningSession,
  getActiveLearningSession,
  getLatestActiveLearningSession,
  updateLearningStep
} from '../storage/memoryStore.js';
import { extractLearningTopic } from './topicExtractor.js';

export async function prepareLearningSession(userInput) {
  const topic = extractLearningTopic(userInput);
  const activeSession = await getActiveLearningSession(topic);

  if (activeSession) {
    await addLearningEvent({
      sessionId: activeSession.id,
      topic: activeSession.topic,
      eventType: 'session_reused',
      stepIndex: activeSession.current_step,
      stepTitle: activeSession.steps[activeSession.current_step]?.title,
      note: 'We returned to an existing learning line.',
      userInput
    });

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
  await addLearningEvent({
    sessionId: session.id,
    topic: session.topic,
    eventType: 'session_created',
    stepIndex: session.current_step,
    stepTitle: session.steps[session.current_step]?.title,
    note: 'We turned a learning wish into a small executable line.',
    userInput
  });

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

  const assessment = classifyLearningReply(userInput);

  if (assessment.status === 'complete') {
    const previousStep = session.steps[session.current_step];
    const updatedSession = await updateLearningStep(session.id, session.current_step, 'done');
    await addLearningEvent({
      sessionId: session.id,
      topic: session.topic,
      eventType: 'step_completed',
      stepIndex: session.current_step,
      stepTitle: previousStep?.title,
      note: 'We moved one step forward.',
      userInput
    });

    return {
      type: 'progress',
      status: 'complete',
      session: updatedSession,
      previous_step: previousStep,
      message: 'step_completed'
    };
  }

  if (assessment.status === 'stuck') {
    await addLearningEvent({
      sessionId: session.id,
      topic: session.topic,
      eventType: 'step_stuck',
      stepIndex: session.current_step,
      stepTitle: session.steps[session.current_step]?.title,
      note: 'We met friction in the current step.',
      userInput
    });

    return {
      type: 'progress',
      status: 'stuck',
      session,
      current_step: session.steps[session.current_step],
      message: assessment.reason
    };
  }

  if (assessment.status === 'partial') {
    await addLearningEvent({
      sessionId: session.id,
      topic: session.topic,
      eventType: 'step_attempted',
      stepIndex: session.current_step,
      stepTitle: session.steps[session.current_step]?.title,
      note: 'We put something into motion, but the step is not confirmed yet.',
      userInput
    });

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

export function classifyLearningReply(input) {
  const text = input.toLowerCase().trim();

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

  if (text.length >= 12 || /[\u4e00-\u9fff]/.test(text) && text.length >= 8) {
    return { status: 'partial', reason: 'substantive_reply' };
  }

  return { status: 'ignore', reason: 'too_short' };
}

function matchesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}
