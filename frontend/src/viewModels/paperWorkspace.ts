import type {
  AchievementRecord,
  AchievementResponse,
  LearningActiveResponse,
  MemoryCard,
  MemoryResponse,
  ProfileResponse,
  ProfileSignal,
} from "../lib/api";

export interface GrowthNodeModel {
  id: string;
  index: number;
  title: string;
  status: "done" | "active" | "pending";
  disabled: boolean;
}

export interface GrowthPageModel {
  topic: string;
  summary: string;
  currentStepIndex: number;
  visibleNodes: GrowthNodeModel[];
}

export interface TraceItemModel {
  id: string;
  timestamp?: string;
  timeLabel: string;
  text: string;
  context?: string;
  source: string;
}

export interface TraceGroupModel {
  dateKey: string;
  dateLabel: string;
  items: TraceItemModel[];
}

export interface TracePageModel {
  groups: TraceGroupModel[];
  patterns: ProfileSignal[];
  recentImprints: AchievementRecord[];
  imprintTotal: number;
}

function cleanText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text.length > 1 ? text : fallback;
}

function normalizeGrowthStatus(value?: string): GrowthNodeModel["status"] {
  if (value === "done" || value === "active") return value;
  return "pending";
}

export function buildGrowthPageModel(response: LearningActiveResponse | null | undefined): GrowthPageModel {
  const learning = response?.current_learning;
  const labels = learning?.step_labels || [];
  const requestedIndex = learning?.current_step_index ?? labels.findIndex((step) => step.status === "active");
  const currentIndex = Math.min(Math.max(requestedIndex < 0 ? 0 : requestedIndex, 0), Math.max(labels.length - 1, 0));
  const start = Math.max(0, currentIndex - 1);

  return {
    topic: cleanText(learning?.topic, "还没有形成成长线"),
    summary: cleanText(learning?.summary, "从一件真正想改变的小事开始。"),
    currentStepIndex: currentIndex,
    visibleNodes: labels.slice(start, currentIndex + 2).map((step) => {
      const status = normalizeGrowthStatus(step.status);
      return {
        id: String(step.index),
        index: step.index,
        title: cleanText(step.title, `第 ${step.index + 1} 步`),
        status,
        disabled: status === "pending",
      };
    }),
  };
}

function timestampValue(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function traceText(memory: MemoryCard) {
  return cleanText(memory.memory_note, cleanText(memory.insight_note, cleanText(memory.user_input, "一段尚未整理的留痕")));
}

function traceDate(timestamp?: string) {
  const date = timestamp ? new Date(timestamp) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { key: "unknown", label: "日期未记录", time: "" };
  }
  return {
    key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    label: `${date.getMonth() + 1} 月 ${date.getDate()} 日`,
    time: date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

function profileSignals(profile: ProfileResponse | null | undefined) {
  if (profile?.summary && typeof profile.summary === "object") {
    return [...(profile.summary.stable_signals || []), ...(profile.summary.developing_signals || [])].slice(0, 2);
  }
  return (profile?.profile || []).slice(0, 2);
}

export function buildTracePageModel(
  memory: MemoryResponse | null | undefined,
  profile: ProfileResponse | null | undefined,
  achievements: AchievementResponse | null | undefined,
): TracePageModel {
  const groups = new Map<string, TraceGroupModel>();
  const memories = [...(memory?.memories || [])]
    .sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp))
    .slice(0, 10);

  for (const item of memories) {
    const date = traceDate(item.timestamp);
    const group = groups.get(date.key) || { dateKey: date.key, dateLabel: date.label, items: [] };
    group.items.push({
      id: String(item.id ?? `${date.key}-${group.items.length}`),
      timestamp: item.timestamp,
      timeLabel: date.time,
      text: traceText(item),
      context: cleanText(item.user_input, "") || undefined,
      source: item.pinned ? "长期留下" : "思考片段",
    });
    groups.set(date.key, group);
  }

  const recentImprints = [...(achievements?.achievements || [])]
    .filter((item) => item.unlocked)
    .sort((left, right) => timestampValue(right.unlocked_at || undefined) - timestampValue(left.unlocked_at || undefined))
    .slice(0, 3);

  return {
    groups: [...groups.values()],
    patterns: profileSignals(profile),
    recentImprints,
    imprintTotal: achievements?.summary?.unlocked ?? (achievements?.achievements || []).filter((item) => item.unlocked).length,
  };
}
