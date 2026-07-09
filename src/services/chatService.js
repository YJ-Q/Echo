import { analyzeInput } from './inputAnalyzer.js';
import { generateEchoResponse } from './echoAgent.js';
import { buildContext } from './contextBuilder.js';
import { getEchoState } from './echoStateEngine.js';
import { assessLearningProgress, prepareLearningSession } from './learningEngine.js';
import { distillInteractionMemory } from './memoryDistiller.js';
import { deriveMemoryPriority } from './memoryPriorityEngine.js';
import { buildChatExplanation } from './explainabilityEngine.js';
import { detectManagementIntent } from './managementIntentEngine.js';
import { buildManagementOverview } from './managementOverviewEngine.js';
import { updateProfileFromInteraction } from './profileEngine.js';
import { synthesizeProfileFromMemories } from './profileSynthesisEngine.js';
import { addMemory, updateUserState } from '../storage/memoryStore.js';

export async function handleChat(message) {
  const analysis = analyzeInput(message);
  const managementIntent = detectManagementIntent(message);

  if (managementIntent.is_management) {
    const scope = managementIntent.primary_scope && managementIntent.primary_scope !== 'achievements'
      ? managementIntent.primary_scope
      : 'all';
    const managementOverview = await buildManagementOverview({ scope });

    return {
      reply: buildManagementReply(managementOverview),
      emotion: analysis.emotion,
      tags: [...new Set([...analysis.tags, 'management'])],
      intent: 'management',
      management_intent: managementIntent,
      management_overview: managementOverview,
      learning_session: null,
      behavior_hint: {
        type: 'review_management_overview',
        label: '先看整理建议',
        detail: managementOverview.summary,
        reason: '用户正在请求梳理后台结构化数据。',
        source: 'management_overview',
        confidence: managementIntent.confidence
      },
      decision: {
        rule: 'management_overview',
        source: 'conversation_management_intent'
      },
      memory_note: '',
      insight_note: '',
      explanation: {
        summary: '本轮识别为对话式后台治理请求，只返回只读梳理结果，不修改数据。',
        decision_trace: {
          rule: 'management_overview',
          scope: managementOverview.scope,
          risk_level: managementOverview.risk_level
        }
      },
      tone: 'grounded',
      agent: 'local-management'
    };
  }

  const memoryContext = await buildContext(message);
  const learningSession = analysis.intent === 'learning'
    ? await prepareLearningSession(message)
    : await assessLearningProgress(message);

  if (learningSession?.type === 'progress') {
    analysis.tags = [...new Set([...analysis.tags.filter((tag) => tag !== 'life'), 'learning'])];

    if (learningSession.status === 'stuck') {
      analysis.emotion = 'distracted';
      analysis.tags = [...new Set([...analysis.tags, 'procrastination'])];
    }
  }

  const echoResult = await generateEchoResponse({
    userInput: message,
    analysis,
    memoryContext,
    learningSession
  });
  const { reply, tone, agent } = echoResult;

  const memory = {
    timestamp: new Date().toISOString(),
    user_input: message,
    echo_response: reply,
    emotion: analysis.emotion,
    tags: analysis.tags
  };

  await updateUserState(analysis);
  await updateProfileFromInteraction(message, analysis);
  const state = await getEchoState(message);
  const distilled = distillInteractionMemory({
    userInput: message,
    reply,
    analysis,
    learningSession,
    behaviorHint: state.next_action
  });
  const priority = deriveMemoryPriority({
    analysis,
    learningSession,
    memoryNote: distilled.memory_note,
    insightNote: distilled.insight_note
  });

  await addMemory({
    ...memory,
    ...distilled,
    ...priority
  });
  await synthesizeProfileFromMemories({ limit: 24 });
  const explanation = buildChatExplanation({
    analysis,
    memoryContext,
    learningSession,
    decision: {
      ...state.decision,
      ...state.next_action
    },
    reply,
    tone,
    agent
  });

  return {
    reply,
    emotion: analysis.emotion,
    tags: analysis.tags,
    intent: analysis.intent,
    learning_session: learningSession?.session || null,
    behavior_hint: state.next_action,
    decision: state.decision,
    memory_note: distilled.memory_note,
    insight_note: distilled.insight_note,
    explanation,
    tone,
    agent
  };
}

function buildManagementReply(overview) {
  if (overview.scope === 'all') {
    return `我先做只读梳理，不会修改任何数据。${overview.summary}`;
  }

  const candidateCount = overview.candidates?.length || 0;
  const recommendationCount = overview.recommendations?.length || 0;
  return `我先做只读梳理，不会修改任何数据。${overview.summary} 当前有 ${candidateCount} 个候选和 ${recommendationCount} 条建议，可以继续讨论是否生成待确认操作草案。`;
}
