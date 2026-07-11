import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../frontend/src/components/GrowthJourney.tsx", import.meta.url);

test("growth journey contains the approved workspace regions and no imprint UI", async () => {
  const source = await readFile(componentPath, "utf8");
  for (const label of ["我现在的理解", "我注意到", "可能担心", "想试试看", "本周小实验", "真实情境记录", "当前成长线"]) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /Imprint|印记|coin|硬币/i);
  assert.match(source, /onWheel/);
  assert.match(source, /aria-current="step"/);
});
