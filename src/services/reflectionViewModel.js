export function buildReflectionViewModel(summaries = []) {
  const items = Array.isArray(summaries) ? summaries : [];
  const latest = items[0] || null;

  return {
    latest_summary: latest
      ? {
          id: latest.id,
          date: latest.date,
          summary: latest.summary,
          emotional_trend: latest.emotional_trend,
          behavioral_pattern: latest.behavioral_pattern,
          echo_reflection: latest.echo_reflection,
          created_at: latest.created_at
        }
      : null,
    emotional_trend: buildEmotionalTrend(items),
    dominant_patterns: buildPatternCards(items),
    history: items.slice(0, 7).map((item) => ({
      id: item.id,
      date: item.date,
      summary: item.summary,
      emotional_trend: item.emotional_trend,
      behavioral_pattern: item.behavioral_pattern,
      echo_reflection: item.echo_reflection
    })),
    summary: buildReflectionSummary(latest)
  };
}

function buildEmotionalTrend(summaries) {
  return summaries.slice(0, 7).map((item, index) => ({
    index,
    date: item.date,
    emotion: item.emotional_trend,
    score: emotionScore(item.emotional_trend)
  }));
}

function buildPatternCards(summaries) {
  const counts = new Map();

  for (const item of summaries) {
    const key = item.behavioral_pattern || 'pattern_forming';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pattern, count]) => ({
      pattern,
      count
    }));
}

function buildReflectionSummary(latest) {
  if (!latest) {
    return '还没有足够的反思记录。';
  }

  return `最近一条反思停在“${latest.behavioral_pattern}”，情绪底色是“${latest.emotional_trend}”。`;
}

function emotionScore(emotion) {
  const scores = {
    focused: 4,
    motivated: 3,
    neutral: 2,
    distracted: 1,
    anxious: 0
  };

  return scores[emotion] ?? 2;
}
