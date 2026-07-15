import type {
  AchievementRecord,
  AchievementResponse,
  LearningActiveResponse,
  MemoryCard,
  MemoryResponse,
  ProfileResponse,
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
  nodes: GrowthNodeModel[];
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

export interface TracePatternModel {
  key: string;
  value: string;
  status: "confirmed" | "pending";
}

export interface TracePageModel {
  groups: TraceGroupModel[];
  patterns: TracePatternModel[];
  recentImprints: AchievementRecord[];
  imprintTotal: number;
}

export type TraceFocus = "traces" | "patterns" | "imprints";

export interface TraceSlots {
  left: TraceFocus;
  rightTop: TraceFocus;
  rightBottom: TraceFocus;
}

export function resolveTraceSlots(focus: TraceFocus): TraceSlots {
  if (focus === "patterns") {
    return { left: "patterns", rightTop: "traces", rightBottom: "imprints" };
  }

  if (focus === "imprints") {
    return { left: "imprints", rightTop: "patterns", rightBottom: "traces" };
  }

  return { left: "traces", rightTop: "patterns", rightBottom: "imprints" };
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
  const nodes = labels.map((step) => {
    const status = normalizeGrowthStatus(step.status);
    return {
      id: String(step.index),
      index: step.index,
      title: cleanText(step.title, `第 ${step.index + 1} 步`),
      status,
      disabled: status === "pending",
    };
  });

  return {
    topic: cleanText(learning?.topic, "还没有形成成长线"),
    summary: cleanText(learning?.summary, "从一件真正想改变的小事开始。"),
    currentStepIndex: currentIndex,
    nodes,
    visibleNodes: selectVisibleGrowthNodes(nodes, currentIndex),
  };
}

export function selectVisibleGrowthNodes(nodes: GrowthNodeModel[], focusIndex: number) {
  if (nodes.length === 0) return [];
  const focus = Math.min(Math.max(focusIndex, 0), nodes.length - 1);
  return nodes.slice(Math.max(0, focus - 1), Math.min(nodes.length, focus + 2));
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
    return [
      ...(profile.summary.stable_signals || []).map((signal) => ({
        key: signal.key || "stable-pattern",
        value: cleanText(signal.value, "一条已经反复出现的理解"),
        status: "confirmed" as const,
      })),
      ...(profile.summary.developing_signals || []).map((signal) => ({
        key: signal.key || "developing-pattern",
        value: cleanText(signal.value, "一条还需要继续确认的理解"),
        status: "pending" as const,
      })),
    ].slice(0, 2);
  }
  return (profile?.profile || []).slice(0, 2).map((signal) => ({
    key: signal.key || "profile-pattern",
    value: cleanText(signal.value, "一条慢慢形成的理解"),
    status: "confirmed" as const,
  }));
}

export function buildTracePageModel(
  memory: MemoryResponse | null | undefined,
  profile: ProfileResponse | null | undefined,
  achievements: AchievementResponse | null | undefined,
): TracePageModel {
  const groups = new Map<string, TraceGroupModel>();
  const traces: TraceItemModel[] = [
    ...(memory?.memories || []).map((item) => ({
      id: String(item.id ?? `memory-${item.timestamp || "unknown"}`),
      timestamp: item.timestamp,
      timeLabel: "",
      text: traceText(item),
      context: cleanText(item.user_input, "") || undefined,
      source: item.pinned ? "长期留下" : "思考片段",
    })),
    ...(memory?.growth_records || []).map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      timeLabel: "",
      text: record.text,
      context: record.context,
      source: record.source,
    })),
  ]
    .sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp))
    .slice(0, 10);

  for (const item of traces) {
    const date = traceDate(item.timestamp);
    const group = groups.get(date.key) || { dateKey: date.key, dateLabel: date.label, items: [] };
    group.items.push({
      ...item,
      timestamp: item.timestamp,
      timeLabel: date.time,
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
