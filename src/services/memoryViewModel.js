export function buildMemoryViewModel(memories = []) {
  const items = Array.isArray(memories) ? memories : [];
  const pinnedMemories = items.filter((memory) => memory.pinned).slice(0, 6);
  const tagHeatmap = buildTagHeatmap(items);
  const bucketCounts = buildBucketCounts(items);
  const emotionCounts = buildEmotionCounts(items);

  return {
    overview: {
      total_memories: items.length,
      pinned_count: pinnedMemories.length,
      core_count: bucketCounts.core,
      important_count: bucketCounts.important,
      ambient_count: bucketCounts.ambient
    },
    pinned_memories: pinnedMemories.map(toMemoryCard),
    recent_memory_notes: items
      .slice(0, 8)
      .map((memory) => ({
        id: memory.id,
        timestamp: memory.timestamp,
        memory_note: memory.memory_note || memory.user_input,
        priority_bucket: memory.priority_bucket,
        salience: memory.salience,
        pinned: memory.pinned
      })),
    tag_heatmap: tagHeatmap,
    emotion_distribution: emotionCounts,
    priority_groups: {
      core: items.filter((memory) => memory.priority_bucket === 'core').slice(0, 6).map(toMemoryCard),
      important: items.filter((memory) => memory.priority_bucket === 'important').slice(0, 6).map(toMemoryCard),
      ambient: items.filter((memory) => memory.priority_bucket === 'ambient').slice(0, 6).map(toMemoryCard)
    },
    summary: buildMemorySummary(items, pinnedMemories, tagHeatmap)
  };
}

function toMemoryCard(memory) {
  return {
    id: memory.id,
    timestamp: memory.timestamp,
    user_input: memory.user_input,
    memory_note: memory.memory_note || '',
    insight_note: memory.insight_note || '',
    tags: memory.tags || [],
    emotion: memory.emotion,
    priority_bucket: memory.priority_bucket,
    salience: memory.salience,
    reinforcement_count: memory.reinforcement_count,
    pinned: memory.pinned
  };
}

function buildTagHeatmap(memories) {
  const counts = new Map();

  for (const memory of memories) {
    for (const tag of memory.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));
}

function buildBucketCounts(memories) {
  return memories.reduce((acc, memory) => {
    const bucket = memory.priority_bucket || 'ambient';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, { core: 0, important: 0, ambient: 0 });
}

function buildEmotionCounts(memories) {
  const counts = new Map();

  for (const memory of memories) {
    const emotion = memory.emotion || 'neutral';
    counts.set(emotion, (counts.get(emotion) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([emotion, count]) => ({ emotion, count }));
}

function buildMemorySummary(memories, pinnedMemories, tagHeatmap) {
  if (memories.length === 0) {
    return '还没有形成足够的记忆轮廓。';
  }

  const topTag = tagHeatmap[0]?.tag;

  if (pinnedMemories.length > 0 && topTag) {
    return `现在有 ${pinnedMemories.length} 条被固定留下的记忆，最近最常出现的标签是“${topTag}”。`;
  }

  if (pinnedMemories.length > 0) {
    return `现在有 ${pinnedMemories.length} 条被固定留下的记忆。`;
  }

  if (topTag) {
    return `最近最常出现的记忆标签是“${topTag}”。`;
  }

  return `已经累积 ${memories.length} 条记忆。`;
}
