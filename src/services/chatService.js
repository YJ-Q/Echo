import { analyzeInput } from './inputAnalyzer.js';
import { generateEchoResponse } from './echoAgent.js';
import { buildContext } from './contextBuilder.js';
import { assessLearningProgress, prepareLearningSession } from './learningEngine.js';
import { updateProfileFromInteraction } from './profileEngine.js';
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
  const { reply, tone } = echoResult;

  const memory = {
    timestamp: new Date().toISOString(),
    user_input: message,
    echo_response: reply,
    emotion: analysis.emotion,
    tags: analysis.tags
  };

  await addMemory(memory);
  await updateUserState(analysis);
  await updateProfileFromInteraction(message, analysis);

  return {
    reply,
    emotion: analysis.emotion,
    tags: analysis.tags,
    intent: analysis.intent,
    learning_session: learningSession?.session || null,
    tone
  };
}
