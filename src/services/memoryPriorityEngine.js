export function deriveMemoryPriority({
  analysis,
  learningSession,
  memoryNote = '',
  insightNote = ''
}) {
  let salience = 0.48;

  if (analysis.intent === 'learning') salience += 0.16;
  if (analysis.intent === 'struggle') salience += 0.14;
  if (analysis.emotion === 'anxious') salience += 0.12;
  if (analysis.tags?.includes('procrastination')) salience += 0.1;
  if (analysis.tags?.includes('learning')) salience += 0.08;
  if (learningSession?.type === 'progress') salience += 0.08;
  if (memoryNote) salience += 0.04;
  if (insightNote) salience += 0.04;

  salience = Math.min(Math.max(salience, 0.2), 1);

  return {
    salience,
    reinforcement_count: 1,
    priority_bucket: pickPriorityBucket(salience, analysis, learningSession)
  };
}

function pickPriorityBucket(salience, analysis, learningSession) {
  if (analysis.intent === 'learning' || learningSession?.type === 'progress') {
    return 'core';
  }

  if (analysis.emotion === 'anxious' || analysis.tags?.includes('procrastination')) {
    return 'important';
  }

  if (salience >= 0.7) {
    return 'important';
  }

  return 'ambient';
}
