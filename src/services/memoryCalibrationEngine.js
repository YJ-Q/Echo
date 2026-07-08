import {
  getMemories,
  getUserProfile,
  setMemoryPriority,
  upsertUserProfile
} from '../storage/memoryStore.js';
import { summarizeProfile } from './profileEngine.js';

export async function overrideProfileSignal({ key, value, confidence = 0.92 }) {
  await upsertUserProfile(key, value, confidence, { force: true });
  const profile = await getUserProfile();

  return {
    profile,
    summary: summarizeProfile(profile)
  };
}

export async function pinMemory(id) {
  return setMemoryPriority(id, {
    salience: 0.96,
    priorityBucket: 'core',
    pinned: true,
    reinforcementCount: 12
  });
}

export async function calibrateMemoryPriority(id, input = {}) {
  return setMemoryPriority(id, {
    salience: input.salience,
    priorityBucket: input.priority_bucket,
    pinned: input.pinned,
    reinforcementCount: input.reinforcement_count
  });
}

export async function getCalibrationSnapshot() {
  const memories = await getMemories({ limit: 20 });
  const pinned = memories.filter((memory) => memory.pinned);
  const highPriority = memories.filter((memory) => {
    return memory.priority_bucket === 'core' || memory.priority_bucket === 'important';
  });

  return {
    pinned_memories: pinned,
    high_priority_memories: highPriority.slice(0, 10)
  };
}
