import assert from "node:assert/strict";
import test from "node:test";
import { buildGrowthPageModel, buildTracePageModel, selectVisibleGrowthNodes } from "./paperWorkspace";

test("growth model exposes previous, current, and next only", () => {
  const model = buildGrowthPageModel({
    current_learning: {
      topic: "表达观点",
      current_step_index: 1,
      step_labels: [
        { index: 0, title: "提出问题", status: "done" },
        { index: 1, title: "说完整", status: "active" },
        { index: 2, title: "回应分歧", status: "pending" },
        { index: 3, title: "主持讨论", status: "pending" },
      ],
    },
  });

  assert.deepEqual(
    model.visibleNodes.map((node) => node.title),
    ["提出问题", "说完整", "回应分歧"],
  );
  assert.equal(model.visibleNodes[2]?.disabled, true);
});

test("traces are newest-first and grouped by actual calendar date", () => {
  const model = buildTracePageModel({
    memories: [
      { id: 1, timestamp: "2026-07-09T12:00:00+08:00", memory_note: "较早" },
      { id: 2, timestamp: "2026-07-11T10:00:00+08:00", memory_note: "较新" },
    ],
  }, null, null);

  assert.equal(model.groups[0]?.dateLabel, "7 月 11 日");
  assert.equal(model.groups[0]?.items[0]?.text, "较新");
});

test("recent imprints contain unlocked records only and stop at three", () => {
  const achievements = {
    achievements: [1, 2, 3, 4].map((id) => ({
      id,
      key: String(id),
      unlocked: id !== 4,
      unlocked_at: `2026-07-0${id}T09:00:00+08:00`,
    })),
  };

  const model = buildTracePageModel(null, null, achievements);

  assert.equal(model.recentImprints.length, 3);
  assert.deepEqual(model.recentImprints.map((item) => item.key), ["3", "2", "1"]);
});

test("growth node window follows a browsed focus without exceeding three nodes", () => {
  const nodes = [0, 1, 2, 3, 4].map((index) => ({
    id: String(index),
    index,
    title: `节点 ${index}`,
    status: index < 3 ? "done" as const : "pending" as const,
    disabled: index >= 3,
  }));

  assert.deepEqual(selectVisibleGrowthNodes(nodes, 0).map((node) => node.index), [0, 1]);
  assert.deepEqual(selectVisibleGrowthNodes(nodes, 2).map((node) => node.index), [1, 2, 3]);
  assert.deepEqual(selectVisibleGrowthNodes(nodes, 4).map((node) => node.index), [3, 4]);
});

test("trace patterns distinguish confirmed and developing understanding", () => {
  const model = buildTracePageModel(null, {
    summary: {
      stable_signals: [{ key: "communication_style", value: "表达前常先预想评价" }],
      developing_signals: [{ key: "motivation", value: "拆小以后更容易开始" }],
    },
  }, null);

  assert.deepEqual(model.patterns.map((pattern) => pattern.status), ["confirmed", "pending"]);
});

test("trace model caps recent items and keeps invalid dates readable", () => {
  const memories = Array.from({ length: 12 }, (_, index) => ({
    id: index,
    timestamp: index === 0 ? "invalid-date" : `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00+08:00`,
    insight_note: `观察 ${index}`,
  }));
  const model = buildTracePageModel({ memories }, null, null);
  const items = model.groups.flatMap((group) => group.items);

  assert.equal(items.length, 10);
  assert.ok(items.some((item) => item.text.startsWith("观察")));
});
