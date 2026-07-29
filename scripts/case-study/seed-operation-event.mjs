#!/usr/bin/env node
import path from "node:path";
import {
  addLearningEvent,
  addOperationEvent,
  closeMemoryStore,
  configureMemoryStore,
  getLatestActiveLearningSession
} from "../../src/storage/memoryStore.js";

const requestedDbPath = process.argv[2];
if (!requestedDbPath) {
  throw new Error("Missing explicit Case Study database path.");
}

configureMemoryStore({ dbPath: path.resolve(requestedDbPath) });

try {
  const learningSession = await getLatestActiveLearningSession();
  if (learningSession) {
    const currentStep = learningSession.steps[learningSession.current_step];
    await addLearningEvent({
      sessionId: learningSession.id,
      topic: learningSession.topic,
      eventType: "step_note_seeded",
      stepIndex: learningSession.current_step,
      stepTitle: currentStep?.title,
      note: "先用一句话说明它解决的核心问题。",
      userInput: null
    });
  }

  await addOperationEvent({
    proposalId: null,
    eventType: "review_snapshot_created",
    scope: "memory",
    riskLevel: "read_only",
    operationSummary: "已记录一次案例研究线索的只读检查，未修改任何记忆。",
    payload: { source: "case-study-demo", changed: false }
  });
} finally {
  await closeMemoryStore();
}
