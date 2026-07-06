import { analyzeInput } from './inputAnalyzer.js';
import { generateEchoResponse } from './echoAgent.js';
import { buildContext } from './contextBuilder.js';
import { getEchoState } from './echoStateEngine.js';
import { assessLearningProgress, prepareLearningSession } from './learningEngine.js';
import { distillInteractionMemory } from './memoryDistiller.js';
import { deriveMemoryPriority } from './memoryPriorityEngine.js';
import { updateProfileFromInteraction } from './profileEngine.js';
import { synthesizeProfileFromMemories } from './profileSynthesisEngine.js';
import { addMemory, updateUserState } from '../storage/memoryStore.js';

export async function handleChat(message) {
  const analysis = analyzeInput(message);
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
    tone,
    agent
  };
}
